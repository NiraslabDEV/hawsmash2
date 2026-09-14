import type { SupabaseClient } from '@supabase/supabase-js';

import { fireConversions } from '@/lib/server-analytics/conversions';
import { orderToReference } from './reference';

/**
 * Confirmar um pedido como pago — **num só sítio**.
 *
 * Há quatro caminhos que descobrem que um pagamento entrou: o webhook do
 * Paysuite, a verificação activa no regresso do cliente, o cron de
 * reconciliação e a cobrança directa. Se cada um confirmasse
 * à sua maneira, mais tarde ou mais cedo um deles esquecia o email, ou a
 * conversão, ou a chave de idempotência — e o defeito só aparecia no caminho
 * menos usado, que é o mais difícil de reproduzir.
 *
 * A chave de idempotência é **do pedido**, não da tentativa: um pedido é
 * confirmado uma vez, aconteça isto por que caminho acontecer.
 */

export interface ConfirmOrderInput {
  svc: SupabaseClient;
  orderId: string;
  storeId: string;
  provider: string;
  providerRef: string | null;
  method: string;
  amountCents: number;
  /** De onde veio a confirmação — fica no `event_log` para se poder explicar. */
  source: string;
  /** Base do site, para os efeitos secundários (email). Sem ela, não se envia. */
  origin?: string;
  /** Para o email de aprovação, quando existir. */
  customer?: { email?: string | null; name?: string | null; orderNumber?: string | null };
}

export interface ConfirmOrderResult {
  ok: boolean;
  /** `'ok'` na primeira confirmação; `'duplicate'` exige releitura canónica. */
  result: string | null;
  error: string | null;
}

export async function confirmOrderPaid(input: ConfirmOrderInput): Promise<ConfirmOrderResult> {
  const { svc, orderId, storeId, provider, providerRef, method, amountCents, source } = input;

  let result: unknown;
  try {
    const confirmation = await svc.rpc('confirm_payment', {
      p_idempotency_key: orderToReference(orderId),
      p_order_id: orderId,
      p_provider: provider,
      p_provider_ref: providerRef,
      p_method: method,
      p_amount_cents: amountCents,
      p_raw_webhook: { source },
    });
    if (confirmation.error) return { ok: false, result: null, error: 'payment_confirmation_failed' };
    result = confirmation.data;
  } catch {
    return { ok: false, result: null, error: 'payment_confirmation_failed' };
  }

  if (result === 'duplicate') {
    // A RPC também devolve duplicate para uma tentativa anterior rejeitada.
    // Só o estado canónico da mesma loja prova que este pedido ficou pago.
    try {
      const { data: order, error } = await svc.from('orders')
        .select('status,payment_method,total_cents')
        .eq('id', orderId).eq('store_id', storeId).maybeSingle();
      if (!error && order
        && ['paid', 'in_preparation', 'ready', 'delivered'].includes(order.status)
        && order.payment_method === method && order.total_cents === amountCents) {
        return { ok: true, result: 'duplicate', error: null };
      }
    } catch { /* Uma consulta inconclusiva não prova pagamento. */ }
    return { ok: false, result: 'duplicate', error: 'payment_confirmation_unverified' };
  }

  if (result !== 'ok') {
    const knownFailure = ['invalid_state', 'amount_mismatch', 'order_not_found'].includes(String(result));
    return { ok: false, result: knownFailure ? String(result) : null, error: 'payment_confirmation_rejected' };
  }

  // Só na PRIMEIRA confirmação. Tudo o que vem a seguir é best-effort: uma
  // falha a enviar email não pode desfazer um pagamento (CLAUDE.md §1).
  if (result === 'ok') {
    const { customer, origin } = input;
    if (customer?.email && origin) {
      fetch(`${origin}/api/emails/send-approval-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: customer.email,
          customerName: customer.name,
          orderNumber: customer.orderNumber,
          totalCents: amountCents,
          paymentMethod: method,
        }),
      }).catch(() => {});
    }
    fireConversions(orderId, amountCents, svc).catch(() => {});
  }

  return { ok: true, result: 'ok', error: null };
}
