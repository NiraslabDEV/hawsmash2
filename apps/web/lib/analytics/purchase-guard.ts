/**
 * purchase-guard.ts — a REGRA CRÍTICA (CLAUDE.md 16.1) em código puro e testável.
 *
 * `purchase` dispara APENAS quando order.status ∈ {paid, approved}, e NUNCA
 * re-dispara: idempotência dupla = guard in-memory (useRef no componente) +
 * guard persistente (localStorage['tracked_purchase_<orderId>']) → sobrevive a reload.
 *
 * Estas funções não tocam em window/dataLayer — só decidem "deve disparar?".
 */

export const PURCHASE_STATUSES = ['paid', 'approved'] as const;

export function isPurchaseStatus(status: string | null | undefined): boolean {
  return !!status && (PURCHASE_STATUSES as readonly string[]).includes(status);
}

export function purchaseGuardKey(orderId: string): string {
  return `tracked_purchase_${orderId}`;
}

/** Pure: deve disparar? (status correto E ainda não marcado no storage). */
export function shouldFirePurchase(
  status: string | null | undefined,
  orderId: string,
  storage: Pick<Storage, 'getItem'>,
): boolean {
  if (!isPurchaseStatus(status)) return false;
  return storage.getItem(purchaseGuardKey(orderId)) === null;
}

/** Marca o purchase como já disparado (persistente entre reloads). */
export function markPurchaseFired(orderId: string, storage: Pick<Storage, 'setItem'>): void {
  storage.setItem(purchaseGuardKey(orderId), '1');
}
