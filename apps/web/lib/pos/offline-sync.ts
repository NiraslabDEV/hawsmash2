import {
  listOfflineSales,
  removeOfflineSale,
  updateOfflineSale,
  type OfflineSale,
} from './offline-store';

const MAX_BACKOFF_MS = 60_000;

export type SendOfflineSale = (sale: OfflineSale) => Promise<unknown>;

export async function syncOfflineSales(
  send: SendOfflineSale,
  now = Date.now(),
): Promise<{ synced: number; failed: number }> {
  const sales = await listOfflineSales();
  let synced = 0;
  let failed = 0;

  for (const sale of sales) {
    if (sale.nextAttemptAt > now) continue;
    try {
      await send(sale);
      await removeOfflineSale(sale.clientSaleId);
      synced += 1;
    } catch (error) {
      const attempts = sale.attempts + 1;
      const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempts);
      await updateOfflineSale({
        ...sale,
        attempts,
        nextAttemptAt: now + delay,
        lastError: (error instanceof Error ? error.message : String(error)).slice(0, 500),
      });
      failed += 1;
    }
  }

  return { synced, failed };
}
