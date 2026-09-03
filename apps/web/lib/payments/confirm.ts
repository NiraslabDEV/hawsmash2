import type { SupabaseClient } from '@supabase/supabase-js';

import { fireConversions } from '@/lib/server-analytics/conversions';
import { orderToReference } from './reference';

/**
 * Confirmar um pedido como pago — **num só sítio**.
 *
 * Há quatro caminhos que descobrem que um pagamento entrou: o webhook do
 * Paysuite, a verificação activa no regresso do cliente, o cron de
 * reconciliação, e agora a cobrança directa por M-Pesa. Se cada um confirmasse
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
  /** `'ok'` na primeira confirmação; outro valor quando já estava confirmado. */
  result: string | null;
  error: string | null;
}

export async function confirmOrderPaid(input: ConfirmOrderInput): Promise<ConfirmOrderResult> {
  const { svc, orderId, provider, providerRef, method, amountCents, source } = input;

  const { data: result, error } = await svc.rpc('confirm_payment', {
    p_idempotency_key: orderToReference(orderId),
    p_order_id: orderId,
    p_provider: provider,
    p_provider_ref: providerRef,
    p_method: method,
    p_amount_cents: amountCents,
    p_raw_webhook: { source },
  });

  if (error) return { ok: false, result: null, error: error.message };

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

  return { ok: true, result: (result as string | null) ?? null, error: null };
}
