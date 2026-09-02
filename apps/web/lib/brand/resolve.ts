import type { Brand } from '@brand';

/**
 * Resolução da marca: **fallback de fábrica + o que a base de dados mandou**.
 *
 * Domínio puro, sem I/O — é aqui que se decide o que ganha quando os dois
 * discordam, e é por isso que isto é testável sem base de dados nenhuma.
 * O acesso à BD vive em `server.ts`.
 *
 * A regra: a base de dados manda no que preencheu; o resto herda a fábrica.
 * Uma marca meia preenchida abre a loja na mesma (CLAUDE.md §18.2).
 */

/**
 * A marca de fábrica é `as const` — tipos literais e readonly. Depois do merge
 * os valores vêm da base de dados e são `string` normal, logo o tipo resolvido
 * é a mesma forma com os literais alargados e o readonly retirado.
 */
export type Widen<T> = T extends readonly (infer U)[]
  ? Widen<U>[]
  : T extends string
    ? string
    : T extends number
      ? number
      : T extends boolean
        ? boolean
        : T extends object
          ? { -readonly [K in keyof T]: Widen<T[K]> }
          : T;

export type ResolvedBrand = Widen<Brand>;

/** A linha de `brand_settings` tal como `get_brand()` a devolve. */
export type BrandRow = {
  name: string;
  tagline: string;
  locale: string;
  currency: string;
  legal_name?: string | null;
  nuit?: string | null;
  logo_path?: string | null;
  favicon_path?: string | null;
  og_image_path?: string | null;
  receipt_footer_default?: string | null;
  social?: Record<string, unknown> | null;
  contact?: Record<string, unknown> | null;
  theme?: Record<string, unknown> | null;
  storefront?: Record<string, unknown> | null;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Funde `patch` por cima de `base`, em profundidade.
 *
 * - `null`/`undefined` no patch **não apagam**: significam "não trouxe isto".
 *   Apagar por omissão é como uma marca meia gravada deixaria a loja em branco.
 * - String vazia **é** uma escolha (`whatsapp: ''` esconde o ícone) e passa.
 * - Listas substituem-se inteiras. Fundir posição a posição deixaria o 4.º
 *   item do dono anterior colado a um marquee de três.
 */
export function deepMerge<T extends object>(base: T, patch: unknown): T {
  if (!isPlainObject(patch)) return base;

  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };

  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined) continue;

    if (Array.isArray(value)) {
      out[key] = [...value];
      continue;
    }

    if (isPlainObject(value)) {
      const current = out[key];
      out[key] = isPlainObject(current) ? deepMerge(current, value) : deepMerge({}, value);
      continue;
    }

    out[key] = value;
  }

  return out as T;
}

/**
 * A marca que a aplicação usa. `row` a null (BD em baixo, instalação nova, ou
 * dono que ainda não preencheu a Aparência) devolve a fábrica intacta.
 */
export function resolveBrand(factory: Brand, row: BrandRow | null | undefined): ResolvedBrand {
  const base = deepMerge({}, factory) as ResolvedBrand;
  if (!row) return base;

  // As colunas próprias da tabela vão para onde a loja já as lê hoje, em vez
  // de a montra ter de saber que existe uma tabela com este ou aquele nome.
  const storefront: Record<string, unknown> = { ...(row.storefront ?? {}) };
  if (row.logo_path) storefront.logoImage = row.logo_path;
  if (row.favicon_path) storefront.faviconImage = row.favicon_path;
  if (row.og_image_path) storefront.ogImage = row.og_image_path;
  if (isPlainObject(row.contact) && Object.keys(row.contact).length > 0) {
    storefront.contact = row.contact;
  }

  return deepMerge(base, {
    // Nome vazio não é uma escolha: seria uma loja sem título.
    name: row.name?.trim() ? row.name : undefined,
    tagline: row.tagline,
    locale: row.locale,
    currency: row.currency,
    legalName: row.legal_name,
    nuit: row.nuit,
    receiptFooter: row.receipt_footer_default,
    social: row.social,
    theme: row.theme,
    storefront,
  });
}
