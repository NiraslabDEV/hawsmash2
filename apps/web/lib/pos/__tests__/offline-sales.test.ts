import 'fake-indexeddb/auto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  clearPosOfflineDatabase,
  enqueueOfflineSale,
  getOfflineSale,
  listOfflineSales,
  type OfflineSaleDraft,
} from '../offline-store';
import { printOfflineSale } from '../offline-sales';

const draft: OfflineSaleDraft = {
  clientSaleId: '11111111-1111-4111-8111-111111111111',
  deviceId: '22222222-2222-4222-8222-222222222222',
  storeSlug: 'maputo',
  storeName: 'Maputo',
  createdAt: '2026-08-19T18:00:00.000Z',
  items: [
    {
      menuItemId: '33333333-3333-4333-8333-333333333333',
      name: 'Classic Smash',
      qty: 2,
      unitPriceCents: 30000,
      station: 'kitchen',
    },
  ],
  payments: [{ method: 'cash', amountCents: 60000 }],
  cashReceivedCents: 100000,
  totalCents: 60000,
};

afterEach(async () => {
  await clearPosOfflineDatabase();
});

describe('fila de vendas offline', () => {
  it('persiste a venda e atribui uma sequência local por loja e dia', async () => {
    const first = await enqueueOfflineSale(draft);
    const second = await enqueueOfflineSale({
      ...draft,
      clientSaleId: '44444444-4444-4444-8444-444444444444',
    });

    expect(first.localNumber).toBe(1);
    expect(first.localOrderNumber).toBe('MPT-OFF-001');
    expect(second.localNumber).toBe(2);
    expect((await getOfflineSale(draft.clientSaleId))?.clientSaleId).toBe(draft.clientSaleId);
    expect(await listOfflineSales()).toHaveLength(2);
  });

  it('imprime comanda, talão e gaveta no bridge com chaves idempotentes', async () => {
    const sale = await enqueueOfflineSale(draft);
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(input), body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    const result = await printOfflineSale(
      sale,
      { baseUrl: 'http://127.0.0.1:7777', token: 'x'.repeat(32) },
      fetcher,
    );

    expect(result).toEqual({ receipt: true, drawer: true, stations: ['kitchen'] });
    expect(requests.map((request) => request.url)).toEqual([
      'http://127.0.0.1:7777/print',
      'http://127.0.0.1:7777/print',
      'http://127.0.0.1:7777/drawer',
    ]);
    expect(requests.map((request) => request.body.requestId)).toEqual([
      `${draft.clientSaleId}:order:kitchen`,
      `${draft.clientSaleId}:receipt:counter`,
      `${draft.clientSaleId}:drawer:counter`,
    ]);
    expect((requests[0].body.payload as { items: unknown[] }).items).toHaveLength(1);
    expect(requests[1].body.payload).toMatchObject({ total_cents: 60000, change_cents: 40000 });
  });
});
