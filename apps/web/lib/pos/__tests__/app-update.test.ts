import { describe, expect, it } from 'vitest';
import { canReloadNow, fetchLatestBuild, isNewBuild } from '../app-update';

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
