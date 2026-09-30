import { nextMaputoDay } from '@/lib/admin/analysis-period';

export const ORDERS_PAGE_SIZE = 10;

/**
 * `current`: só o dia em curso — desde o último fecho do dia de cada loja, no
 * servidor (1110). `history`: tudo, ou um dia de calendário de Maputo se
 * `date` (`YYYY-MM-DD`) vier preenchido.
 */
export type OrdersPeriod = 'current' | 'history';

export type OrdersView = { search: string; status: string; store: string; period: OrdersPeriod; date: string; page: number };
export type OrdersViewAction =
  | { type: 'filter'; field: 'search' | 'status' | 'store' | 'date'; value: string }
  | { type: 'period'; period: OrdersPeriod }
  | { type: 'page'; page: number };
export const initialOrdersView: OrdersView = { search: '', status: 'all', store: 'all', period: 'current', date: '', page: 1 };

/** Filtro e página mudam juntos: nunca consultar a página antiga na loja nova. */
export function ordersViewReducer(view: OrdersView, action: OrdersViewAction): OrdersView {
  if (action.type === 'page') return { ...view, page: Math.max(1, Math.trunc(action.page)) };
  // Voltar ao dia em curso larga a data escolhida no histórico.
  if (action.type === 'period') return { ...view, period: action.period, date: '', page: 1 };
  return { ...view, [action.field]: action.value, page: 1 };
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function buildOrdersFilters(view: OrdersView): Record<string, string | number> & { limit: number; offset: number } {
  const day = view.period === 'history' && DAY.test(view.date) ? view.date : null;
  return {
    limit: ORDERS_PAGE_SIZE,
    offset: (Math.max(1, view.page) - 1) * ORDERS_PAGE_SIZE,
    ...(view.search ? { search: view.search } : {}),
    ...(view.status !== 'all' ? { status: view.status } : {}),
    ...(view.store !== 'all' ? { store: view.store } : {}),
    ...(view.period === 'current' ? { day: 'current' } : {}),
    ...(day
      ? {
          date_from: new Date(`${day}T00:00:00+02:00`).toISOString(),
          // O servidor compara com <=: o último milissegundo do dia.
          date_to: new Date(new Date(nextMaputoDay(day)).getTime() - 1).toISOString(),
        }
      : {}),
  };
}

/** `{ estado: n }` válido, ou null (RPC anterior à 1110, que não o devolve). */
function readStatusCounts(value: unknown): Record<string, number> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (!entries.every(([, n]) => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0)) return null;
  return Object.fromEntries(entries) as Record<string, number>;
}

export async function requestOrdersPage<T>(
  rpc: (filters: ReturnType<typeof buildOrdersFilters>, signal?: AbortSignal) => PromiseLike<{ data: unknown; error: unknown }>,
  view: OrdersView,
  signal?: AbortSignal,
): Promise<{ orders: T[]; total: number; statusCounts?: Record<string, number> }> {
  const filters = buildOrdersFilters(view);
  const { data, error } = await rpc(filters, signal);
  if (error || !data || typeof data !== 'object' || !('orders' in data) || !Array.isArray(data.orders) || !('total' in data) || typeof data.total !== 'number' || !Number.isSafeInteger(data.total) || data.total < 0) {
    throw new Error('Não foi possível carregar os pedidos. Tenta novamente.');
  }
  if (data.orders.length > filters.limit || data.total < data.orders.length) {
    throw new Error('Actualiza a base de dados para activar a paginação de pedidos.');
  }
  const statusCounts = 'status_counts' in data ? readStatusCounts(data.status_counts) : null;
  return { orders: data.orders as T[], total: data.total, ...(statusCounts ? { statusCounts } : {}) };
}
