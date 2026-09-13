const ACTIVE_STATUSES = ['awaiting_approval', 'awaiting_payment', 'approved', 'paid', 'in_preparation', 'ready'];
type Filters = { store: string; channel: string; statuses: string[]; limit: number; offset: number };

/** O POS lê apenas deliveries activos, mas percorre todas as páginas. */
export async function loadActiveDeliveryOrders<T extends { id: string }>(
  rpc: (filters: Filters, signal?: AbortSignal) => PromiseLike<{ data: unknown; error: unknown }>,
  storeSlug: string,
  signal?: AbortSignal,
): Promise<T[]> {
  const orders = new Map<string, T>();
  let offset = 0;
  const limit = 100;
  for (;;) {
    signal?.throwIfAborted();
    const { data, error } = await rpc({ store: storeSlug, channel: 'delivery', statuses: ACTIVE_STATUSES, limit, offset }, signal);
    signal?.throwIfAborted();
    if (error || !data || typeof data !== 'object' || !('orders' in data) || !Array.isArray(data.orders)
      || !('total' in data) || typeof data.total !== 'number' || !Number.isSafeInteger(data.total)
      || data.orders.length > limit || data.total < data.orders.length) {
      throw new Error('Não foi possível actualizar os deliveries. Tenta novamente.');
    }
    for (const order of data.orders as T[]) orders.set(order.id, order);
    offset += data.orders.length;
    if (data.orders.length < limit || offset >= data.total) break;
  }
  return [...orders.values()];
}
