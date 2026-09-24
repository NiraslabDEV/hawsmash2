import { describe, expect, it } from 'vitest';
import {
  MIN_RELOAD_GAP_MS,
  canReloadNow,
  fetchLatestBuild,
  isNewBuild,
  markReload,
  reloadAllowed,
} from '../app-update';

describe('o POS apanha versões novas sozinho', () => {
  it('só há versão nova quando os dois lados dizem qual é e são diferentes', () => {
    expect(isNewBuild('a', 'b')).toBe(true);
    expect(isNewBuild('a', 'a')).toBe(false);
    expect(isNewBuild(null, 'b')).toBe(false);
    expect(isNewBuild('a', null)).toBe(false);
  });

  it('nunca recarrega a meio de uma venda nem sem rede', () => {
    expect(canReloadNow({ cartEmpty: true, busy: false, online: true })).toBe(true);
    expect(canReloadNow({ cartEmpty: false, busy: false, online: true })).toBe(false);
    expect(canReloadNow({ cartEmpty: true, busy: true, online: true })).toBe(false);
    expect(canReloadNow({ cartEmpty: true, busy: false, online: false })).toBe(false);
  });

  it('nunca entra em ciclo: um recarregar automático por cada 10 minutos', () => {
    const mem = new Map<string, string>();
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    const agora = 1_000_000_000;
    expect(reloadAllowed(storage, agora)).toBe(true);
    markReload(storage, agora);
    expect(reloadAllowed(storage, agora + 60_000)).toBe(false);
    expect(reloadAllowed(storage, agora + MIN_RELOAD_GAP_MS)).toBe(true);
    // Sem storage não se arrisca.
    expect(reloadAllowed(null, agora)).toBe(false);
  });

  it('lê a versão do servidor e não rebenta quando falha', async () => {
    const ok = (async () => new Response(JSON.stringify({ build: 'abc' }))) as unknown as typeof fetch;
    expect(await fetchLatestBuild(ok)).toBe('abc');
    const erro = (async () => new Response('x', { status: 500 })) as unknown as typeof fetch;
    expect(await fetchLatestBuild(erro)).toBeNull();
    const semRede = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect(await fetchLatestBuild(semRede)).toBeNull();
  });
});
