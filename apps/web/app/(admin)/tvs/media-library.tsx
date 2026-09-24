'use client';

import { useRef, useState } from 'react';

import {
  TV_MEDIA_ACCEPT,
  TV_MEDIA_BUCKET,
  TV_MEDIA_MAX_BYTES,
  formatBytes,
  mediaKindFromMime,
  tvMediaPath,
  tvMediaUploadError,
} from '@/lib/tv/media';
import type { createClient } from '@/utils/supabase/client';

import type { LibraryItem } from './tv-editor';
import { Section, type Message } from './ui';

type Supabase = ReturnType<typeof createClient>;

/** Onde cada ficheiro está a passar — para ninguém apagar às cegas. */
export type MediaUsage = Map<string, string[]>;

function uploadErrorText(raw: string): string {
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
 * A biblioteca é da empresa (1090): um vídeo carregado aqui pode passar em
 * qualquer TV, de qualquer loja. Apaga quem o carregou, ou o dono.
 */
export function MediaLibrary({
  supabase,
  library,
  usage,
  canDelete,
  onChanged,
  onMessage,
}: {
  supabase: Supabase;
  library: LibraryItem[];
  usage: MediaUsage;
  canDelete: (item: LibraryItem) => boolean;
  onChanged: () => Promise<void>;
  onMessage: (message: Message) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<string | null>(null);

  async function upload(files: FileList) {
    let carregados = 0;
    for (const [i, file] of Array.from(files).entries()) {
      const erro = tvMediaUploadError(file);
      if (erro) {
        onMessage({ tone: 'error', text: `${file.name}: ${erro}` });
        continue;
      }
      setProgress(`A carregar ${file.name} (${i + 1} de ${files.length}, ${formatBytes(file.size)})…`);
      const path = tvMediaPath(crypto.randomUUID(), file.name, file.type);
      const { error } = await supabase.storage.from(TV_MEDIA_BUCKET).upload(path, file, {
        // O endereço nunca muda de conteúdo: pode ficar em cache para sempre.
        cacheControl: '31536000',
        contentType: file.type,
        upsert: false,
      });
      if (error) {
        onMessage({ tone: 'error', text: `${file.name}: ${uploadErrorText(error.message)}` });
        continue;
      }
      const nome = file.name.replace(/\.[^.]+$/, '').trim().slice(0, 120) || 'Sem nome';
      const { error: registo } = await supabase.rpc('register_tv_media', {
        p_kind: mediaKindFromMime(file.type),
        p_name: nome,
        p_path: path,
        p_mime: file.type,
        p_size: file.size,
      });
      if (registo) {
        // Sem registo, o ficheiro seria um órfão no bucket.
        await supabase.storage.from(TV_MEDIA_BUCKET).remove([path]);
        onMessage({ tone: 'error', text: `${file.name}: não ficou registado (${registo.message}).` });
        continue;
      }
      carregados += 1;
    }
    setProgress(null);
    if (input.current) input.current.value = '';
    if (carregados > 0) {
      onMessage({
        tone: 'ok',
        text:
          carregados === 1
            ? 'Ficheiro carregado. Junta-o às TVs na secção “Vídeos desta TV”.'
            : `${carregados} ficheiros carregados. Junta-os às TVs na secção “Vídeos desta TV”.`,
      });
    }
    await onChanged();
  }

  async function remove(item: LibraryItem) {
    const onde = usage.get(item.id) ?? [];
    const aviso = onde.length > 0 ? `\n\nEstá a passar em: ${onde.join(', ')}. Sai dessas TVs.` : '';
    if (!window.confirm(`Apagar “${item.name}” da biblioteca?${aviso}`)) return;
    const { data, error } = await supabase.rpc('delete_tv_media', { p_media_id: item.id });
    if (error) {
      onMessage({
        tone: 'error',
        text: error.message.includes('tv_media_denied')
          ? 'Só o dono ou quem carregou o ficheiro o pode apagar.'
          : `Não foi possível apagar: ${error.message}`,
      });
      return;
    }
    const path = (data as { storage_path: string }).storage_path;
    const { error: storageError } = await supabase.storage.from(TV_MEDIA_BUCKET).remove([path]);
    onMessage(
      storageError
        ? { tone: 'error', text: `Saiu da biblioteca, mas o ficheiro ficou no servidor (${storageError.message}).` }
        : { tone: 'ok', text: `“${item.name}” apagado.` },
    );
    await onChanged();
  }

  return (
    <Section
      title="Biblioteca de vídeos e imagens"
      hint={`Partilhada pelas lojas. Vídeo MP4 ou WebM (1080p, até ${formatBytes(TV_MEDIA_MAX_BYTES)}); imagem JPG, PNG ou WebP. Cada TV descarrega o ficheiro uma vez e continua a passá-lo sem internet.`}
    >
      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={input}
          type="file"
          multiple
          accept={TV_MEDIA_ACCEPT}
          className="hidden"
          onChange={(event) => {
            if (event.target.files?.length) void upload(event.target.files);
          }}
        />
        <button
          type="button"
          disabled={progress !== null}
          onClick={() => input.current?.click()}
          className="rounded-xl bg-[#e5a93c] px-5 py-2.5 text-sm font-black text-black disabled:opacity-40"
        >
          Carregar vídeo ou imagem
        </button>
        {progress && (
          <span role="status" className="animate-pulse text-sm text-[#C9BCAC]">
            {progress}
          </span>
        )}
      </div>

      {library.length === 0 ? (
        <p className="rounded-xl bg-white/[0.03] px-4 py-3 text-sm text-[#8b8378]">A biblioteca está vazia.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {library.map((item) => {
            const onde = usage.get(item.id) ?? [];
            return (
              <li key={item.id} className="overflow-hidden rounded-xl border border-white/10">
                <div className="aspect-video bg-black">
                  {item.kind === 'image' ? (
                    // eslint-disable-next-line @next/next/no-img-element -- miniatura do bucket
                    <img src={item.url} alt="" className="h-full w-full object-contain" />
                  ) : (
                    <video src={item.url} controls muted preload="metadata" className="h-full w-full object-contain" />
                  )}
                </div>
                <div className="space-y-1 p-3">
                  <p className="truncate text-sm font-bold text-white" title={item.name}>
                    {item.name}
                  </p>
                  <p className="text-xs text-[#8b8378]">
                    {item.kind === 'video' ? 'Vídeo' : 'Imagem'} · {formatBytes(item.size_bytes)} ·{' '}
                    {new Date(item.created_at).toLocaleDateString('pt-PT')}
                  </p>
                  <p className="text-xs text-[#C9BCAC]">{onde.length > 0 ? `Em ${onde.join(', ')}` : 'Em nenhuma TV'}</p>
                  {canDelete(item) && (
                    <button
                      type="button"
                      onClick={() => void remove(item)}
                      className="mt-1 text-xs font-bold text-[#ffb0b0] hover:underline"
                    >
                      Apagar
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}
