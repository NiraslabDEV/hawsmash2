'use client';

/**
 * Aba TVs — os ecrãs de cada loja, as senhas e os vídeos.
 *
 * Cada TV é uma linha em `store_tvs` (migration 1090) com endereço próprio
 * (`/tv/maputo/tv1`). O que aqui se grava vai por `save_store_tv`, fica no
 * `event_log` com quem mudou, e chega à TV em até 30 s — sem tocar na box.
 *
 * A biblioteca de vídeos é da empresa; o que cada TV passa é da loja.
 * O painel limpa o que grava com o mesmo `resolveTvConfig` com que a TV lê.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { TV_MEDIA_BUCKET } from '@/lib/tv/media';
import type { TvPreviewDraft } from '@/lib/tv/preview';
import {
  TV_LIMITS,
  TV_MODE_NAMES,
  isTvMode,
  modeShowsVideos,
  nextFreeTvSlug,
  resolveTvConfig,
  tvScreenPath,
  tvSlugError,
  tvStatus,
} from '@/lib/tv/settings';
import { createClient } from '@/utils/supabase/client';

import { MediaLibrary, type LibraryTv, type MediaUsage } from './media-library';
import { TvEditor, type LibraryItem, type TvDraft } from './tv-editor';
import { Banner, TvPreview, type Message } from './ui';
import { uploadTvFiles } from './upload';

type StoreRow = { id: string; slug: string; short_name: string };

type TvRow = {
  id: string;
  store_id: string;
  slug: string;
  name: string;
  mode: string;
  config: unknown;
  active: boolean;
  sort: number;
  last_seen_at: string | null;
  updated_at: string;
};

const TV_SELECT = 'id,store_id,slug,name,mode,config,active,sort,last_seen_at,updated_at';
const MEDIA_SELECT = 'id,kind,name,storage_path,mime,size_bytes,created_at,created_by';
/** O painel relê as TVs para o "ligada / sem sinal" não mentir. */
const STATUS_REFRESH_MS = 30_000;

function rowToDraft(row: TvRow): TvDraft {
  return {
    name: row.name,
    slug: row.slug,
    mode: isTvMode(row.mode) ? row.mode : 'senhas',
    active: row.active,
    config: resolveTvConfig(row.config),
  };
}

function quando(iso: string): string {
  return new Date(iso).toLocaleString('pt-PT', {
    timeZone: 'Africa/Maputo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function saveErrorText(raw: string): string {
  if (raw.includes('tv_denied')) return 'Só o dono ou o gerente desta loja mudam as TVs.';
  if (raw.includes('tv_slug_taken')) return 'Já há uma TV com esse endereço nesta loja. Escolhe outro.';
  if (raw.includes('invalid_tv_slug')) return 'O endereço só pode ter letras minúsculas, números e hífen.';
  if (raw.includes('invalid_tv_name')) return 'Dá um nome à TV.';
  if (raw.includes('tv_limit_reached')) return `Esta loja já tem ${TV_LIMITS.tvsPerStore} TVs.`;
  if (raw.includes('tv_not_found')) return 'Esta TV já não existe — alguém a apagou. Recarrega a página.';
  return `Não foi possível guardar: ${raw}`;
}

export default function TvsPage() {
  const supabase = useMemo(() => createClient(), []);

  const [stores, setStores] = useState<StoreRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [allTvs, setAllTvs] = useState<TvRow[]>([]);
  const [library, setLibrary] = useState<LibraryItem[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<TvDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const [previewKey, setPreviewKey] = useState(0);
  const [now, setNow] = useState(() => new Date());
  const [origin, setOrigin] = useState('');
  const [uploading, setUploading] = useState<string | null>(null);
  /** A biblioteca e o rascunho mais recentes, para quem grava depois de um `await`. */
  const libraryRef = useRef<LibraryItem[] | null>(null);
  const draftRef = useRef<TvDraft | null>(null);
  draftRef.current = draft;

  useEffect(() => setOrigin(window.location.origin), []);

  const loadStores = useCallback(async () => {
    const { data, error } = await supabase.from('stores').select('id,slug,short_name').order('sort');
    if (error) {
      setMessage({ tone: 'error', text: `Não foi possível listar as lojas: ${error.message}` });
      return;
    }
    setStores(data ?? []);
    setSelectedId((current) => current ?? data?.[0]?.id ?? null);
  }, [supabase]);

  const loadTvs = useCallback(async () => {
    const { data, error } = await supabase.from('store_tvs').select(TV_SELECT).order('sort').order('created_at');
    if (error) {
      setMessage({ tone: 'error', text: `Não foi possível ler as TVs: ${error.message}` });
      return;
    }
    setAllTvs((data ?? []) as TvRow[]);
    setNow(new Date());
  }, [supabase]);

  const loadLibrary = useCallback(async () => {
    const { data, error } = await supabase
      .from('tv_media')
      .select(MEDIA_SELECT)
      .order('created_at', { ascending: false });
    if (error) {
      setMessage({ tone: 'error', text: `Não foi possível ler a biblioteca: ${error.message}` });
      return;
    }
    const itens = (data ?? []).map((item) => ({
      ...(item as Omit<LibraryItem, 'url'>),
      url: supabase.storage.from(TV_MEDIA_BUCKET).getPublicUrl(item.storage_path as string).data.publicUrl,
    }));
    libraryRef.current = itens;
    setLibrary(itens);
  }, [supabase]);

  useEffect(() => {
    void loadStores();
    void loadTvs();
    void loadLibrary();
    void supabase.auth.getUser().then(async ({ data }) => {
      const id = data.user?.id ?? null;
      setUserId(id);
      if (!id) return;
      const { data: profile } = await supabase.from('staff_profiles').select('role').eq('user_id', id).maybeSingle();
      setRole((profile?.role as string | undefined) ?? null);
    });
  }, [loadLibrary, loadStores, loadTvs, supabase]);

  useEffect(() => {
    const timer = window.setInterval(() => void loadTvs(), STATUS_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [loadTvs]);

  const store = stores.find((s) => s.id === selectedId) ?? null;
  const tvs = allTvs.filter((tv) => tv.store_id === selectedId);
  const editing = tvs.find((tv) => tv.id === editingId) ?? null;
  const saved = editing ? rowToDraft(editing) : null;
  const dirty = !!draft && !!saved && JSON.stringify(draft) !== JSON.stringify(saved);

  // Onde passa cada ficheiro, com o nome da loja quando há mais do que uma.
  const usage: MediaUsage = useMemo(() => {
    const mapa: MediaUsage = new Map();
    for (const tv of allTvs) {
      const loja = stores.find((s) => s.id === tv.store_id)?.short_name;
      const rotulo = stores.length > 1 && loja ? `${loja} · ${tv.name}` : tv.name;
      for (const item of resolveTvConfig(tv.config).videos.playlist) {
        mapa.set(item.mediaId, [...(mapa.get(item.mediaId) ?? []), rotulo]);
      }
    }
    return mapa;
  }, [allTvs, stores]);

  // O que a miniatura desenha: o rascunho, com os ficheiros da lista dele.
  const previewDraft = useMemo<TvPreviewDraft | null>(() => {
    if (!draft) return null;
    const naLista = new Set(draft.config.videos.playlist.map((item) => item.mediaId));
    return {
      mode: draft.mode,
      active: draft.active,
      config: draft.config,
      media: library
        .filter((item) => naLista.has(item.id))
        .map(({ id, kind, storage_path, name }) => ({ id, kind, storage_path, name })),
    };
  }, [draft, library]);

  // As TVs da loja escolhida, como a biblioteca as vê: a do editor com o rascunho.
  const libraryTvs: LibraryTv[] = tvs.map((tv) => ({
    id: tv.id,
    name: tv.name,
    mediaIds: new Set(
      (tv.id === editingId && draft ? draft.config : resolveTvConfig(tv.config)).videos.playlist.map((item) => item.mediaId),
    ),
  }));

  function confirmLeave(): boolean {
    return !dirty || window.confirm('Há alterações por guardar nesta TV. Sair sem guardar?');
  }

  function openEditor(tv: TvRow | null) {
    if (tv?.id === editingId) return;
    if (!confirmLeave()) return;
    setEditingId(tv?.id ?? null);
    setDraft(tv ? rowToDraft(tv) : null);
    setMessage(null);
  }

  async function createTv(base?: TvRow) {
    if (!selectedId || !confirmLeave()) return;
    if (tvs.length >= TV_LIMITS.tvsPerStore) {
      setMessage({ tone: 'error', text: `Esta loja já tem ${TV_LIMITS.tvsPerStore} TVs.` });
      return;
    }
    const slug = nextFreeTvSlug(tvs.map((tv) => tv.slug));
    const nome = base ? `${base.name} (cópia)`.slice(0, TV_LIMITS.nameMax) : `TV ${slug.replace(/^tv/, '')}`;
    setBusy(true);
    const { data, error } = await supabase.rpc('save_store_tv', {
      p_store_id: selectedId,
      p_tv_id: null,
      p_name: nome,
      p_slug: slug,
      p_mode: base && isTvMode(base.mode) ? base.mode : 'senhas_videos',
      p_active: base?.active ?? true,
      p_config: base ? resolveTvConfig(base.config) : {},
    });
    setBusy(false);
    if (error) {
      setMessage({ tone: 'error', text: saveErrorText(error.message) });
      return;
    }
    const nova = data as TvRow;
    await loadTvs();
    setEditingId(nova.id);
    setDraft(rowToDraft(nova));
    setMessage({
      tone: 'ok',
      text: `${nome} criada. Abre ${tvScreenPath(store?.slug ?? '', slug)} na box da TV.`,
    });
  }

  /**
   * Grava uma TV com este rascunho. É o caminho de Guardar, dos botões
   * "+ TV" da biblioteca e de "Carregar para esta TV" — um só, com a mesma
   * limpeza e as mesmas mensagens.
   */
  async function persist(tv: TvRow, next: TvDraft, okText: (gravada: TvRow) => string): Promise<boolean> {
    if (!selectedId || tv.store_id !== selectedId) return false;
    const erroSlug = tvSlugError(next.slug);
    if (erroSlug) {
      setMessage({ tone: 'error', text: erroSlug });
      return false;
    }
    // Ficheiros apagados da biblioteca saem da lista — só se a biblioteca foi lida.
    const biblioteca = libraryRef.current;
    const naBiblioteca = new Set((biblioteca ?? []).map((item) => item.id));
    const config = resolveTvConfig({
      ...next.config,
      videos: {
        ...next.config.videos,
        playlist: biblioteca
          ? next.config.videos.playlist.filter((item) => naBiblioteca.has(item.mediaId))
          : next.config.videos.playlist,
      },
    });
    setBusy(true);
    setMessage(null);
    const { data, error } = await supabase.rpc('save_store_tv', {
      p_store_id: selectedId,
      p_tv_id: tv.id,
      p_name: next.name.trim(),
      p_slug: next.slug,
      p_mode: next.mode,
      p_active: next.active,
      p_config: config,
    });
    setBusy(false);
    if (error) {
      setMessage({ tone: 'error', text: saveErrorText(error.message) });
      return false;
    }
    const gravada = data as TvRow;
    setAllTvs((lista) => lista.map((row) => (row.id === gravada.id ? { ...row, ...gravada } : row)));
    if (gravada.id === editingId) {
      setDraft(rowToDraft(gravada));
      setPreviewKey((k) => k + 1);
    }
    setMessage({ tone: 'ok', text: okText(gravada) });
    return true;
  }

  async function saveTv() {
    if (!draft || !editing) return;
    await persist(editing, draft, (gravada) =>
      gravada.slug !== editing.slug
        ? `Guardado. O endereço mudou: a box tem de abrir ${tvScreenPath(store?.slug ?? '', gravada.slug)}.`
        : 'Guardado. A TV actualiza em até 30 segundos.',
    );
  }

  /** A TV aberta no editor grava com o rascunho dela; as outras, com o que está gravado. */
  function baseDraft(tv: TvRow): TvDraft {
    return tv.id === editingId && draftRef.current ? draftRef.current : rowToDraft(tv);
  }

  function withPlaylist(base: TvDraft, playlist: TvDraft['config']['videos']['playlist']): TvDraft {
    return { ...base, config: { ...base.config, videos: { ...base.config.videos, playlist } } };
  }

  function modeWarning(tv: TvRow, d: TvDraft): string {
    if (modeShowsVideos(d.mode)) return '';
    return ` Atenção: ${tv.name} está em “${TV_MODE_NAMES[d.mode].label}” — muda para “${TV_MODE_NAMES.senhas_videos.label}” ou “${TV_MODE_NAMES.videos.label}” para o ver.`;
  }

  async function togglePlaylist(item: LibraryItem, tvId: string, add: boolean) {
    const tv = tvs.find((row) => row.id === tvId);
    if (!tv) return;
    const base = baseDraft(tv);
    const lista = base.config.videos.playlist;
    if (add && lista.length >= TV_LIMITS.playlistMax) {
      setMessage({ tone: 'error', text: `${tv.name} já tem ${TV_LIMITS.playlistMax} ficheiros na lista.` });
      return;
    }
    const playlist = add
      ? lista.some((entry) => entry.mediaId === item.id)
        ? lista
        : [...lista, { mediaId: item.id, seconds: null }]
      : lista.filter((entry) => entry.mediaId !== item.id);
    const next = withPlaylist(base, playlist);
    await persist(tv, next, () =>
      add
        ? `“${item.name}” está em ${tv.name}. Aparece na TV em até 30 segundos.${modeWarning(tv, next)}`
        : `“${item.name}” saiu de ${tv.name}.`,
    );
  }

  /** Carregar dentro da TV: vai para a biblioteca, entra na lista desta TV e grava. */
  async function uploadHere(files: File[]) {
    if (!editing) return;
    const tv = editing;
    const { ids, errors } = await uploadTvFiles(supabase, files, setUploading);
    await loadLibrary();
    if (ids.length === 0) {
      if (errors.length > 0) setMessage({ tone: 'error', text: errors.join(' ') });
      return;
    }
    const base = baseDraft(tv);
    const lista = base.config.videos.playlist;
    const novos = ids
      .filter((id) => !lista.some((entry) => entry.mediaId === id))
      .map((id) => ({ mediaId: id, seconds: null }));
    const next = withPlaylist(base, [...lista, ...novos].slice(0, TV_LIMITS.playlistMax));
    const ok = await persist(tv, next, () =>
      `${ids.length === 1 ? 'Carregado e já' : `${ids.length} ficheiros carregados e já`} na lista de ${tv.name}. Aparece na TV em até 30 segundos.`,
    );
    if (ok && errors.length > 0) setMessage({ tone: 'error', text: `Alguns não carregaram: ${errors.join(' ')}` });
  }

  async function deleteTv(tv: TvRow) {
    if (!window.confirm(`Apagar “${tv.name}”? A box que abre ${tvScreenPath(store?.slug ?? '', tv.slug)} passa a mostrar “este ecrã não existe”.`)) {
      return;
    }
    setBusy(true);
    const { error } = await supabase.rpc('delete_store_tv', { p_tv_id: tv.id });
    setBusy(false);
    if (error) {
      setMessage({ tone: 'error', text: saveErrorText(error.message) });
      return;
    }
    if (editingId === tv.id) {
      setEditingId(null);
      setDraft(null);
    }
    setMessage({ tone: 'ok', text: `${tv.name} apagada.` });
    await loadTvs();
  }

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setMessage({ tone: 'ok', text: `Endereço copiado: ${url}` });
    } catch {
      setMessage({ tone: 'error', text: `Não deu para copiar. O endereço é ${url}` });
    }
  }

  return (
    <div className={`space-y-6 ${editing ? 'pb-28' : ''}`}>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-white">TVs</h1>
          <p className="text-sm text-[#8b8378]">
            Os ecrãs de cada loja: senhas, vídeos e cardápio. O que mudares aqui chega à TV em até 30 segundos.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {stores.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => {
                if (entry.id === selectedId || !confirmLeave()) return;
                setSelectedId(entry.id);
                setEditingId(null);
                setDraft(null);
                setMessage(null);
              }}
              className={`rounded-xl border px-4 py-2 text-sm font-bold transition ${
                entry.id === selectedId
                  ? 'border-[#e5a93c] bg-[#e5a93c]/15 text-[#e5a93c]'
                  : 'border-white/10 text-[#C9BCAC] hover:bg-white/[0.04]'
              }`}
            >
              {entry.short_name}
            </button>
          ))}
        </div>
      </header>

      <Banner message={message} />

      <details className="rounded-2xl border border-white/[0.08] p-5 text-sm text-[#C9BCAC]">
        <summary className="cursor-pointer font-bold text-white">Como pôr uma TV a funcionar</summary>
        <ol className="mt-3 list-decimal space-y-1.5 pl-5">
          <li>Liga uma box Android (ou mini-PC) à TV por HDMI, na rede da loja.</li>
          <li>
            Abre no browser o endereço da TV (botão <strong>Copiar endereço</strong> abaixo). Fica a mostrar sozinha;
            não é preciso entrar com conta.
          </li>
          <li>
            Põe o browser em ecrã inteiro e a arrancar com a box. Numa box Android, a app <em>Fully Kiosk Browser</em>{' '}
            faz as duas coisas; num mini-PC, o Chrome ou o Edge com <code>--kiosk</code>.
          </li>
          <li>
            Para o toque das senhas: arrancar com <code>--autoplay-policy=no-user-gesture-required</code>, ou carregar
            OK no comando uma vez depois de ligar.
          </li>
          <li>Aqui no painel, a TV passa a “Ligada” em menos de um minuto.</li>
        </ol>
      </details>

      {/* ── As TVs da loja ─────────────────────────────────────────────── */}
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {tvs.map((tv) => {
          const estado = tvStatus(tv.last_seen_at, now);
          const url = `${origin}${tvScreenPath(store?.slug ?? '', tv.slug)}`;
          const aberta = tv.id === editingId;
          const modo = isTvMode(tv.mode) ? TV_MODE_NAMES[tv.mode].label : tv.mode;
          const ficheiros = resolveTvConfig(tv.config).videos.playlist.length;
          return (
            <article
              key={tv.id}
              className={`flex flex-col rounded-2xl border p-5 transition ${
                aberta ? 'border-[#e5a93c] bg-[#e5a93c]/[0.06]' : 'border-white/[0.08]'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-lg font-black text-white">{tv.name}</h2>
                  <p className="text-sm text-[#e5a93c]">{tv.active ? modo : 'Desligada no painel'}</p>
                  {tv.active && isTvMode(tv.mode) && modeShowsVideos(tv.mode) && (
                    <p className={`mt-0.5 text-xs ${ficheiros > 0 ? 'text-[#C9BCAC]' : 'text-[#ffb0b0]'}`}>
                      {ficheiros > 0
                        ? `${ficheiros} ${ficheiros === 1 ? 'vídeo/imagem' : 'vídeos/imagens'} a passar`
                        : 'Sem vídeos nem imagens — “+ TV” na biblioteca'}
                    </p>
                  )}
                </div>
                <span className="flex shrink-0 items-center gap-2 text-xs font-bold">
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${
                      estado === 'online'
                        ? 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.6)]'
                        : estado === 'offline'
                          ? 'bg-red-500'
                          : 'bg-white/30'
                    }`}
                  />
                  <span className={estado === 'online' ? 'text-green-400' : estado === 'offline' ? 'text-red-400' : 'text-[#8b8378]'}>
                    {estado === 'online'
                      ? 'Ligada'
                      : estado === 'offline'
                        ? `Sem sinal desde ${quando(tv.last_seen_at!)}`
                        : 'Ainda não ligada'}
                  </span>
                </span>
              </div>
              <p className="mt-3 break-all rounded-lg bg-black/30 px-3 py-2 font-mono text-xs text-[#C9BCAC]">{url}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => openEditor(aberta ? null : tv)}
                  className={`rounded-xl px-4 py-2 text-sm font-black ${
                    aberta ? 'border border-white/10 text-[#C9BCAC]' : 'bg-[#e5a93c] text-black'
                  }`}
                >
                  {aberta ? 'Fechar' : 'Configurar'}
                </button>
                <button
                  type="button"
                  onClick={() => void copyLink(url)}
                  className="rounded-xl border border-white/10 px-4 py-2 text-sm font-bold text-[#C9BCAC]"
                >
                  Copiar endereço
                </button>
                <a
                  href={`${tvScreenPath(store?.slug ?? '', tv.slug)}?preview=1`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-xl border border-white/10 px-4 py-2 text-sm font-bold text-[#C9BCAC]"
                >
                  Ver
                </a>
              </div>
            </article>
          );
        })}

        {store && (
          <button
            type="button"
            disabled={busy || tvs.length >= TV_LIMITS.tvsPerStore}
            onClick={() => void createTv()}
            className="grid min-h-[10rem] place-items-center rounded-2xl border border-dashed border-white/15 p-5 text-center text-[#C9BCAC] transition hover:bg-white/[0.04] disabled:opacity-40"
          >
            <span>
              <span className="block text-3xl font-black text-[#e5a93c]">+</span>
              <span className="block text-sm font-bold">Adicionar TV em {store.short_name}</span>
            </span>
          </button>
        )}
      </section>

      {/* ── A TV aberta ────────────────────────────────────────────────── */}
      {editing && draft && store && (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
          <TvEditor
            draft={draft}
            library={library}
            onUploadHere={uploadHere}
            uploading={uploading}
            onChange={(update) => {
              setDraft((current) => (current ? update(current) : current));
              setMessage(null);
            }}
          />
          <aside className="space-y-4 xl:sticky xl:top-20 xl:self-start">
            <div className="rounded-2xl border border-white/[0.08] p-4">
              <p className="mb-3 text-xs font-bold uppercase tracking-wide text-[#8b8378]">
                Pré-visualização ao vivo
              </p>
              <TvPreview
                key={`${editing.id}-${previewKey}`}
                src={`${tvScreenPath(store.slug, editing.slug)}?preview=1`}
                rotation={draft.config.screen.rotation}
                draft={previewDraft}
              />
              <p className={`mt-2 text-xs ${dirty ? 'font-bold text-[#e5a93c]' : 'text-[#8b8378]'}`}>
                {dirty
                  ? 'Assim fica depois de guardar. A TV da loja só muda quando carregares em Guardar.'
                  : 'É o que a TV da loja está a mostrar (as senhas são as de agora).'}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void createTv(editing)}
                className="rounded-xl border border-white/10 px-4 py-2 text-sm font-bold text-[#C9BCAC] disabled:opacity-40"
              >
                Duplicar esta TV
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void deleteTv(editing)}
                className="rounded-xl border border-[#7a2b2b] px-4 py-2 text-sm font-bold text-[#ffb0b0] disabled:opacity-40"
              >
                Apagar esta TV
              </button>
            </div>
          </aside>
        </div>
      )}

      <MediaLibrary
        supabase={supabase}
        library={library}
        usage={usage}
        tvs={libraryTvs}
        storeName={store?.short_name ?? null}
        busy={busy || uploading !== null}
        onToggleTv={togglePlaylist}
        canDelete={(item) => role === 'owner' || (!!userId && item.created_by === userId)}
        onChanged={loadLibrary}
        onMessage={setMessage}
      />

      {/* ── Barra de guardar ───────────────────────────────────────────── */}
      {editing && draft && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-white/10 bg-[#0f0e0c]/95 px-4 py-3 backdrop-blur lg:left-64">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
            {/* O resultado aparece aqui também: com a página a descer, o aviso do topo não se vê. */}
            <span
              role={message ? (message.tone === 'error' ? 'alert' : 'status') : undefined}
              className={`max-w-xl text-xs ${
                message ? (message.tone === 'error' ? 'font-bold text-[#ffb0b0]' : 'font-bold text-[#a8e0b6]') : dirty ? 'font-bold text-[#e5a93c]' : 'text-[#8b8378]'
              }`}
            >
              {message
                ? message.text
                : `${editing.name} · ${dirty ? 'Alterações por guardar — a TV só muda depois de Guardar' : `Guardado ${new Date(editing.updated_at).toLocaleString('pt-PT')}`}`}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy || !dirty}
                onClick={() => setDraft(saved)}
                className="rounded-xl border border-white/10 px-4 py-2.5 text-sm font-bold text-[#C9BCAC] disabled:opacity-40"
              >
                Descartar
              </button>
              <button
                type="button"
                disabled={busy || !dirty}
                onClick={() => void saveTv()}
                className="rounded-xl bg-[#e5a93c] px-5 py-2.5 text-sm font-black text-black disabled:opacity-40"
              >
                {busy ? 'A guardar…' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
