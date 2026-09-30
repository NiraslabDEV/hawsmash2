import { describe, expect, it, vi } from 'vitest';
import { buildOrdersFilters, initialOrdersView, ordersViewReducer, requestOrdersPage } from '../orders-pagination';

describe('paginação dos pedidos no servidor', () => {
  it('consulta a página 11 entre 125 pedidos sem cortar aos primeiros 100', async () => {
    const all = Array.from({ length: 125 }, (_, index) => ({ id: String(index + 1) }));
    const rpc = vi.fn(async (filters) => ({ data: { orders: all.slice(filters.offset, filters.offset + filters.limit), total: all.length }, error: null }));
    const first = await requestOrdersPage(rpc, initialOrdersView);
    const eleventh = await requestOrdersPage(rpc, { ...initialOrdersView, page: 11 });
    expect(first.orders).toEqual(all.slice(0, 10));
    expect(eleventh.orders).toEqual(all.slice(100, 110));
    expect(eleventh.total).toBe(125);
    expect(rpc).toHaveBeenLastCalledWith({ limit: 10, offset: 100, day: 'current' }, undefined);
  });

  it('mantém os filtros na segunda página e o total filtrado do servidor', async () => {
    const rpc = vi.fn(async () => ({ data: { orders: [{ id: 'resultado-11' }], total: 11 }, error: null }));
    const view = { page: 2, search: 'cliente', status: 'ready', store: 'loja-norte', period: 'history' as const, date: '' };
    const page = await requestOrdersPage(rpc, view);
    expect(rpc).toHaveBeenCalledWith({ limit: 10, offset: 10, search: 'cliente', status: 'ready', store: 'loja-norte' }, undefined);
    expect(page.total).toBe(11);
  });

  it.each(['search', 'status', 'store', 'date'] as const)('mudar %s reinicia a página no mesmo estado da consulta', (field) => {
    const changed = ordersViewReducer({ ...initialOrdersView, page: 11 }, { type: 'filter', field, value: 'novo' });
    expect(changed.page).toBe(1);
    expect(changed[field]).toBe('novo');
    expect(buildOrdersFilters(changed).offset).toBe(0);
  });

  it('mudar página preserva filtros e impede páginas negativas', () => {
    const view = { ...initialOrdersView, page: 2, search: 'nome', status: 'ready', store: 'loja-norte' };
    expect(ordersViewReducer(view, { type: 'page', page: 3 })).toEqual({ ...view, page: 3 });
    expect(ordersViewReducer(view, { type: 'page', page: -1 }).page).toBe(1);
  });

  it('encaminha cancelamento da consulta e não apresenta erro como lista vazia', async () => {
    const signal = new AbortController().signal;
    const rpc = vi.fn(async () => ({ data: null, error: { message: 'indisponível' } }));
    await expect(requestOrdersPage(rpc, initialOrdersView, signal)).rejects.toThrow('Não foi possível carregar os pedidos.');
    expect(rpc).toHaveBeenCalledWith({ limit: 10, offset: 0, day: 'current' }, signal);
  });

  it('detecta a RPC antiga que agrega antes do limite em vez de fingir paginação', async () => {
    const rpc = vi.fn(async () => ({ data: { orders: Array.from({ length: 125 }, (_, index) => ({ id: String(index) })), total: 1 }, error: null }));
    await expect(requestOrdersPage(rpc, initialOrdersView)).rejects.toThrow('Actualiza a base de dados para activar a paginação de pedidos.');
  });

  it('uma página que ficou vazia mantém o total para regressar à última página válida', async () => {
    const rpc = vi.fn(async () => ({ data: { orders: [], total: 20 }, error: null }));
    await expect(requestOrdersPage(rpc, { ...initialOrdersView, page: 3 })).resolves.toEqual({ orders: [], total: 20 });
  });

  it('abre no dia em curso: o servidor corta no último fecho do dia de cada loja', () => {
    expect(initialOrdersView.period).toBe('current');
    const filters = buildOrdersFilters(initialOrdersView);
    expect(filters).toMatchObject({ day: 'current' });
    expect(filters).not.toHaveProperty('date_from');
  });

  it('o histórico sem data mostra tudo; com data, só esse dia de Maputo', () => {
    const history = ordersViewReducer(initialOrdersView, { type: 'period', period: 'history' });
    expect(buildOrdersFilters(history)).toEqual({ limit: 10, offset: 0 });

    const oneDay = ordersViewReducer(history, { type: 'filter', field: 'date', value: '2026-09-30' });
    expect(buildOrdersFilters(oneDay)).toEqual({
      limit: 10,
      offset: 0,
      date_from: '2026-09-29T22:00:00.000Z',
      date_to: '2026-09-30T21:59:59.999Z',
    });
  });

  it('voltar ao dia em curso larga a data e a página do histórico', () => {
    const history = { ...initialOrdersView, period: 'history' as const, date: '2026-09-28', page: 4 };
    const back = ordersViewReducer(history, { type: 'period', period: 'current' });
    expect(back).toMatchObject({ period: 'current', date: '', page: 1 });
    expect(buildOrdersFilters({ ...back, date: '2026-09-28' })).not.toHaveProperty('date_from');
  });

  it('passa as contagens por estado e ignora as que não são números', async () => {
    const ok = vi.fn(async () => ({ data: { orders: [], total: 0, status_counts: { paid: 2, ready: 1 } }, error: null }));
    await expect(requestOrdersPage(ok, initialOrdersView)).resolves.toMatchObject({ statusCounts: { paid: 2, ready: 1 } });

    const bad = vi.fn(async () => ({ data: { orders: [], total: 0, status_counts: { paid: '2' } }, error: null }));
    expect(await requestOrdersPage(bad, initialOrdersView)).not.toHaveProperty('statusCounts');
  });
});
