import { describe, expect, it } from 'vitest';
import {
  InvalidStoreSlugError,
  STORE_COOKIE,
  parseStoreCookie,
  resolveStoreSlug,
  serializeStoreCookie,
} from '../store-context';

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

describe('cookie da loja escolhida', () => {
  it('lê a loja escolhida de um cabeçalho com vários cookies', () => {
    expect(parseStoreCookie('theme=dark; hs_store=matola; cart=1')).toBe('matola');
    expect(parseStoreCookie('hs_store=maputo')).toBe('maputo');
  });

  it('ignora cookie ausente ou adulterado em vez de rebentar a página', () => {
    expect(parseStoreCookie(null)).toBeNull();
    expect(parseStoreCookie('theme=dark')).toBeNull();
    expect(parseStoreCookie('hs_store=../admin')).toBeNull();
  });

  it('serializa o cookie com caminho, duração e SameSite', () => {
    const cookie = serializeStoreCookie('matola');
    expect(cookie.startsWith(`${STORE_COOKIE}=matola;`)).toBe(true);
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Max-Age=');
  });

  it('recusa serializar uma loja com slug inválido', () => {
    expect(() => serializeStoreCookie('../admin')).toThrow(InvalidStoreSlugError);
  });
});
