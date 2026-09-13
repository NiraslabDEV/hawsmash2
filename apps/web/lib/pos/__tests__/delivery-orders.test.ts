import { describe, expect, it, vi } from 'vitest';
import { loadActiveDeliveryOrders } from '../delivery-orders';

describe('deliveries activos no POS com paginação real', () => {
  it('carrega mais de 100 deliveries mesmo com balcão e histórico recentes misturados', async () => {
    const rows = [
      ...Array.from({ length: 200 }, (_, id) => ({ id: `counter-${id}`, channel: 'counter', status: 'paid', store_slug: 'loja-a' })),
      ...Array.from({ length: 100 }, (_, id) => ({ id: `history-${id}`, channel: 'delivery', status: 'delivered', store_slug: 'loja-a' })),
      ...Array.from({ length: 125 }, (_, id) => ({ id: `active-${id}`, channel: 'delivery', status: 'ready', store_slug: 'loja-a' })),
      { id: 'other-store', channel: 'delivery', status: 'ready', store_slug: 'loja-b' },
    ];
    const rpc = vi.fn(async (filters) => {
      const matches = rows.filter((row) => row.channel === filters.channel && row.store_slug === filters.store && filters.statuses.includes(row.status));
      return { data: { orders: matches.slice(filters.offset, filters.offset + filters.limit), total: matches.length }, error: null };
    });
    const result = await loadActiveDeliveryOrders(rpc, 'loja-a');
    expect(result).toHaveLength(125);
    expect(result[124]).toMatchObject({ id: 'active-124' });
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[1][0]).toMatchObject({ store: 'loja-a', channel: 'delivery', offset: 100, limit: 100 });
    expect(rpc.mock.calls[0][0].statuses).toContain('awaiting_payment');
    expect(rpc.mock.calls[0][0].statuses).not.toContain('delivered');
  });

  it('não entrega uma lista parcial se a segunda página falhar', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: { orders: Array.from({ length: 100 }, (_, id) => ({ id: String(id) })), total: 125 }, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'offline' } });
    await expect(loadActiveDeliveryOrders(rpc, 'loja-a')).rejects.toThrow('Não foi possível actualizar os deliveries.');
  });

  it('cancela a paginação quando muda a loja ou se fecha o quadro', async () => {
    const controller = new AbortController();
    const rpc = vi.fn(async () => {
      controller.abort();
      return { data: { orders: Array.from({ length: 100 }, (_, id) => ({ id: String(id) })), total: 125 }, error: null };
    });
    await expect(loadActiveDeliveryOrders(rpc, 'loja-a', controller.signal)).rejects.toThrow();
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
