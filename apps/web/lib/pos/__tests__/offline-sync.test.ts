import 'fake-indexeddb/auto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { clearPosOfflineDatabase, enqueueOfflineSale, getOfflineSale, listOfflineSales } from '../offline-store';
import { syncOfflineSales } from '../offline-sync';

const sale = {
  clientSaleId: '11111111-1111-4111-8111-111111111111',
  deviceId: '22222222-2222-4222-8222-222222222222',
  storeSlug: 'maputo',
  storeName: 'Maputo',
  createdAt: '2026-08-19T18:00:00.000Z',
  items: [{
    menuItemId: '33333333-3333-4333-8333-333333333333',
    name: 'Classic Smash', qty: 1, unitPriceCents: 30000, station: 'kitchen' as const,
  }],
  payments: [{ method: 'cash' as const, amountCents: 30000 }],
  cashReceivedCents: 30000,
  totalCents: 30000,
};

afterEach(() => clearPosOfflineDatabase());

describe('sincronização das vendas offline', () => {
  it('remove a venda apenas depois de o servidor a aceitar', async () => {
    await enqueueOfflineSale(sale);
    const send = vi.fn().mockResolvedValue({ order_id: 'order-1' });

    expect(await syncOfflineSales(send, 10_000)).toEqual({ synced: 1, failed: 0 });
    expect(await listOfflineSales()).toEqual([]);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ clientSaleId: sale.clientSaleId }));
  });

  it('aplica backoff exponencial e preserva o mesmo client_sale_id no retry', async () => {
    await enqueueOfflineSale(sale);
    const failing = vi.fn().mockRejectedValue(new Error('network'));

    expect(await syncOfflineSales(failing, 20_000)).toEqual({ synced: 0, failed: 1 });
    expect(await getOfflineSale(sale.clientSaleId)).toMatchObject({
      attempts: 1,
      nextAttemptAt: 22_000,
      lastError: 'network',
    });

    const success = vi.fn().mockResolvedValue({ order_id: 'order-1' });
    await syncOfflineSales(success, 21_999);
    expect(success).not.toHaveBeenCalled();
    await syncOfflineSales(success, 22_000);
    expect(success).toHaveBeenCalledOnce();
    expect(success.mock.calls[0][0].clientSaleId).toBe(sale.clientSaleId);
  });

  it('mantém a fila após reabrir a base e sincroniza três vendas sem duplicar no reenvio', async () => {
    const ids = [
      '11111111-1111-4111-8111-111111111111',
      '44444444-4444-4444-8444-444444444444',
      '55555555-5555-4555-8555-555555555555',
    ];
    for (const clientSaleId of ids) await enqueueOfflineSale({ ...sale, clientSaleId });

    // listOfflineSales abre uma nova ligação IndexedDB: simula o browser reaberto.
    expect((await listOfflineSales()).map((entry) => entry.clientSaleId)).toEqual(ids);

    const serverOrders = new Map<string, string>();
    const send = vi.fn(async (entry: { clientSaleId: string }) => {
      const orderId = serverOrders.get(entry.clientSaleId) ?? crypto.randomUUID();
      serverOrders.set(entry.clientSaleId, orderId);
      return { order_id: orderId };
    });
    expect(await syncOfflineSales(send, 30_000)).toEqual({ synced: 3, failed: 0 });
    expect(serverOrders.size).toBe(3);

    for (const clientSaleId of ids) await enqueueOfflineSale({ ...sale, clientSaleId });
    expect(await syncOfflineSales(send, 40_000)).toEqual({ synced: 3, failed: 0 });
    expect(serverOrders.size).toBe(3);
    expect(await listOfflineSales()).toEqual([]);
  });
});
