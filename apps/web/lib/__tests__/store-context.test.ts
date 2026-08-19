import { describe, expect, it } from 'vitest';
import { InvalidStoreSlugError, resolveStoreSlug } from '../store-context';

describe('resolveStoreSlug', () => {
  it('usa Maputo apenas quando a loja ainda não foi escolhida', () => {
    expect(resolveStoreSlug(undefined)).toBe('maputo');
    expect(resolveStoreSlug(null)).toBe('maputo');
    expect(resolveStoreSlug('')).toBe('maputo');
  });

  it('normaliza um slug válido', () => {
    expect(resolveStoreSlug('  MaToLa  ')).toBe('matola');
  });

  it('não encaminha um slug inválido silenciosamente para Maputo', () => {
    expect(() => resolveStoreSlug('../matola')).toThrow(InvalidStoreSlugError);
    expect(() => resolveStoreSlug({ slug: 'matola' })).toThrow(InvalidStoreSlugError);
  });
});
