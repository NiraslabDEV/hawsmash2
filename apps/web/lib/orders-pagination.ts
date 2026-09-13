export const ORDERS_PAGE_SIZE = 10;

export type OrdersView = { search: string; status: string; store: string; page: number };
export type OrdersViewAction =
  | { type: 'filter'; field: 'search' | 'status' | 'store'; value: string }
  | { type: 'page'; page: number };
export const initialOrdersView: OrdersView = { search: '', status: 'all', store: 'all', page: 1 };

/** Filtro e página mudam juntos: nunca consultar a página antiga na loja nova. */
export function ordersViewReducer(view: OrdersView, action: OrdersViewAction): OrdersView {
  return action.type === 'page'
    ? { ...view, page: Math.max(1, Math.trunc(action.page)) }
    : { ...view, [action.field]: action.value, page: 1 };
}

export function buildOrdersFilters(view: OrdersView): Record<string, string | number> & { limit: number; offset: number } {
  return {
    limit: ORDERS_PAGE_SIZE,
    offset: (Math.max(1, view.page) - 1) * ORDERS_PAGE_SIZE,
    ...(view.search ? { search: view.search } : {}),
    ...(view.status !== 'all' ? { status: view.status } : {}),
    ...(view.store !== 'all' ? { store: view.store } : {}),
  };
}

export async function requestOrdersPage<T>(
  rpc: (filters: ReturnType<typeof buildOrdersFilters>, signal?: AbortSignal) => PromiseLike<{ data: unknown; error: unknown }>,
  view: OrdersView,
  signal?: AbortSignal,
): Promise<{ orders: T[]; total: number }> {
  const filters = buildOrdersFilters(view);
  const { data, error } = await rpc(filters, signal);
  if (error || !data || typeof data !== 'object' || !('orders' in data) || !Array.isArray(data.orders) || !('total' in data) || typeof data.total !== 'number' || !Number.isSafeInteger(data.total) || data.total < 0) {
    throw new Error('Não foi possível carregar os pedidos. Tenta novamente.');
  }
  if (data.orders.length > filters.limit || data.total < data.orders.length) {
    throw new Error('Actualiza a base de dados para activar a paginação de pedidos.');
  }
  return { orders: data.orders as T[], total: data.total };
}
