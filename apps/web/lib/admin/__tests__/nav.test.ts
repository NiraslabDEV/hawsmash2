import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ADMIN_NAV, canAccessAdminPath, firstAllowedHref, navItemForPath } from '../nav';

describe('painel — onde cada perfil pode entrar', () => {
  it('o Balcão entra em Pedidos e Caixa, e não entra pelo URL no resto', () => {
    expect(canAccessAdminPath('cashier', '/pedidos')).toBe(true);
    expect(canAccessAdminPath('cashier', '/pedidos/123')).toBe(true);
    expect(canAccessAdminPath('cashier', '/caixa')).toBe(true);
    expect(canAccessAdminPath('cashier', '/marketing')).toBe(false);
    expect(canAccessAdminPath('cashier', '/definicoes')).toBe(false);
    expect(canAccessAdminPath('cashier', '/definicoes-pos')).toBe(false);
    expect(canAccessAdminPath('cashier', '/equipa/')).toBe(false);
  });

  it('compara por segmento: /definicoes-pos não é /definicoes', () => {
    expect(navItemForPath('/definicoes-pos')?.label).toBe('POS');
    expect(canAccessAdminPath('manager', '/definicoes-pos')).toBe(true);
    expect(canAccessAdminPath('manager', '/definicoes')).toBe(false);
  });

  it('o gerente não entra no que é só do dono', () => {
    expect(canAccessAdminPath('manager', '/marketing')).toBe(true);
    expect(canAccessAdminPath('manager', '/equipa')).toBe(false);
    expect(canAccessAdminPath('manager', '/aparencia')).toBe(false);
  });

  it('o dono entra em tudo; os outros não entram no que não está no menu', () => {
    for (const item of ADMIN_NAV) expect(canAccessAdminPath('owner', item.href)).toBe(true);
    expect(canAccessAdminPath('owner', '/pagina-nova')).toBe(true);
    expect(canAccessAdminPath('manager', '/pagina-nova')).toBe(false);
    expect(canAccessAdminPath('cashier', '/pagina-nova')).toBe(false);
  });

  it('a cozinha não entra no painel', () => {
    expect(canAccessAdminPath('kitchen', '/pedidos')).toBe(false);
  });

  it('quem abriu o que não pode volta à primeira aba do seu perfil', () => {
    expect(firstAllowedHref('cashier')).toBe('/pedidos');
    expect(firstAllowedHref('manager')).toBe('/pedidos');
  });

  it('cada página do painel tem a sua entrada no menu (senão fica só do dono)', () => {
    const pasta = path.resolve(__dirname, '../../../app/(admin)');
    const paginas = readdirSync(pasta)
      .filter((nome) => statSync(path.join(pasta, nome)).isDirectory())
      .filter((nome) => existsSync(path.join(pasta, nome, 'page.tsx')))
      .map((nome) => `/${nome}`);
    const noMenu = new Set(ADMIN_NAV.map((item) => item.href));
    expect(paginas.filter((href) => !noMenu.has(href))).toEqual([]);
  });
});
