import { clearCheckoutAttempt } from './checkout-attempt';

type StorageAccess = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const KEY = 'pending_checkout';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {};
const id = (value: unknown): string | null => typeof value === 'string' ? value : null;
const ids = (value: unknown): string[] => Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

function cartKey(items: readonly unknown[]): string {
  // Só identificadores e quantidades. Notas, contactos e preços nunca entram
  // nesta referência local; mudar o método também não cria outro pagamento.
  return JSON.stringify(items.map((value) => {
    const item = record(value);
    return {
      menuItemId: id(item.menuItemId), qty: Number.isSafeInteger(item.qty) ? item.qty : null, variantId: id(item.variantId),
      addonIds: ids(item.addonIds), modifiers: Array.isArray(item.modifiers)
        ? item.modifiers.map((value) => { const modifier = record(value); return { groupId: id(modifier.groupId), optionIds: ids(modifier.optionIds) }; }) : [],
    };
  }));
}

function read(storage: StorageAccess): { orderId: string; storeSlug: string; cartKey: string; clientCheckoutId?: string } | null {
  try {
    const raw = storage.getItem(KEY);
    if (!raw || raw.length > 100_000) return null;
    const data = JSON.parse(raw);
    return data?.version === 1 && typeof data.orderId === 'string' && UUID.test(data.orderId)
      && typeof data.storeSlug === 'string' && typeof data.cartKey === 'string' ? data : null;
  } catch { return null; }
}

export function rememberPendingCheckout(storage: StorageAccess, orderId: string, storeSlug: string, items: readonly unknown[], clientCheckoutId?: string): void {
  if (!UUID.test(orderId)) return;
  try { storage.setItem(KEY, JSON.stringify({ version: 1, orderId, storeSlug, cartKey: cartKey(items), ...(clientCheckoutId && UUID.test(clientCheckoutId) ? { clientCheckoutId } : {}) })); }
  catch { /* Storage bloqueado: o pedido continua pelo retorno normal. */ }
}

export function getPendingCheckout(storage: StorageAccess, storeSlug: string, items: readonly unknown[]): string | null {
  const pending = read(storage);
  return pending?.storeSlug === storeSlug && pending.cartKey === cartKey(items) ? pending.orderId : null;
}

export function clearPendingCheckout(storage: StorageAccess, orderId: string): void {
  const pending = read(storage);
  if (pending?.orderId !== orderId) return;
  if (pending.clientCheckoutId) clearCheckoutAttempt(storage, pending.clientCheckoutId);
  try { storage.removeItem(KEY); } catch { /* Best-effort no browser. */ }
}
