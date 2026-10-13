import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Anular um pedido já entregue (1112) — só o dono, só no painel.
 *
 * O pedido fica, como Cancelado e com o motivo no histórico; o stock volta e
 * o pagamento sai do caixa e dos relatórios. O cliente não recebe email.
 * Pedidos por entregar não passam por aqui: têm o Cancelar de sempre.
 */
export type VoidDeliveredResult =
  | { ok: true; duplicate: boolean; shiftClosed: boolean; refundedCents: number }
  | { ok: false; message: string };

export const VOID_REASON_MIN = 3;
export const VOID_REASON_MAX = 500;

export function voidReasonReady(reason: string): boolean {
  const limpo = reason.trim();
  return limpo.length >= VOID_REASON_MIN && limpo.length <= VOID_REASON_MAX;
}

export function voidDeliveredErrorMessage(message?: string): string {
  const m = message ?? '';
  if (m.includes('void_access_denied')) return 'Só o dono pode anular um pedido entregue.';
  if (m.includes('void_reason_required')) return `Escreve o motivo (${VOID_REASON_MIN} a ${VOID_REASON_MAX} caracteres).`;
  if (m.includes('order_not_delivered')) return 'Este pedido já não está entregue. Actualiza a lista.';
  if (m.includes('order_not_found')) return 'Pedido não encontrado nesta conta.';
  if (m.includes('not_authenticated')) return 'A sessão expirou. Entra outra vez.';
  if (m.includes('Could not find the function') || m.includes('PGRST202')) {
    return 'A anulação ainda não está disponível nesta instalação. Chama o suporte.';
  }
  if (/fetch|network|timeout/i.test(m)) return 'Sem ligação ao servidor. Tenta outra vez.';
  return 'Não foi possível anular o pedido. Tenta outra vez.';
}

export async function voidDeliveredOrder(
  supabase: SupabaseClient,
  orderId: string,
  reason: string,
): Promise<VoidDeliveredResult> {
  const { data, error } = await supabase.rpc('void_delivered_order', {
    p_order_id: orderId,
    p_reason: reason.trim(),
  });
  if (error) return { ok: false, message: voidDeliveredErrorMessage(error.message) };
  const r = (data ?? {}) as { duplicate?: boolean; shift_closed?: boolean; refunded_cents?: number };
  return {
    ok: true,
    duplicate: r.duplicate === true,
    shiftClosed: r.shift_closed === true,
    refundedCents: typeof r.refunded_cents === 'number' ? r.refunded_cents : 0,
  };
}
