/**
 * Pré-visualização ao vivo: o painel mostra a TV com o que se está a editar,
 * antes de Guardar.
 *
 * A pré-visualização é a página da TV a sério (`?preview=1`) dentro de um
 * iframe. O painel envia-lhe o rascunho por `postMessage` (mesma origem) e a
 * TV desenha-o por cima do que está gravado. Nada disto grava: a TV da loja
 * continua a mostrar o que está na base de dados até alguém carregar em Guardar.
 */

import { isTvMode, resolveTvConfig, type TvConfig, type TvMediaRow, type TvMode } from './settings';

/** Painel → TV: "desenha isto". */
export const TV_PREVIEW_DRAFT = 'tv-preview-draft';
/** TV → painel: "já estou a ouvir" (o iframe carrega depois do painel). */
export const TV_PREVIEW_READY = 'tv-preview-ready';

export type TvPreviewDraft = {
  mode: TvMode;
  active: boolean;
  config: TvConfig;
  /** Os ficheiros da lista do rascunho, vindos da biblioteca. */
  media: TvMediaRow[];
};

export function previewDraftMessage(draft: TvPreviewDraft) {
  return { type: TV_PREVIEW_DRAFT, payload: draft };
}

function isMediaRow(value: unknown): value is TvMediaRow {
  const m = value as Partial<TvMediaRow> | null;
  return (
    !!m &&
    typeof m.id === 'string' &&
    (m.kind === 'video' || m.kind === 'image') &&
    typeof m.storage_path === 'string' &&
    typeof m.name === 'string'
  );
}

/** Lê uma mensagem do painel. Tudo o que não for um rascunho válido → `null`. */
export function readPreviewDraft(message: unknown): TvPreviewDraft | null {
  const m = message as { type?: unknown; payload?: unknown } | null;
  if (!m || typeof m !== 'object' || m.type !== TV_PREVIEW_DRAFT) return null;
  const p = (m.payload ?? {}) as Record<string, unknown>;
  return {
    mode: isTvMode(p.mode) ? p.mode : 'senhas',
    active: typeof p.active === 'boolean' ? p.active : true,
    config: resolveTvConfig(p.config),
    media: Array.isArray(p.media)
      ? p.media.filter(isMediaRow).map(({ id, kind, storage_path, name }) => ({ id, kind, storage_path, name }))
      : [],
  };
}
