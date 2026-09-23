import { describe, expect, it, vi } from 'vitest';
import { loadActiveOnlineOrders } from '../delivery-orders';

const at = (i: number) => new Date(Date.UTC(2026, 8, 24, 12, 0, i)).toISOString();

describe('pedidos online activos no POS com paginação real', () => {
  it('carrega mais de 100 deliveries mesmo com balcão e histórico recentes misturados', async () => {
    const rows = [
      ...Array.from({ length: 200 }, (_, id) => ({ id: `counter-${id}`, channel: 'counter', status: 'paid', store_slug: 'loja-a', created_at: at(id) })),
      ...Array.from({ length: 100 }, (_, id) => ({ id: `history-${id}`, channel: 'delivery', status: 'delivered', store_slug: 'loja-a', created_at: at(id) })),
      ...Array.from({ length: 125 }, (_, id) => ({ id: `active-${id}`, channel: 'delivery', status: 'ready', store_slug: 'loja-a', created_at: at(id) })),
      { id: 'other-store', channel: 'delivery', status: 'ready', store_slug: 'loja-b', created_at: at(0) },
    ];
    const rpc = vi.fn(async (filters) => {
      const matches = rows.filter((row) => row.channel === filters.channel && row.store_slug === filters.store && filters.statuses.includes(row.status));
      return { data: { orders: matches.slice(filters.offset, filters.offset + filters.limit), total: matches.length }, error: null };
    });
    const result = await loadActiveOnlineOrders(rpc, 'loja-a');
    expect(result).toHaveLength(125);
    expect(result.some((o) => o.id.startsWith('counter'))).toBe(false);
    expect(rpc.mock.calls[1][0]).toMatchObject({ store: 'loja-a', channel: 'delivery', offset: 100, limit: 100 });
    expect(rpc.mock.calls[0][0].statuses).toContain('awaiting_payment');
    expect(rpc.mock.calls[0][0].statuses).not.toContain('delivered');
  });

  it('traz também o levantamento — tudo o que vem da internet', async () => {
    const rows = [
      { id: 'entrega', channel: 'delivery', status: 'approved', created_at: at(1) },
      { id: 'levantar', channel: 'pickup', status: 'awaiting_approval', created_at: at(2) },
      { id: 'balcao', channel: 'counter', status: 'paid', created_at: at(3) },
    ];
    const rpc = vi.fn(async (filters) => {
      const matches = rows.filter((row) => row.channel === filters.channel);
      return { data: { orders: matches, total: matches.length }, error: null };
    });
    const result = await loadActiveOnlineOrders(rpc, 'loja-a');
    expect(rpc.mock.calls.map((c) => c[0].channel)).toEqual(['delivery', 'pickup']);
    // O que espera decisão vem à frente.
    expect(result.map((o) => o.id)).toEqual(['levantar', 'entrega']);
  });

  it('não entrega uma lista parcial se a segunda página falhar', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: { orders: Array.from({ length: 100 }, (_, id) => ({ id: String(id) })), total: 125 }, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'offline' } });
    await expect(loadActiveOnlineOrders(rpc, 'loja-a')).rejects.toThrow('Não foi possível actualizar os pedidos online.');
  });

  it('cancela a paginação quando muda a loja ou se fecha o quadro', async () => {
    const controller = new AbortController();
    const rpc = vi.fn(async () => {
      controller.abort();
      return { data: { orders: Array.from({ length: 100 }, (_, id) => ({ id: String(id) })), total: 125 }, error: null };
    });
    await expect(loadActiveOnlineOrders(rpc, 'loja-a', controller.signal)).rejects.toThrow();
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
