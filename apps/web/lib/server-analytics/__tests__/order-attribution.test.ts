/**
 * Origem do pedido online. O que isto tranca:
 *   1. toda a rota que cria pedidos online com `create_order` grava a origem —
 *      o pagamento automático (/api/payments) não gravava, e cada pedido pago
 *      por M-Pesa/e-Mola aparecia como "Directo" na Análise;
 *   2. o que vai para `record_order_attribution` vem dos cookies selados;
 *   3. falhar nunca lança: a venda não cai por causa de marketing.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { FIRST_TOUCH_COOKIE, LAST_TOUCH_COOKIE, SESSION_COOKIE, buildTouch, encodeTouch } from '@/lib/attribution';
import { recordOrderAttribution } from '../order-attribution';

const appDir = resolve(__dirname, '../../../app');

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return routeFiles(path);
    return name === 'route.ts' ? [path] : [];
  });
}

function headersWith(cookies: Record<string, string>, extra: Record<string, string> = {}) {
  // Os valores já vão como o browser os guarda (encodeTouch codifica).
  const cookie = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
  return new Headers({ cookie, ...extra });
}

const instagram = encodeTouch(buildTouch({
  url: new URL('https://loja.example/menu?utm_source=ig&utm_medium=social'),
  referrer: null,
  selfHost: 'loja.example',
}));

describe('recordOrderAttribution', () => {
  it('toda a rota que cria pedidos com create_order grava a origem', () => {
    const creators = routeFiles(appDir).filter((f) => /rpc\(\s*['"]create_order['"]/.test(readFileSync(f, 'utf8')));
    expect(creators.length).toBeGreaterThanOrEqual(2);
    const missing = creators
      .filter((f) => !readFileSync(f, 'utf8').includes('recordOrderAttribution('))
      .map((f) => relative(appDir, f));
    expect(missing).toEqual([]);
  });

  it('envia a origem dos cookies e a sessão', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    await recordOrderAttribution({ rpc }, 'order-1', headersWith(
      { [FIRST_TOUCH_COOKIE]: instagram, [LAST_TOUCH_COOKIE]: instagram, [SESSION_COOKIE]: 'abc123abc123', _fbp: 'fb.1.2.3' },
      { 'x-forwarded-for': '41.1.1.1, 10.0.0.1', 'user-agent': 'UA' },
    ));
    expect(rpc).toHaveBeenCalledTimes(1);
    const [fn, args] = rpc.mock.calls[0];
    expect(fn).toBe('record_order_attribution');
    expect(args.p_order_id).toBe('order-1');
    expect(args.p_payload).toMatchObject({
      channel: 'organic_social', source: 'instagram', session_id: 'abc123abc123',
      fbp: 'fb.1.2.3', client_ip: '41.1.1.1', user_agent: 'UA',
    });
  });

  it('sem cookies de origem não grava nada', async () => {
    const rpc = vi.fn();
    await recordOrderAttribution({ rpc }, 'order-1', new Headers());
    expect(rpc).not.toHaveBeenCalled();
  });

  it('nunca lança, mesmo com a BD a falhar', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const rpc = vi.fn().mockRejectedValue(new Error('rede'));
    await expect(recordOrderAttribution({ rpc }, 'order-1', headersWith({ [FIRST_TOUCH_COOKIE]: instagram }))).resolves.toBeUndefined();
    spy.mockRestore();
  });
});
