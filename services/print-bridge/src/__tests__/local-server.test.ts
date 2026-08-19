import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import { createLocalServer } from '../local-server';
import { MemoryRequestLedger } from '../request-ledger';

const token = 'token-local-de-teste-com-32-caracteres';
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

async function start(overrides: Record<string, unknown> = {}) {
  const print = vi.fn(async () => true);
  const drawer = vi.fn(async () => true);
  const server = createLocalServer({
    token,
    storeId: '00000000-0000-4000-8000-000000000101',
    allowedOrigins: ['https://staging.hawsmash.test'],
    ledger: new MemoryRequestLedger(),
    print,
    drawer,
    ...overrides,
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Servidor de teste sem porta');
  return { baseUrl: `http://127.0.0.1:${address.port}`, print, drawer };
}

const auth = { Authorization: `Bearer ${token}` };

describe('servidor HTTP local', () => {
  it('exige LOCAL_TOKEN e não devolve segredos no health', async () => {
    const { baseUrl } = await start();

    const denied = await fetch(`${baseUrl}/health`);
    const allowed = await fetch(`${baseUrl}/health`, { headers: auth });
    const body = await allowed.json();

    expect(denied.status).toBe(401);
    expect(allowed.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      storeId: '00000000-0000-4000-8000-000000000101',
    });
    expect(JSON.stringify(body)).not.toContain(token);
  });

  it('imprime uma única vez quando o POS repete o mesmo requestId', async () => {
    const { baseUrl, print } = await start();
    const request = {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId: 'sale-123:receipt',
        station: 'counter',
        kind: 'receipt',
        payload: { test: true, message: 'Talão local' },
      }),
    };

    const [first, second] = await Promise.all([
      fetch(`${baseUrl}/print`, request),
      fetch(`${baseUrl}/print`, request),
    ]);
    const responses = await Promise.all([first.json(), second.json()]) as Array<{
      duplicate?: boolean;
    }>;

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(responses.some((response) => response.duplicate === true)).toBe(true);
    expect(print).toHaveBeenCalledTimes(1);
  });

  it('encaminha drawer separado da impressão de talões', async () => {
    const { baseUrl, print, drawer } = await start();

    const response = await fetch(`${baseUrl}/drawer`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: 'sale-123:drawer' }),
    });

    expect(response.status).toBe(200);
    expect(drawer).toHaveBeenCalledTimes(1);
    expect(print).not.toHaveBeenCalled();
  });

  it('recusa origens fora da lista CORS', async () => {
    const { baseUrl } = await start();
    const response = await fetch(`${baseUrl}/health`, {
      headers: { ...auth, Origin: 'https://hostil.test' },
    });

    expect(response.status).toBe(403);
  });
});
