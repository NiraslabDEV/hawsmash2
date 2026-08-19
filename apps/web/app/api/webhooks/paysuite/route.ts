import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { getPaymentConfig, buildProvider } from '@/lib/payments/config';
import { referenceToOrderId } from '@/lib/payments/reference';
import { fireConversions } from '@/lib/server-analytics/conversions';

export async function POST(request: Request) {
  // 1. Ler raw body ANTES de qualquer parsing (assinatura é sobre o raw body)
  const raw = await request.text();
  const sig = request.headers.get('x-webhook-signature') ?? '';

  // Config (provider + webhook secret) de settings → fallback .env (CLAUDE.md 6.2/16.2)
  const cfg = await getPaymentConfig();
  const provider = buildProvider(cfg);

  // 2. Verificar assinatura HMAC-SHA256 (CLAUDE.md 12: webhook sem assinatura = rejeitado)
  if (!provider.verifyWebhookSignature(raw, sig)) {
    return new Response('invalid_signature', { status: 401 });
  }

  // 3. Parsear payload
  let parsed: ReturnType<typeof provider.parseWebhook>;
  try {
    parsed = provider.parseWebhook(JSON.parse(raw));
  } catch {
    return new Response('invalid_payload', { status: 400 });
  }

  // requestId = data.reference (alfanumérico) → orderId (CLAUDE.md 6.4)
  const orderId = referenceToOrderId(parsed.requestId);

  const supabase = await createClient();

  // 4. Fluxo: pagamento falhado
  if (parsed.event === 'failed') {
    // Transicionar para payment_failed (service role bypassa RLS)
    const { data: orderRow } = await supabase
      .from('orders')
      .select('id, status')
      .eq('id', orderId)
      .single();

    if (orderRow && ['awaiting_payment', 'payment_failed'].includes(orderRow.status)) {
      await supabase
        .from('orders')
        .update({ status: 'payment_failed', updated_at: new Date().toISOString() })
        .eq('id', orderId);

      await supabase.from('event_log').insert({
        order_id: orderId,
        type:     'payment.failed',
        payload:  { provider: cfg.provider, idempotency_key: parsed.requestId },
      });
    }

    return NextResponse.json({ ok: true, event: 'failed' });
  }

  // 5. Fluxo: pagamento bem-sucedido — confirm_payment (idempotente, CLAUDE.md 14.3)
  const { data: result, error } = await supabase.rpc('confirm_payment', {
    p_idempotency_key: parsed.requestId,
    p_order_id:        orderId,
    p_provider:        cfg.provider,
    p_provider_ref:    parsed.providerRef,
    p_method:          parsed.method,
    p_amount_cents:    parsed.amountCents,
    p_raw_webhook:     JSON.parse(raw),
  });

  if (error) {
    console.error('[webhook/paysuite] confirm_payment error:', error);
    // Retornar 200 para evitar reenvios do Paysuite — o erro está logado
    return NextResponse.json({ ok: true, error: error.message });
  }

  if (result === 'duplicate') {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  // 6. Enviar email + disparar CAPI/Enhanced quando pago (best-effort, fire-and-forget)
  if (result === 'ok') {
    const { data: order } = await supabase
      .from('orders')
      .select('customer_email, customer_name, order_number, total_cents, payment_method')
      .eq('id', orderId)
      .single();

    if (order?.customer_email) {
      const origin = new URL(request.url).origin;
      fetch(`${origin}/api/emails/send-approval-email`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to:            order.customer_email,
          customerName:  order.customer_name,
          orderNumber:   order.order_number,
          totalCents:    order.total_cents,
          paymentMethod: order.payment_method,
        }),
      }).catch((e) => console.error('[webhook] email failed:', e));
    }

    // CAPI + Enhanced Conversions — fire-and-forget, event_id = 'purchase_<orderId>'
    // Usa service client para ler settings (B) sem depender do cookie de sessão.
    const serviceSupabase = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );
    fireConversions(orderId, order?.total_cents ?? 0, serviceSupabase).catch(() => {});
  }

  return NextResponse.json({ ok: true, result });
}
