import { TV_MEDIA_BUCKET, formatBytes, mediaKindFromMime, tvMediaPath, tvMediaUploadError } from '@/lib/tv/media';
import type { createClient } from '@/utils/supabase/client';

type Supabase = ReturnType<typeof createClient>;

export function uploadErrorText(raw: string): string {
  const texto = raw.toLowerCase();
  if (texto.includes('exceeded') || texto.includes('too large') || texto.includes('413')) {
    return 'O ficheiro é maior do que o servidor aceita. Exporta o vídeo em 1080p (ou mais curto) e tenta outra vez.';
  }
  if (texto.includes('mime') || texto.includes('type')) {
    return 'Formato não suportado. Usa vídeo MP4 ou WebM, ou imagem JPG, PNG ou WebP.';
  }
  if (texto.includes('row-level security') || texto.includes('unauthorized') || texto.includes('403')) {
    return 'Só o dono e os gerentes carregam vídeos para as TVs.';
  }
  return `Não foi possível carregar: ${raw}`;
}

/**
 * Carrega os ficheiros para o bucket e regista-os na biblioteca (1090), um a
 * um. Devolve os ids registados, pela ordem, e os erros ficheiro a ficheiro —
 * um ficheiro recusado não impede os outros.
 */
export async function uploadTvFiles(
  supabase: Supabase,
  files: File[],
  onProgress: (text: string | null) => void,
): Promise<{ ids: string[]; errors: string[] }> {
  const ids: string[] = [];
  const errors: string[] = [];
  for (const [i, file] of files.entries()) {
    const erro = tvMediaUploadError(file);
    if (erro) {
      errors.push(`${file.name}: ${erro}`);
      continue;
    }
    onProgress(`A carregar ${file.name} (${i + 1} de ${files.length}, ${formatBytes(file.size)})…`);
    const path = tvMediaPath(crypto.randomUUID(), file.name, file.type);
    const { error } = await supabase.storage.from(TV_MEDIA_BUCKET).upload(path, file, {
      // O endereço nunca muda de conteúdo: pode ficar em cache para sempre.
      cacheControl: '31536000',
      contentType: file.type,
      upsert: false,
    });
    if (error) {
      errors.push(`${file.name}: ${uploadErrorText(error.message)}`);
      continue;
    }
    const nome = file.name.replace(/\.[^.]+$/, '').trim().slice(0, 120) || 'Sem nome';
    const { data, error: registo } = await supabase.rpc('register_tv_media', {
      p_kind: mediaKindFromMime(file.type),
      p_name: nome,
      p_path: path,
      p_mime: file.type,
      p_size: file.size,
    });
    if (registo || !data) {
      // Sem registo, o ficheiro seria um órfão no bucket.
      await supabase.storage.from(TV_MEDIA_BUCKET).remove([path]);
      errors.push(`${file.name}: não ficou registado (${registo?.message ?? 'sem resposta'}).`);
      continue;
    }
    ids.push((data as { id: string }).id);
  }
  onProgress(null);
  return { ids, errors };
}
