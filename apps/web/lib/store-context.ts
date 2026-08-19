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
