import { NextResponse } from 'next/server';
import { isDirectProvider } from '@delivery/payments';

import { buildProvider, getPaymentConfig, isDirectFlow } from '@/lib/payments/config';
import { confirmOrderPaid } from '@/lib/payments/confirm';
import { serviceClient } from '@/lib/payments/direct';

/**
 * Reconciliação — a última rede por baixo do pagamento.
 *
 * Vai buscar os pedidos que ficaram em aberto e pergunta ao gateway o que
 * aconteceu. É o que apanha o que escapou ao webhook e à verificação activa:
 * o cliente que fechou o browser a meio, o telemóvel que ficou sem bateria
 * depois do PIN, a resposta que nunca chegou.
 *
 * No M-Pesa directo isto deixa de ser rede de segurança e passa a ser peça
 * essencial: **não há webhook**. Quem não perguntar, não sabe.
 */

// DECISÃO: cron não usa Bearer token pois corre em ambiente de servidor fechado.
// Em produção, proteger com CRON_SECRET no header Authorization.

interface StaleOrder {
  id: string;
  total_cents: number;
  payment_provider_ref: string | null;
  payment_reference: string | null;
  payment_method: string | null;
  order_number: string | null;
}

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = request.headers.get('authorization') ?? '';
    if (auth !== `Bearer ${cronSecret}`) {
      return new Response('unauthorized', { status: 401 });
    }
  }

  const cfg = await getPaymentConfig();
  const providerType = cfg.provider;
  if (providerType === 'manual') {
    return NextResponse.json({ ok: true, skipped: 'manual_provider' });
  }

  const supabase = serviceClient();

  let provider;
  try {
    provider = buildProvider(cfg);
  } catch {
    return NextResponse.json({ ok: true, skipped: 'provider_not_configured' });
  }

  const direct = isDirectFlow(providerType);

  // Cinco minutos de folga: abaixo disso o cliente ainda está no ecrã e é a
  // verificação activa que resolve — perguntar aqui era duplicar chamadas ao
  // gateway sem ganhar nada.
  const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();

  // O que identifica o pagamento muda com o fluxo: o gateway de redirect
  // conhece-o pelo id dele, o M-Pesa directo pela nossa referência.
  const coluna = direct ? 'payment_reference' : 'payment_provider_ref';

  const { data: staleOrders, error } = await supabase
    .from('orders')
    .select('id, total_cents, payment_provider_ref, payment_reference, payment_method, order_number')
    .in('status', ['awaiting_payment', 'payment_failed'])
    .lt('created_at', cutoff)
    .not(coluna, 'is', null)
    .returns<StaleOrder[]>();

  if (error) {
    console.error('[cron/reconcile] query error:', error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const results: Array<{ orderId: string; outcome: string }> = [];

  for (const order of staleOrders ?? []) {
    const lookup = direct ? order.payment_reference : order.payment_provider_ref;
    if (!lookup) {
      results.push({ orderId: order.id, outcome: 'no_reference' });
      continue;
    }
    if (!isDirectProvider(provider) && !provider.getPaymentStatus) {
      results.push({ orderId: order.id, outcome: 'no_status_method' });
      continue;
    }

    try {
      const status = isDirectProvider(provider)
        ? await provider.getPaymentStatus(lookup)
        : await provider.getPaymentStatus!(lookup);

      if (status === 'success') {
        const confirm = await confirmOrderPaid({
          svc: supabase,
          orderId: order.id,
          provider: providerType,
          providerRef: order.payment_provider_ref ?? order.payment_reference,
          method: order.payment_method ?? 'mpesa',
          amountCents: order.total_cents,
          source: 'reconciliation',
        });
        results.push({ orderId: order.id, outcome: confirm.result ?? confirm.error ?? 'rpc_error' });
      } else if (status === 'failed') {
        await supabase
          .from('orders')
          .update({ status: 'payment_failed', updated_at: new Date().toISOString() })
          .eq('id', order.id)
          .in('status', ['awaiting_payment', 'payment_failed']);

        await supabase.from('event_log').insert({
          order_id: order.id,
          type: 'payment.failed',
          payload: { provider: providerType, source: 'reconciliation' },
        });

        results.push({ orderId: order.id, outcome: 'marked_failed' });
      } else {
        // Continua sem resposta. Fica para a próxima passagem — nunca se
        // decide por falha só porque já passou tempo.
        results.push({ orderId: order.id, outcome: 'still_pending' });
      }
    } catch (err) {
      console.error(`[cron/reconcile] order ${order.id}:`, err);
      results.push({ orderId: order.id, outcome: 'error' });
    }
  }

  return NextResponse.json({ ok: true, processed: results.length, results });
}
