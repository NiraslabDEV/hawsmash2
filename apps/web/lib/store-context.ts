const STORE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const DEFAULT_STORE_SLUG =
  process.env.NEXT_PUBLIC_DEFAULT_STORE_SLUG?.trim() || 'maputo';

export class InvalidStoreSlugError extends Error {
  constructor() {
    super('invalid_store_slug');
    this.name = 'InvalidStoreSlugError';
  }
}

export function resolveStoreSlug(value: unknown): string {
  if (value === undefined || value === null || value === '') {
    return DEFAULT_STORE_SLUG;
  }

  if (typeof value !== 'string') throw new InvalidStoreSlugError();

  const slug = value.trim().toLowerCase();
  if (!STORE_SLUG_PATTERN.test(slug)) throw new InvalidStoreSlugError();

  return slug;
}

/** Cookie que guarda a loja escolhida pelo cliente (CLAUDE §5.5). */
export const STORE_COOKIE = 'hs_store';

const STORE_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 dias

/**
 * Lê a loja escolhida de um cabeçalho `Cookie`. Um valor adulterado nunca
 * rebenta a página: devolve `null` e o site volta a perguntar a loja.
 */
export function parseStoreCookie(header: string | null | undefined): string | null {
  if (!header) return null;

  for (const part of header.split(';')) {
    const [rawName, ...rest] = part.split('=');
    if (rawName.trim() !== STORE_COOKIE) continue;
    try {
      const value = decodeURIComponent(rest.join('=').trim());
      if (!value) return null;
      return resolveStoreSlug(value);
    } catch {
      return null;
    }
  }

  return null;
}

/** Serializa o cookie da loja escolhida para uma resposta HTTP. */
export function serializeStoreCookie(slug: string): string {
  const value = resolveStoreSlug(slug);
  return `${STORE_COOKIE}=${value}; Path=/; Max-Age=${STORE_COOKIE_MAX_AGE}; SameSite=Lax`;
}
