import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { getPaymentConfig, buildProvider } from '@/lib/payments/config';
import { orderToReference } from '@/lib/payments/reference';

// DECISÃO: cron não usa Bearer token pois corre em ambiente de servidor fechado.
// Em produção Vercel, proteger com CRON_SECRET no header Authorization.

export async function GET(request: Request) {
  // Verificação mínima: header Authorization = Bearer CRON_SECRET (se configurado)
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = request.headers.get('authorization') ?? '';
    if (auth !== `Bearer ${cronSecret}`) {
      return new Response('unauthorized', { status: 401 });
    }
  }

  // Config (provider + chaves) de settings → fallback .env (CLAUDE.md 6.2/16.2)
  const cfg = await getPaymentConfig();
  const providerType = cfg.provider;
  if (providerType === 'manual') {
    return NextResponse.json({ ok: true, skipped: 'manual_provider' });
  }

  const supabase = await createClient();
  const provider = buildProvider(cfg);

  // Pedidos digitais em aberto com referência de provider há mais de 5 minutos
  const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();

  const { data: staleOrders, error } = await supabase
    .from('orders')
    .select('id, total_cents, payment_provider_ref, order_number')
    .in('status', ['awaiting_payment', 'payment_failed'])
    .not('payment_provider_ref', 'is', null)
    .lt('created_at', cutoff);

  if (error) {
    console.error('[cron/reconcile] query error:', error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const results: Array<{ orderId: string; outcome: string }> = [];

  for (const order of staleOrders ?? []) {
    if (!provider.getPaymentStatus) {
      results.push({ orderId: order.id, outcome: 'no_status_method' });
      continue;
    }

    try {
      const status = await provider.getPaymentStatus(order.payment_provider_ref!);

      if (status === 'success') {
        // Mesma referência que o checkout/webhook usam → dedup consistente
        const { data: result } = await supabase.rpc('confirm_payment', {
          p_idempotency_key: orderToReference(order.id),
          p_order_id:        order.id,
          p_provider:        providerType,
          p_provider_ref:    order.payment_provider_ref,
          p_method:          'mpesa', // provider não devolve método neste endpoint
          p_amount_cents:    order.total_cents,
          p_raw_webhook:     { source: 'reconciliation', order_number: order.order_number },
        });
        results.push({ orderId: order.id, outcome: result ?? 'rpc_error' });

      } else if (status === 'failed') {
        await supabase
          .from('orders')
          .update({ status: 'payment_failed', updated_at: new Date().toISOString() })
          .eq('id', order.id)
          .in('status', ['awaiting_payment', 'payment_failed']);

        await supabase.from('event_log').insert({
          order_id: order.id,
          type:     'payment.failed',
          payload:  { provider: providerType, source: 'reconciliation' },
        });

        results.push({ orderId: order.id, outcome: 'marked_failed' });
      } else {
        results.push({ orderId: order.id, outcome: 'still_pending' });
      }
    } catch (err) {
      console.error(`[cron/reconcile] order ${order.id}:`, err);
      results.push({ orderId: order.id, outcome: 'error' });
    }
  }

  return NextResponse.json({ ok: true, processed: results.length, results });
}
