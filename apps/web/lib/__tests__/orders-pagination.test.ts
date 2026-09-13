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
    expect(rpc).toHaveBeenLastCalledWith({ limit: 10, offset: 100 }, undefined);
  });

  it('mantém os filtros na segunda página e o total filtrado do servidor', async () => {
    const rpc = vi.fn(async () => ({ data: { orders: [{ id: 'resultado-11' }], total: 11 }, error: null }));
    const view = { page: 2, search: 'cliente', status: 'ready', store: 'loja-norte' };
    const page = await requestOrdersPage(rpc, view);
    expect(rpc).toHaveBeenCalledWith({ limit: 10, offset: 10, search: 'cliente', status: 'ready', store: 'loja-norte' }, undefined);
    expect(page.total).toBe(11);
  });

  it.each(['search', 'status', 'store'] as const)('mudar %s reinicia a página no mesmo estado da consulta', (field) => {
    const changed = ordersViewReducer({ page: 11, search: '', status: 'all', store: 'all' }, { type: 'filter', field, value: 'novo' });
    expect(changed.page).toBe(1);
    expect(changed[field]).toBe('novo');
    expect(buildOrdersFilters(changed).offset).toBe(0);
  });

  it('mudar página preserva filtros e impede páginas negativas', () => {
    const view = { page: 2, search: 'nome', status: 'ready', store: 'loja-norte' };
    expect(ordersViewReducer(view, { type: 'page', page: 3 })).toEqual({ ...view, page: 3 });
    expect(ordersViewReducer(view, { type: 'page', page: -1 }).page).toBe(1);
  });

  it('encaminha cancelamento da consulta e não apresenta erro como lista vazia', async () => {
    const signal = new AbortController().signal;
    const rpc = vi.fn(async () => ({ data: null, error: { message: 'indisponível' } }));
    await expect(requestOrdersPage(rpc, initialOrdersView, signal)).rejects.toThrow('Não foi possível carregar os pedidos.');
    expect(rpc).toHaveBeenCalledWith({ limit: 10, offset: 0 }, signal);
  });

  it('detecta a RPC antiga que agrega antes do limite em vez de fingir paginação', async () => {
    const rpc = vi.fn(async () => ({ data: { orders: Array.from({ length: 125 }, (_, index) => ({ id: String(index) })), total: 1 }, error: null }));
    await expect(requestOrdersPage(rpc, initialOrdersView)).rejects.toThrow('Actualiza a base de dados para activar a paginação de pedidos.');
  });

  it('uma página que ficou vazia mantém o total para regressar à última página válida', async () => {
    const rpc = vi.fn(async () => ({ data: { orders: [], total: 20 }, error: null }));
    await expect(requestOrdersPage(rpc, { ...initialOrdersView, page: 3 })).resolves.toEqual({ orders: [], total: 20 });
  });
});
