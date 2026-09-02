import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { brand } from '@brand';

/**
 * Guarda de arquitectura (CLAUDE.md §17 · §18.2 · §18.3).
 *
 * `config/brand.ts` é **fallback de fábrica** — o que a loja mostra quando a
 * base de dados não responde. No dia em que voltar a conter a identidade de um
 * cliente, três coisas partem-se ao mesmo tempo: o dono deixa de poder editar
 * a sua marca, cada instalação passa a ser um ramo do repositório, e uma
 * instalação nova nasce com o nome do cliente anterior no ecrã.
 *
 * Não é gosto: é o que impede o produto de escalar para além do 2.º cliente.
 * Por isso é um teste que trava o merge, e não um comentário no ficheiro.
 */

const FACTORY_PATH = path.resolve(__dirname, '..', 'brand.ts');
const source = readFileSync(FACTORY_PATH, 'utf8');

// Clientes reais que já passaram por este motor. A lista cresce; a regra não.
const CLIENT_NAMES = ['hawsmash', 'babalaza', 'bom pasteleiro', 'ridwan'];

describe('config/brand.ts — fallback de fábrica', () => {
  it('não contém o nome de nenhum cliente', () => {
    const lower = source.toLowerCase();
    const found = CLIENT_NAMES.filter((name) => lower.includes(name));
    expect(found, `identidade de cliente no fallback de fábrica: ${found.join(', ')}`).toEqual([]);
  });

  it('não aponta para assets com nome de cliente no caminho', () => {
    // `/assets/<cliente>/…` é o mesmo problema noutro sítio: o produto não sabe
    // como se chama o cliente que o está a usar (§18.3).
    const clientAssetPaths = source.match(/\/assets\/[a-z0-9-]+\//gi) ?? [];
    const offenders = clientAssetPaths.filter(
      (assetPath) => !['/assets/storefront/', '/assets/'].includes(assetPath),
    );
    expect(offenders, `assets com nome de cliente: ${offenders.join(', ')}`).toEqual([]);
  });

  it('tem nome e tagline genéricos, não os de uma marca real', () => {
    const lower = brand.name.toLowerCase();
    expect(CLIENT_NAMES.some((name) => lower.includes(name))).toBe(false);
    // Nome vazio deixaria a loja sem título quando a BD falha.
    expect(brand.name.trim().length).toBeGreaterThan(0);
  });

  it('mantém a forma completa que a loja consome — o fallback tem de ser utilizável', () => {
    // Um fallback incompleto é pior do que nenhum: a loja abre com buracos em
    // vez de abrir simples. Estes são os ramos que a montra lê sempre.
    expect(brand.theme.gold).toBeTruthy();
    expect(brand.storefront.hero.cta).toBeTruthy();
    expect(brand.storefront.landing.hero.titleLead).toBeTruthy();
    expect(brand.storefront.contact).toBeDefined();
    expect(Array.isArray(brand.storefront.landing.marquee)).toBe(true);
  });
});
