/**
 * Fotos do cardápio entram em WebP.
 *
 * Postas tal como vinham do telemóvel ou do designer, eram PNG de 2 MB que o POS,
 * o site e o telemóvel do garçom descarregavam por inteiro (1136). Aqui o painel
 * reduz a foto no próprio browser antes de a enviar: no máximo 900 px no lado
 * maior, WebP q0.8, com o fundo transparente intacto.
 *
 * Best-effort: se o browser não souber gerar WebP (o canvas devolve PNG), se a
 * imagem não abrir, ou se o resultado não ficar mais pequeno, segue o ficheiro
 * original. Nunca impede de gravar a foto.
 */

export const FOTO_LADO_MAX = 900;
export const FOTO_QUALIDADE = 0.8;

/** Medida final, sem aumentar a imagem e mantendo a proporção. */
export function medidaFinal(largura: number, altura: number, max = FOTO_LADO_MAX) {
  const maior = Math.max(largura, altura);
  if (maior <= max) return { largura, altura };
  const f = max / maior;
  return { largura: Math.max(1, Math.round(largura * f)), altura: Math.max(1, Math.round(altura * f)) };
}

/** Só JPEG e PNG passam pela conversão; GIF e SVG perderiam o que têm. */
export function convertivel(tipo: string) {
  return tipo === 'image/jpeg' || tipo === 'image/png' || tipo === 'image/webp';
}

/** Escolhe o que enviar: o WebP só quando é mesmo WebP e mais pequeno. */
export function escolherFicheiro(original: Blob, convertido: Blob | null): { blob: Blob; ext: string } {
  if (convertido && convertido.type === 'image/webp' && convertido.size < original.size) {
    return { blob: convertido, ext: 'webp' };
  }
  return { blob: original, ext: extensaoDe(original) };
}

function extensaoDe(f: Blob) {
  const nome = (f as File).name;
  const ext = nome?.split('.').pop()?.toLowerCase();
  if (ext && ext !== nome?.toLowerCase()) return ext;
  return f.type === 'image/png' ? 'png' : f.type === 'image/webp' ? 'webp' : 'jpg';
}

/** Converte no browser. Devolve o ficheiro a enviar e a extensão do caminho. */
export async function fotoParaWebp(ficheiro: File): Promise<{ blob: Blob; ext: string }> {
  if (!convertivel(ficheiro.type) || typeof createImageBitmap !== 'function') {
    return escolherFicheiro(ficheiro, null);
  }
  try {
    const bitmap = await createImageBitmap(ficheiro);
    const { largura, altura } = medidaFinal(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = largura;
    canvas.height = altura;
    const ctx = canvas.getContext('2d');
    if (!ctx) return escolherFicheiro(ficheiro, null);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, largura, altura);
    bitmap.close();
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/webp', FOTO_QUALIDADE));
    return escolherFicheiro(ficheiro, blob);
  } catch {
    return escolherFicheiro(ficheiro, null);
  }
}
