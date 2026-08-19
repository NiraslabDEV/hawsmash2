import { NextResponse } from 'next/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { getPaymentConfig, buildProvider } from '@/lib/payments/config';
import { orderToReference } from '@/lib/payments/reference';
import { fireConversions } from '@/lib/server-analytics/conversions';

/**
 * Verificação ATIVA do pagamento (chamada pela página /payment/return).
 *
 * Não depende do webhook nem do cron: pergunta o estado diretamente ao Paysuite
 * (getPaymentStatus) e, se estiver pago, chama confirm_payment (idempotente, a
 * mesma idempotency key do webhook/cron → sem dupla confirmação). Assim o pedido
 * fica `paid` mal o cliente volta do checkout, mesmo que o webhook falhe.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const orderId = body?.orderId as string | undefined;
  if (!orderId) {
    return NextResponse.json({ error: 'order_id_required' }, { status: 400 });
  }

  const cfg = await getPaymentConfig();
  if (cfg.provider === 'manual') {
    return NextResponse.json({ status: 'manual' });
  }

  const svc = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const { data: order } = await svc
    .from('orders')
    .select('id, status, total_cents, payment_provider_ref, payment_method, customer_email, customer_name, order_number')
    .eq('id', orderId)
    .single();

  if (!order) {
    return NextResponse.json({ error: 'order_not_found' }, { status: 404 });
  }

  // Já confirmado
  if (['paid', 'in_preparation', 'ready', 'delivered'].includes(order.status)) {
    return NextResponse.json({ status: 'paid' });
  }
  if (!order.payment_provider_ref) {
    return NextResponse.json({ status: order.status });
  }

  const provider = buildProvider(cfg);
  if (!provider.getPaymentStatus) {
    return NextResponse.json({ status: order.status });
  }

  let paymentStatus: 'success' | 'failed' | 'pending';
  try {
    paymentStatus = await provider.getPaymentStatus(order.payment_provider_ref);
  } catch {
    return NextResponse.json({ status: 'pending' });
  }

  if (paymentStatus === 'failed') {
    await svc
      .from('orders')
      .update({ status: 'payment_failed', updated_at: new Date().toISOString() })
      .eq('id', order.id)
      .in('status', ['awaiting_payment', 'payment_failed']);
    await svc.from('event_log').insert({
      order_id: order.id,
      type: 'payment.failed',
      payload: { provider: cfg.provider, source: 'return_verify' },
    });
    return NextResponse.json({ status: 'failed' });
  }

  if (paymentStatus !== 'success') {
    return NextResponse.json({ status: 'pending' });
  }

  // Pago no Paysuite → confirmar (idempotente: mesma key do webhook/cron)
  const { data: result, error } = await svc.rpc('confirm_payment', {
    p_idempotency_key: orderToReference(order.id),
    p_order_id: order.id,
    p_provider: cfg.provider,
    p_provider_ref: order.payment_provider_ref,
    p_method: order.payment_method ?? 'mpesa',
    p_amount_cents: order.total_cents,
    p_raw_webhook: { source: 'return_verify' },
  });

  if (error) {
    return NextResponse.json({ status: 'pending', error: error.message });
  }

  // Só na PRIMEIRA confirmação (result 'ok') → email + CAPI/Ads (fire-and-forget)
  if (result === 'ok') {
    if (order.customer_email) {
      const origin = new URL(request.url).origin;
      fetch(`${origin}/api/emails/send-approval-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: order.customer_email,
          customerName: order.customer_name,
          orderNumber: order.order_number,
          totalCents: order.total_cents,
          paymentMethod: order.payment_method,
        }),
      }).catch(() => {});
    }
    fireConversions(order.id, order.total_cents ?? 0, svc).catch(() => {});
  }

  return NextResponse.json({ status: 'paid', confirm: result });
}
