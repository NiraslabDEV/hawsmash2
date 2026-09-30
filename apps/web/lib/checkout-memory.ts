/**
 * Memória do checkout, só neste browser.
 *
 * Quem já encomendou deste telemóvel não volta a escrever nome, telefone,
 * email nem morada. Fica tudo no `localStorage` do próprio cliente e nunca
 * vem do servidor: um número de telefone escrito por alguém não devolve a
 * morada de ninguém (ADR 0003). A conta por dispositivo continua a existir;
 * isto é o que funciona mesmo antes de ela reconhecer o telemóvel.
 *
 * Tudo best-effort: modo privado ou storage bloqueado só significa que da
 * próxima vez o formulário vem vazio. A venda nunca depende disto.
 */

type StorageAccess = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const CUSTOMER_KEY = 'dl_customer';
const ADDRESS_KEY = 'dl_address';

export type SavedCustomer = { name: string; phone: string; email: string };
export type SavedAddress = { address: string; zoneId: string | null };

const text = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

function read(storage: StorageAccess, key: string): Record<string, unknown> | null {
  try {
    const raw = storage.getItem(key);
    if (!raw || raw.length > 5_000) return null;
    const data = JSON.parse(raw);
    return data && typeof data === 'object' ? data as Record<string, unknown> : null;
  } catch { return null; }
}

export function readSavedCustomer(storage: StorageAccess): SavedCustomer | null {
  const data = read(storage, CUSTOMER_KEY);
  if (!data) return null;
  const customer = { name: text(data.name, 100), phone: text(data.phone, 20), email: text(data.email, 200) };
  return customer.name || customer.phone || customer.email ? customer : null;
}

export function readSavedAddress(storage: StorageAccess): SavedAddress | null {
  const data = read(storage, ADDRESS_KEY);
  const address = text(data?.address, 300);
  if (!address) return null;
  const zoneId = text(data?.zoneId, 64);
  return { address, zoneId: zoneId || null };
}

/** Guarda o que o cliente escreveu. A morada só se for entrega e tiver texto. */
export function rememberCheckout(
  storage: StorageAccess,
  customer: SavedCustomer,
  address: SavedAddress | null,
): void {
  try {
    storage.setItem(CUSTOMER_KEY, JSON.stringify({
      name: text(customer.name, 100), phone: text(customer.phone, 20), email: text(customer.email, 200),
    }));
    const line = text(address?.address, 300);
    if (line) storage.setItem(ADDRESS_KEY, JSON.stringify({ address: line, zoneId: address?.zoneId || null }));
  } catch { /* Modo privado: só não haverá memória na próxima vez. */ }
}

export function forgetSavedAddress(storage: StorageAccess): void {
  try { storage.removeItem(ADDRESS_KEY); } catch { /* Best-effort no browser. */ }
}

/** "Não sou eu" num telemóvel partilhado: esquece tudo o que ficou deste cliente. */
export function forgetCheckout(storage: StorageAccess): void {
  try { storage.removeItem(CUSTOMER_KEY); storage.removeItem(ADDRESS_KEY); } catch { /* Best-effort. */ }
}

/** Validação de forma, não de existência: o servidor de email é que sabe se chega. */
export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
}
