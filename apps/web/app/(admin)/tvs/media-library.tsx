'use client';

import { useRef, useState } from 'react';

import { TV_MEDIA_ACCEPT, TV_MEDIA_BUCKET, TV_MEDIA_MAX_BYTES, formatBytes } from '@/lib/tv/media';
import type { createClient } from '@/utils/supabase/client';

import type { LibraryItem } from './tv-editor';
import { Section, type Message } from './ui';
import { uploadTvFiles } from './upload';

type Supabase = ReturnType<typeof createClient>;

/** Onde cada ficheiro está a passar — para ninguém apagar às cegas. */
export type MediaUsage = Map<string, string[]>;

/** Uma TV da loja escolhida, vista pela biblioteca. */
export type LibraryTv = {
  id: string;
  name: string;
  /** O que a TV passa agora (a do editor conta com o rascunho). */
  mediaIds: Set<string>;
};

/**
 * A biblioteca é da empresa (1090): um vídeo ou imagem carregado aqui pode
 * passar em qualquer TV, de qualquer loja. Cada ficheiro tem um botão por TV
 * da loja escolhida — um clique põe-no (ou tira-o) dessa TV e grava logo.
 * Apaga quem o carregou, ou o dono.
 */
export function MediaLibrary({
  supabase,
  library,
  usage,
  tvs,
  storeName,
  busy,
  canDelete,
  onToggleTv,
  onChanged,
  onMessage,
}: {
  supabase: Supabase;
  library: LibraryItem[];
  usage: MediaUsage;
  tvs: LibraryTv[];
  storeName: string | null;
  busy: boolean;
  canDelete: (item: LibraryItem) => boolean;
  onToggleTv: (item: LibraryItem, tvId: string, add: boolean) => Promise<void>;
  onChanged: () => Promise<void>;
  onMessage: (message: Message) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<string | null>(null);

  async function upload(files: FileList) {
    const { ids, errors } = await uploadTvFiles(supabase, Array.from(files), setProgress);
    if (input.current) input.current.value = '';
    await onChanged();
    if (errors.length > 0) {
      onMessage({ tone: 'error', text: errors.join(' ') });
    } else if (ids.length > 0) {
      onMessage({
        tone: 'ok',
        text: `${ids.length === 1 ? 'Ficheiro carregado' : `${ids.length} ficheiros carregados`}. Agora escolhe em que TV passa: botões “+ TV” em cada ficheiro, abaixo.`,
      });
    }
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
      hint={`Partilhada pelas lojas. Vídeo MP4 ou WebM (1080p, até ${formatBytes(TV_MEDIA_MAX_BYTES)}); imagem JPG, PNG ou WebP. Depois de carregar, carrega em “+ TV” para o pôr a passar. Cada TV descarrega o ficheiro uma vez e continua a passá-lo sem internet.`}
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
                <div className="space-y-2 p-3">
                  <div>
                    <p className="truncate text-sm font-bold text-white" title={item.name}>
                      {item.name}
                    </p>
                    <p className="text-xs text-[#8b8378]">
                      {item.kind === 'video' ? 'Vídeo' : 'Imagem'} · {formatBytes(item.size_bytes)} ·{' '}
                      {new Date(item.created_at).toLocaleDateString('pt-PT')}
                    </p>
                  </div>

                  {tvs.length > 0 && (
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-wide text-[#8b8378]">
                        Passar nas TVs{storeName ? ` de ${storeName}` : ''}
                      </p>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {tvs.map((tv) => {
                          const passa = tv.mediaIds.has(item.id);
                          return (
                            <button
                              key={tv.id}
                              type="button"
                              disabled={busy}
                              aria-pressed={passa}
                              title={passa ? `Tirar de ${tv.name}` : `Pôr a passar em ${tv.name}`}
                              onClick={() => void onToggleTv(item, tv.id, !passa)}
                              className={`rounded-lg border px-2.5 py-1 text-xs font-black transition disabled:opacity-40 ${
                                passa
                                  ? 'border-[#e5a93c] bg-[#e5a93c] text-black'
                                  : 'border-white/15 text-[#C9BCAC] hover:bg-white/[0.06]'
                              }`}
                            >
                              {passa ? `✓ ${tv.name}` : `+ ${tv.name}`}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <p className="text-xs text-[#C9BCAC]">{onde.length > 0 ? `A passar em ${onde.join(', ')}` : 'Ainda não passa em nenhuma TV'}</p>
                  {canDelete(item) && (
                    <button
                      type="button"
                      onClick={() => void remove(item)}
                      className="text-xs font-bold text-[#ffb0b0] hover:underline"
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
