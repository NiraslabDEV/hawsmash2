/**
 * O POS apanha as versões novas sozinho.
 *
 * O POS é um quiosque: a página abre uma vez e fica aberta dias. Cada melhoria
 * publicada no Railway só chegava ao balcão quando alguém fechava e abria o
 * programa — o "esgotado" em tempo real (1070) incluído (Maputo, 24 Set).
 *
 * Agora o POS pergunta a versão ao servidor (`/api/version`) e, quando muda,
 * recarrega-se — mas SÓ num momento em que não estraga nada: carrinho vazio,
 * sem pagamento, janela ou teclado abertos, e com rede (sem rede o recarregar
 * cairia na página guardada e não trazia nada de novo). Uma venda a meio
 * nunca é interrompida (Regra 1); a fila offline vive no IndexedDB e
 * sobrevive ao recarregar.
 */

export const VERSION_CHECK_MS = 60_000;

/** A versão deste build — o mesmo valor que `/api/version` devolve (next.config). */
export const CURRENT_BUILD = process.env.NEXT_PUBLIC_APP_BUILD ?? null;

/** Há versão nova publicada? Sem informação de um dos lados, não. */
export function isNewBuild(current: string | null, latest: string | null): boolean {
  return !!current && !!latest && current !== latest;
}

/** Pode recarregar agora sem estragar uma venda? */
export function canReloadNow(input: {
  cartEmpty: boolean;
  /** Pagamento, funil do upsell, confirmação, teclado ou outra janela aberta. */
  busy: boolean;
  online: boolean;
}): boolean {
  return input.cartEmpty && !input.busy && input.online;
}

/** Nunca mais do que um recarregar automático neste intervalo. */
export const MIN_RELOAD_GAP_MS = 10 * 60_000;
const RELOAD_KEY = 'pos_auto_reload_at';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

/**
 * Travão contra ciclos: se o POS já se recarregou sozinho há pouco, não o faz
 * outra vez — mesmo que a versão continue a parecer diferente. Um POS que se
 * recarrega sem parar é um balcão parado; um POS com a versão de ontem vende.
 * Sem storage (bloqueado), não recarrega: na dúvida, fica como está.
 */
export function reloadAllowed(storage: StorageLike | null, now = Date.now()): boolean {
  if (!storage) return false;
  try {
    const ultimo = Number(storage.getItem(RELOAD_KEY));
    return !Number.isFinite(ultimo) || now - ultimo >= MIN_RELOAD_GAP_MS;
  } catch {
    return false;
  }
}

export function markReload(storage: StorageLike | null, now = Date.now()): void {
  try {
    storage?.setItem(RELOAD_KEY, String(now));
  } catch {
    // Sem storage: o `reloadAllowed` já recusa na próxima.
  }
}

/** A versão publicada agora. `null` se não der para saber — nunca lança. */
export async function fetchLatestBuild(fetcher: typeof fetch = fetch): Promise<string | null> {
  try {
    const response = await fetcher('/api/version', { cache: 'no-store' });
    if (!response.ok) return null;
    const body = (await response.json()) as { build?: unknown };
    return typeof body.build === 'string' && body.build ? body.build : null;
  } catch {
    return null;
  }
}
