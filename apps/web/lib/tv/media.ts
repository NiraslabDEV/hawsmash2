/**
 * Biblioteca de vídeos e imagens das TVs (bucket `tv-media`, migration 1090).
 *
 * A biblioteca é da empresa, como o cardápio: carrega-se um vídeo uma vez e
 * põe-se nas TVs das lojas que se quiser. O que cada TV passa é da loja.
 *
 * Só MP4/WebM e JPG/PNG/WebP: é o que toca em qualquer box Android e em
 * qualquer browser de TV. Um .mov que toca no PC do dono e fica preto na TV
 * da loja é o telefonema que isto evita.
 */

export const TV_MEDIA_BUCKET = 'tv-media';

/** Igual ao `file_size_limit` do bucket (1090). O projecto pode ter um tecto menor — ver B-113. */
export const TV_MEDIA_MAX_BYTES = 200 * 1024 * 1024;

const TIPOS: Record<string, { kind: 'video' | 'image'; ext: string }> = {
  'video/mp4': { kind: 'video', ext: 'mp4' },
  'video/webm': { kind: 'video', ext: 'webm' },
  'image/jpeg': { kind: 'image', ext: 'jpg' },
  'image/png': { kind: 'image', ext: 'png' },
  'image/webp': { kind: 'image', ext: 'webp' },
};

export const TV_MEDIA_ACCEPT = Object.keys(TIPOS).join(',');

export function mediaKindFromMime(mime: string): 'video' | 'image' | null {
  return TIPOS[mime]?.kind ?? null;
}

export function tvMediaUploadError(file: { type: string; size: number }): string | null {
  if (!mediaKindFromMime(file.type)) {
    return 'Formato não suportado. Usa vídeo MP4 ou WebM, ou imagem JPG, PNG ou WebP.';
  }
  if (file.size <= 0) return 'O ficheiro está vazio.';
  if (file.size > TV_MEDIA_MAX_BYTES) {
    return `O ficheiro tem ${formatBytes(file.size)}; o máximo é ${formatBytes(TV_MEDIA_MAX_BYTES)}. Exporta o vídeo em 1080p.`;
  }
  return null;
}

/**
 * Caminho no bucket. Um nome novo por ficheiro, nunca reescrito: a TV guarda o
 * vídeo em cache pelo endereço, e um endereço que muda de conteúdo mostrava o
 * vídeo antigo para sempre.
 */
export function tvMediaPath(id: string, _originalName: string, mime: string): string {
  return `media/${id}.${TIPOS[mime]?.ext ?? 'bin'}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const unidades = ['KB', 'MB', 'GB'];
  let valor = bytes / 1024;
  let i = 0;
  while (valor >= 1024 && i < unidades.length - 1) {
    valor /= 1024;
    i += 1;
  }
  return `${valor.toLocaleString('pt-PT', { maximumFractionDigits: 1 })} ${unidades[i]}`;
}
