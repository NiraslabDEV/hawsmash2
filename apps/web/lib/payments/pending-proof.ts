/**
 * O pedido que ficou à espera do comprovativo, só neste browser.
 *
 * Quem paga por M-Pesa sai do site: vai ao *150# ou à aplicação, e o telemóvel
 * despeja a página enquanto isso. Ao voltar, o ecrã de pagamento — que só
 * existia em memória — já não está lá, e a pessoa encontra o formulário outra
 * vez. Faz o pedido de novo: duas encomendas iguais no painel, uma delas sem
 * comprovativo nenhum.
 *
 * Esta nota guarda o pedido que já foi criado. Ao voltar, o checkout confirma
 * com o servidor que ele continua à espera e devolve o mesmo ecrã, com o mesmo
 * `orderId` — ninguém reescreve nada e ninguém encomenda duas vezes.
 *
 * Best-effort como tudo o que é armazenamento de browser (§1, regra 1): sem
 * isto a venda continua a existir, só volta a dar trabalho à pessoa.
 */

type StorageAccess = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const KEY = 'pending_proof';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Doze horas: cobre quem pagou à noite e só recuperou a rede de manhã, e não
 * chega para despejar o fantasma de ontem em cima de quem hoje quer comer.
 */
const TTL_MS = 12 * 60 * 60 * 1000;

export type PendingProof = {
  orderId: string;
  storeSlug: string;
  method: 'mpesa' | 'emola';
  totalCents: number;
  orderNumber: string | null;
};

type Stored = PendingProof & { version: 1; createdAt: number };

function read(storage: StorageAccess): Stored | null {
  try {
    const raw = storage.getItem(KEY);
    if (!raw || raw.length > 10_000) return null;
    const data = JSON.parse(raw);
    if (data?.version !== 1 || typeof data.orderId !== 'string' || !UUID.test(data.orderId)) return null;
    if (typeof data.storeSlug !== 'string' || (data.method !== 'mpesa' && data.method !== 'emola')) return null;
    if (!Number.isSafeInteger(data.totalCents) || data.totalCents < 0) return null;
    if (!Number.isSafeInteger(data.createdAt)) return null;
    return { ...data, orderNumber: typeof data.orderNumber === 'string' ? data.orderNumber : null };
  } catch { return null; }
}

export function rememberPendingProof(storage: StorageAccess, pending: PendingProof): void {
  if (!UUID.test(pending.orderId)) return;
  const entry: Stored = { version: 1, createdAt: Date.now(), ...pending };
  try { storage.setItem(KEY, JSON.stringify(entry)); }
  catch { /* Modo privado: o pedido existe na mesma, só não se recupera o ecrã. */ }
}

/**
 * O pedido por pagar desta loja, se ainda estiver dentro da janela. Uma nota
 * caduca sai do armazenamento — o checkout seguinte abre limpo.
 */
export function readPendingProof(storage: StorageAccess, storeSlug: string): PendingProof | null {
  const pending = read(storage);
  if (!pending) return null;
  if (Date.now() - pending.createdAt > TTL_MS) {
    try { storage.removeItem(KEY); } catch { /* Best-effort. */ }
    return null;
  }
  if (pending.storeSlug !== storeSlug) return null;
  return {
    orderId: pending.orderId, storeSlug: pending.storeSlug, method: pending.method,
    totalCents: pending.totalCents, orderNumber: pending.orderNumber,
  };
}

/** Sem `orderId`, esquece seja qual for. Com ele, só se for mesmo esse pedido. */
export function clearPendingProof(storage: StorageAccess, orderId?: string): void {
  if (orderId && read(storage)?.orderId !== orderId) return;
  try { storage.removeItem(KEY); } catch { /* Best-effort no browser. */ }
}
