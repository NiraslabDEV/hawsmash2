import { ONLINE_CHANNELS, sortOnlineOrders } from './orders-board';

const ACTIVE_STATUSES = ['awaiting_approval', 'awaiting_payment', 'approved', 'paid', 'in_preparation', 'ready'];
type Filters = { store: string; channel: string; statuses: string[]; limit: number; offset: number };
type Rpc = (filters: Filters, signal?: AbortSignal) => PromiseLike<{ data: unknown; error: unknown }>;

/**
 * O POS lê os pedidos activos da internet — entrega **e** levantamento — e
 * percorre todas as páginas de cada canal. `counter` fica de fora: uma entrega
 * registada no balcão não é um pedido do site e já nasceu paga.
 */
export async function loadActiveOnlineOrders<T extends { id: string; status: string; created_at: string }>(
  rpc: Rpc,
  storeSlug: string,
  signal?: AbortSignal,
): Promise<T[]> {
  const orders = new Map<string, T>();
  for (const channel of ONLINE_CHANNELS) {
    for (const order of await loadChannel<T>(rpc, storeSlug, channel, signal)) orders.set(order.id, order);
  }
  return sortOnlineOrders([...orders.values()]);
}

async function loadChannel<T>(rpc: Rpc, storeSlug: string, channel: string, signal?: AbortSignal): Promise<T[]> {
  const orders: T[] = [];
  let offset = 0;
  const limit = 100;
  for (;;) {
    signal?.throwIfAborted();
    const { data, error } = await rpc({ store: storeSlug, channel, statuses: ACTIVE_STATUSES, limit, offset }, signal);
    signal?.throwIfAborted();
    if (error || !data || typeof data !== 'object' || !('orders' in data) || !Array.isArray(data.orders)
      || !('total' in data) || typeof data.total !== 'number' || !Number.isSafeInteger(data.total)
      || data.orders.length > limit || data.total < data.orders.length) {
      throw new Error('Não foi possível actualizar os pedidos online. Tenta novamente.');
    }
    orders.push(...(data.orders as T[]));
    offset += data.orders.length;
    if (data.orders.length < limit || offset >= data.total) break;
  }
  return orders;
}
