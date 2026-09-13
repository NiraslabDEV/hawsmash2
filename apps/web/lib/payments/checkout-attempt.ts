type StorageAccess = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const KEY = 'checkout_attempt';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Attempt = { version: 1; key: string; digest: string };

export class CheckoutStorageError extends Error {
  constructor() {
    super('Não conseguimos guardar a referência do pagamento neste navegador. Activa o armazenamento do site antes de pagar online.');
  }
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, entry]) => [key, canonical(entry)]));
  }
  return value;
}

function read(storage: StorageAccess): Attempt | null {
  const raw = storage.getItem(KEY);
  if (raw === null) return null;
  if (raw.length > 512) throw new CheckoutStorageError();
  const data = JSON.parse(raw);
  if (data?.version !== 1 || typeof data.key !== 'string' || !UUID.test(data.key)
    || typeof data.digest !== 'string' || !/^[0-9a-f]{64}$/.test(data.digest)) throw new CheckoutStorageError();
  return data;
}

/** A chave fica confirmada no browser ANTES do POST, mesmo se a resposta se perder. */
export async function getCheckoutAttempt(storage: StorageAccess, payload: unknown): Promise<string> {
  try {
    // Normalizar primeiro segundo JSON: undefined desaparece como no fetch.
    const json = JSON.stringify(canonical(JSON.parse(JSON.stringify(payload))));
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(json));
    const digest = Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
    const previous = read(storage);
    if (previous?.digest === digest) return previous.key;
    const attempt: Attempt = { version: 1, key: crypto.randomUUID(), digest };
    storage.setItem(KEY, JSON.stringify(attempt));
    const saved = read(storage);
    if (saved?.key !== attempt.key || saved.digest !== digest) throw new CheckoutStorageError();
    return attempt.key;
  } catch { throw new CheckoutStorageError(); }
}

export function clearCheckoutAttempt(storage: StorageAccess, key: string): void {
  try { if (read(storage)?.key === key) storage.removeItem(KEY); }
  catch { /* Sem confirmação da remoção, o próximo retry conserva a chave. */ }
}
