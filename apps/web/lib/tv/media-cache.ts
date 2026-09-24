/**
 * Os vídeos da TV descarregam-se UMA vez e ficam no disco da box.
 *
 * Sem isto, um vídeo de 30 MB em ciclo o dia inteiro é descarregado de novo a
 * cada volta — dezenas de GB por dia por TV no tráfego do Supabase — e a TV
 * fica preta no minuto em que a internet da loja cai. Com a Cache API do
 * browser, o vídeo é pedido uma vez, guardado, e tocado a partir do disco:
 * sem internet, a TV continua a passar o que já tinha.
 *
 * O endereço de cada ficheiro nunca muda de conteúdo (`tvMediaPath`), por
 * isso uma entrada em cache nunca fica velha — só deixa de ser precisa, e
 * `pruneTvMediaCache` apaga-a.
 */

const CACHE_NAME = 'tv-media-v1';

/** Endereços já abertos nesta página: um `blob:` por ficheiro, reaproveitado. */
const objectUrls = new Map<string, string>();

function hasCacheApi(): boolean {
  return typeof window !== 'undefined' && 'caches' in window;
}

/**
 * Um endereço que o `<video>` pode tocar sem voltar à rede.
 *
 * - em cache → `blob:` a partir do disco;
 * - não está → descarrega, guarda, e devolve o `blob:`;
 * - sem Cache API ou sem espaço → o endereço original (toca em streaming);
 * - sem rede e sem cópia → `null` (a TV salta este ficheiro).
 */
export async function loadTvMedia(url: string): Promise<string | null> {
  const aberto = objectUrls.get(url);
  if (aberto) return aberto;
  if (!hasCacheApi()) return url;

  try {
    const cache = await caches.open(CACHE_NAME);
    let resposta = await cache.match(url);
    if (!resposta) {
      const rede = await fetch(url, { mode: 'cors', cache: 'no-store' });
      if (!rede.ok) return null;
      try {
        await cache.put(url, rede);
        resposta = await cache.match(url);
      } catch {
        // Disco cheio: toca em streaming, que é o que havia antes.
        return url;
      }
      if (!resposta) return url;
    }
    const blob = await resposta.blob();
    const objectUrl = URL.createObjectURL(blob);
    objectUrls.set(url, objectUrl);
    return objectUrl;
  } catch {
    return typeof navigator !== 'undefined' && navigator.onLine ? url : null;
  }
}

/** Liberta o que já não está na lista (memória) e, se pedido, apaga do disco. */
export async function pruneTvMediaCache(keep: string[], opts: { disk: boolean }): Promise<void> {
  const manter = new Set(keep);
  for (const [url, objectUrl] of objectUrls) {
    if (manter.has(url)) continue;
    URL.revokeObjectURL(objectUrl);
    objectUrls.delete(url);
  }
  if (!opts.disk || !hasCacheApi()) return;
  try {
    const cache = await caches.open(CACHE_NAME);
    for (const pedido of await cache.keys()) {
      if (!manter.has(pedido.url)) await cache.delete(pedido);
    }
  } catch {
    // Limpar é arrumação: se falhar, fica para a próxima.
  }
}
