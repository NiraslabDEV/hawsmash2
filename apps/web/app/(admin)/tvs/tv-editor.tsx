'use client';

import { formatBytes } from '@/lib/tv/media';
import {
  TV_LIMITS,
  TV_MODES,
  TV_MODE_NAMES,
  modeShowsMenu,
  modeShowsSenhas,
  modeShowsVideos,
  normalizeTvSlug,
  tvSlugError,
  type TvConfig,
  type TvMode,
} from '@/lib/tv/settings';

import { Choice, INPUT, LABEL, NumberField, Section, Toggle } from './ui';

export type TvDraft = {
  name: string;
  slug: string;
  mode: TvMode;
  active: boolean;
  config: TvConfig;
};

export type LibraryItem = {
  id: string;
  kind: 'video' | 'image';
  name: string;
  storage_path: string;
  mime: string;
  size_bytes: number;
  created_at: string;
  created_by: string | null;
  url: string;
};

/** Desenho mínimo de cada modo: vê-se de relance o que a TV vai mostrar. */
function ModeSketch({ mode }: { mode: TvMode }) {
  const bloco = 'rounded-[3px]';
  return (
    <span className="flex h-12 w-20 shrink-0 gap-1 rounded-md border border-white/15 bg-black/40 p-1">
      {mode === 'senhas_videos' && (
        <>
          <span className={`${bloco} flex-[3] bg-[#4b8bd6]/60`} />
          <span className={`${bloco} flex-1 bg-[#e5a93c]/70`} />
        </>
      )}
      {mode === 'senhas' && (
        <span className="grid flex-1 grid-cols-3 gap-0.5">
          {Array.from({ length: 6 }, (_, i) => (
            <span key={i} className={`${bloco} bg-[#e5a93c]/70`} />
          ))}
        </span>
      )}
      {mode === 'videos' && <span className={`${bloco} flex-1 bg-[#4b8bd6]/60`} />}
      {mode === 'menu' && (
        <span className="flex flex-1 flex-col justify-around px-1">
          {Array.from({ length: 4 }, (_, i) => (
            <span key={i} className="h-1 rounded bg-white/40" />
          ))}
        </span>
      )}
    </span>
  );
}

export function TvEditor({
  draft,
  onChange,
  library,
}: {
  draft: TvDraft;
  onChange: (update: (current: TvDraft) => TvDraft) => void;
  library: LibraryItem[];
}) {
  const config = draft.config;
  const slugError = tvSlugError(draft.slug);
  const porId = new Map(library.map((item) => [item.id, item]));
  const naLista = new Set(config.videos.playlist.map((item) => item.mediaId));

  function patchConfig<K extends keyof TvConfig>(key: K, value: Partial<TvConfig[K]>) {
    onChange((current) => ({
      ...current,
      config: { ...current.config, [key]: { ...current.config[key], ...value } },
    }));
  }

  function setPlaylist(update: (list: TvConfig['videos']['playlist']) => TvConfig['videos']['playlist']) {
    onChange((current) => ({
      ...current,
      config: {
        ...current.config,
        videos: { ...current.config.videos, playlist: update(current.config.videos.playlist) },
      },
    }));
  }

  function move(index: number, delta: -1 | 1) {
    setPlaylist((list) => {
      const alvo = index + delta;
      if (alvo < 0 || alvo >= list.length) return list;
      const copia = [...list];
      [copia[index], copia[alvo]] = [copia[alvo], copia[index]];
      return copia;
    });
  }

  return (
    <div className="space-y-6">
      <Section title="Identificação">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className={LABEL}>Nome no painel</span>
            <input
              value={draft.name}
              maxLength={TV_LIMITS.nameMax}
              onChange={(event) => onChange((current) => ({ ...current, name: event.target.value }))}
              placeholder="TV do balcão"
              className={INPUT}
            />
          </label>
          <label className="block">
            <span className={LABEL}>Endereço</span>
            <input
              value={draft.slug}
              maxLength={TV_LIMITS.slugMax}
              onChange={(event) =>
                onChange((current) => ({ ...current, slug: normalizeTvSlug(event.target.value) }))
              }
              placeholder="tv1"
              className={INPUT}
            />
            <span className={`mt-1 block text-xs ${slugError ? 'text-[#ffb0b0]' : 'text-[#8b8378]'}`}>
              {slugError ?? 'Se mudares, a box da TV tem de abrir o endereço novo.'}
            </span>
          </label>
        </div>
        <Toggle
          checked={draft.active}
          onChange={(active) => onChange((current) => ({ ...current, active }))}
          label="TV ligada"
          hint="Desligada, a TV mostra só o logótipo — sem senhas nem vídeos."
        />
      </Section>

      <Section title="O que mostra">
        <div className="grid gap-3 md:grid-cols-2">
          {TV_MODES.map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => onChange((current) => ({ ...current, mode }))}
              className={`flex items-center gap-4 rounded-xl border p-4 text-left transition ${
                draft.mode === mode
                  ? 'border-[#e5a93c] bg-[#e5a93c]/10'
                  : 'border-white/10 hover:bg-white/[0.04]'
              }`}
            >
              <ModeSketch mode={mode} />
              <span>
                <span className={`block text-sm font-black ${draft.mode === mode ? 'text-[#e5a93c]' : 'text-white'}`}>
                  {TV_MODE_NAMES[mode].label}
                </span>
                <span className="mt-0.5 block text-xs text-[#8b8378]">{TV_MODE_NAMES[mode].hint}</span>
              </span>
            </button>
          ))}
        </div>
      </Section>

      <Section title="Ecrã">
        <div>
          <span className={LABEL}>Como está montada</span>
          <div className="mt-2">
            <Choice
              value={config.screen.rotation}
              onChange={(rotation) => patchConfig('screen', { rotation })}
              options={[
                { value: 0, label: 'Deitada (normal)' },
                { value: 90, label: 'Em pé ↻' },
                { value: 270, label: 'Em pé ↺' },
                { value: 180, label: 'Ao contrário' },
              ]}
            />
          </div>
        </div>
        <label className="block">
          <span className={LABEL}>Tamanho do texto · {config.screen.scale}%</span>
          <input
            type="range"
            min={TV_LIMITS.scaleMin}
            max={TV_LIMITS.scaleMax}
            step={5}
            value={config.screen.scale}
            onChange={(event) => patchConfig('screen', { scale: Number(event.target.value) })}
            className="mt-2 w-full accent-[#e5a93c]"
          />
          <span className="block text-xs text-[#8b8378]">Maior para a TV ao fundo da sala.</span>
        </label>
        {draft.mode !== 'videos' && (
          <>
            <Toggle
              checked={config.screen.showHeader}
              onChange={(showHeader) => patchConfig('screen', { showHeader })}
              label="Barra de cima com o título"
            />
            {config.screen.showHeader && (
              <>
                <label className="block">
                  <span className={LABEL}>Título</span>
                  <input
                    value={config.screen.title}
                    maxLength={TV_LIMITS.titleMax}
                    onChange={(event) => patchConfig('screen', { title: event.target.value })}
                    placeholder="Vazio = nome da marca e da loja"
                    className={INPUT}
                  />
                </label>
                <Toggle
                  checked={config.screen.showClock}
                  onChange={(showClock) => patchConfig('screen', { showClock })}
                  label="Mostrar as horas"
                />
              </>
            )}
          </>
        )}
      </Section>

      {modeShowsSenhas(draft.mode) && (
        <Section
          title="Senhas"
          hint="Aparece aqui tudo o que fica pronto: a senha chamada na aba Senhas do POS ou pela seta do quadro de Pedidos."
        >
          <div className="grid gap-4 md:grid-cols-3">
            <label className="block">
              <span className={LABEL}>Título</span>
              <input
                value={config.senhas.title}
                maxLength={TV_LIMITS.textMax}
                onChange={(event) => patchConfig('senhas', { title: event.target.value })}
                className={INPUT}
              />
            </label>
            <label className="block">
              <span className={LABEL}>Sem senhas prontas</span>
              <input
                value={config.senhas.emptyText}
                maxLength={TV_LIMITS.textMax}
                onChange={(event) => patchConfig('senhas', { emptyText: event.target.value })}
                className={INPUT}
              />
            </label>
            <label className="block">
              <span className={LABEL}>Título dos em preparo</span>
              <input
                value={config.senhas.preparingTitle}
                maxLength={TV_LIMITS.textMax}
                onChange={(event) => patchConfig('senhas', { preparingTitle: event.target.value })}
                className={INPUT}
              />
            </label>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <NumberField
              label="Destaque da senha nova"
              value={config.senhas.highlightSeconds}
              min={0}
              max={TV_LIMITS.highlightMax}
              suffix="segundos"
              hint="0 = não ocupa o ecrã."
              onChange={(highlightSeconds) => patchConfig('senhas', { highlightSeconds })}
            />
            <NumberField
              label="Tirar da TV depois de"
              value={config.senhas.readyMaxMinutes}
              min={0}
              max={TV_LIMITS.readyMaxMinutesMax}
              suffix="minutos"
              hint="0 = fica até carregarem em Entregue."
              onChange={(readyMaxMinutes) => patchConfig('senhas', { readyMaxMinutes })}
            />
            <NumberField
              label="Senhas no ecrã, no máximo"
              value={config.senhas.maxTickets}
              min={TV_LIMITS.maxTicketsMin}
              max={TV_LIMITS.maxTicketsMax}
              onChange={(maxTickets) => patchConfig('senhas', { maxTickets })}
            />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Toggle
              checked={config.senhas.showType}
              onChange={(showType) => patchConfig('senhas', { showType })}
              label="Balcão / Entrega / Levantamento"
              hint="Por baixo do número."
            />
            <Toggle
              checked={config.senhas.showPreparing}
              onChange={(showPreparing) => patchConfig('senhas', { showPreparing })}
              label="Mostrar os que estão em preparo"
            />
            <Toggle
              checked={config.senhas.sound}
              onChange={(sound) => patchConfig('senhas', { sound })}
              label="Toque quando uma senha fica pronta"
              hint="A TV tem de ter som. Se aparecer “som desligado”, carrega OK no comando uma vez."
            />
          </div>
          {draft.mode === 'senhas_videos' && (
            <div>
              <span className={LABEL}>Coluna das senhas</span>
              <div className="mt-2">
                <Choice
                  value={config.senhas.panelSide}
                  onChange={(panelSide) => patchConfig('senhas', { panelSide })}
                  options={[
                    { value: 'left', label: 'À esquerda' },
                    { value: 'right', label: 'À direita' },
                  ]}
                />
              </div>
            </div>
          )}
        </Section>
      )}

      {modeShowsVideos(draft.mode) && (
        <Section
          title="Vídeos desta TV"
          hint={
            draft.mode === 'senhas_videos'
              ? 'Passam em ciclo ao lado das senhas. Sem vídeos, a TV mostra só as senhas.'
              : 'Passam em ciclo, em ecrã inteiro. Sem vídeos, a TV mostra o logótipo.'
          }
        >
          {config.videos.playlist.length === 0 ? (
            <p className="rounded-xl bg-white/[0.03] px-4 py-3 text-sm text-[#8b8378]">
              Ainda sem vídeos. Escolhe da biblioteca abaixo.
            </p>
          ) : (
            <ol className="space-y-2">
              {config.videos.playlist.map((item, index) => {
                const media = porId.get(item.mediaId);
                return (
                  <li key={item.mediaId} className="flex flex-wrap items-center gap-3 rounded-xl bg-white/[0.03] p-3">
                    <span className="w-6 text-center text-sm font-black text-[#8b8378]">{index + 1}</span>
                    <span className="h-12 w-20 shrink-0 overflow-hidden rounded-md bg-black">
                      {media?.kind === 'image' && (
                        // eslint-disable-next-line @next/next/no-img-element -- miniatura do bucket
                        <img src={media.url} alt="" className="h-full w-full object-cover" />
                      )}
                      {media?.kind === 'video' && (
                        <video src={`${media.url}#t=1`} muted preload="metadata" className="h-full w-full object-cover" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold text-white">
                        {media?.name ?? 'Ficheiro apagado da biblioteca (sai ao guardar)'}
                      </span>
                      <span className="block text-xs text-[#8b8378]">
                        {media ? `${media.kind === 'video' ? 'Vídeo' : 'Imagem'} · ${formatBytes(media.size_bytes)}` : '—'}
                      </span>
                    </span>
                    {media?.kind === 'image' && (
                      <label className="flex items-center gap-2 text-xs text-[#8b8378]">
                        <input
                          type="number"
                          min={TV_LIMITS.imageSecondsMin}
                          max={TV_LIMITS.imageSecondsMax}
                          value={item.seconds ?? config.videos.imageSeconds}
                          onChange={(event) => {
                            const n = Number(event.target.value);
                            if (!Number.isFinite(n)) return;
                            const seconds = Math.min(TV_LIMITS.imageSecondsMax, Math.max(TV_LIMITS.imageSecondsMin, Math.round(n)));
                            setPlaylist((list) => list.map((entry, i) => (i === index ? { ...entry, seconds } : entry)));
                          }}
                          className="w-16 rounded-lg border border-white/10 bg-[#0f0e0c] px-2 py-1.5 text-sm text-white"
                        />
                        s
                      </label>
                    )}
                    <span className="flex gap-1">
                      <button
                        type="button"
                        aria-label="Subir"
                        disabled={index === 0}
                        onClick={() => move(index, -1)}
                        className="rounded-lg border border-white/10 px-2.5 py-1.5 text-sm text-[#C9BCAC] disabled:opacity-30"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        aria-label="Descer"
                        disabled={index === config.videos.playlist.length - 1}
                        onClick={() => move(index, 1)}
                        className="rounded-lg border border-white/10 px-2.5 py-1.5 text-sm text-[#C9BCAC] disabled:opacity-30"
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        onClick={() => setPlaylist((list) => list.filter((_, i) => i !== index))}
                        className="rounded-lg border border-white/10 px-3 py-1.5 text-sm font-bold text-[#ffb0b0]"
                      >
                        Tirar
                      </button>
                    </span>
                  </li>
                );
              })}
            </ol>
          )}

          {library.some((item) => !naLista.has(item.id)) && (
            <div>
              <span className={LABEL}>Juntar da biblioteca</span>
              <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {library
                  .filter((item) => !naLista.has(item.id))
                  .map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      disabled={config.videos.playlist.length >= TV_LIMITS.playlistMax}
                      onClick={() => setPlaylist((list) => [...list, { mediaId: item.id, seconds: null }])}
                      className="flex items-center gap-3 rounded-xl border border-white/10 p-2 text-left hover:bg-white/[0.04] disabled:opacity-40"
                    >
                      <span className="h-10 w-16 shrink-0 overflow-hidden rounded bg-black">
                        {item.kind === 'image' ? (
                          // eslint-disable-next-line @next/next/no-img-element -- miniatura do bucket
                          <img src={item.url} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <video src={`${item.url}#t=1`} muted preload="metadata" className="h-full w-full object-cover" />
                        )}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-bold text-white">{item.name}</span>
                      <span className="text-lg font-black text-[#e5a93c]">+</span>
                    </button>
                  ))}
              </div>
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-2">
            <Toggle
              checked={!config.videos.muted}
              onChange={(comSom) => patchConfig('videos', { muted: !comSom })}
              label="Vídeos com som"
              hint="Sem o toque inicial ou a opção do quiosque, o browser arranca sem som."
            />
            <div>
              <span className={LABEL}>Enquadramento</span>
              <div className="mt-2">
                <Choice
                  value={config.videos.fit}
                  onChange={(fit) => patchConfig('videos', { fit })}
                  options={[
                    { value: 'cover', label: 'Encher o ecrã' },
                    { value: 'contain', label: 'Mostrar inteiro' },
                  ]}
                />
              </div>
            </div>
          </div>
          <NumberField
            label="Tempo de cada imagem"
            value={config.videos.imageSeconds}
            min={TV_LIMITS.imageSecondsMin}
            max={TV_LIMITS.imageSecondsMax}
            suffix="segundos"
            hint="Vale para as imagens sem tempo próprio."
            onChange={(imageSeconds) => patchConfig('videos', { imageSeconds })}
          />
        </Section>
      )}

      {modeShowsMenu(draft.mode) && (
        <Section title="Cardápio" hint="Preços e esgotados vêm da loja, ao vivo — mudam no Cardápio e no Estoque.">
          <div>
            <span className={LABEL}>Colunas</span>
            <div className="mt-2">
              <Choice
                value={config.menu.columns}
                onChange={(columns) => patchConfig('menu', { columns })}
                options={[
                  { value: 1, label: '1' },
                  { value: 2, label: '2' },
                  { value: 3, label: '3' },
                ]}
              />
            </div>
          </div>
          <div>
            <span className={LABEL}>Produtos esgotados</span>
            <div className="mt-2">
              <Choice
                value={config.menu.soldOut}
                onChange={(soldOut) => patchConfig('menu', { soldOut })}
                options={[
                  { value: 'show', label: 'Mostrar como ESGOTADO' },
                  { value: 'hide', label: 'Esconder' },
                ]}
              />
            </div>
          </div>
        </Section>
      )}
    </div>
  );
}
