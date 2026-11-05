/**
 * As métricas dos garçons no painel (1123).
 *
 * A conta é toda da BD (`get_waiter_metrics`). Aqui só se decide a janela que
 * se pede, como se ordena, quem ganha cada destaque e os buracos dos gráficos.
 */

export type WaiterMetrics = {
  id: string;
  full_name: string;
  active: boolean;
  store_short_name: string;
  orders: number;
  revenue_cents: number;
  avg_ticket_cents: number;
  items: number;
  tables: number;
  active_days: number;
  extras_cents: number;
  served: number;
  median_minutes_to_serve: number | null;
  cancelled_orders: number;
  removed_events: number;
  removed_cents: number;
  paid_cents: number;
  open_cents: number;
  last_order_at: string | null;
};

export type MetricsTotals = {
  orders: number;
  revenue_cents: number;
  avg_ticket_cents: number;
  items: number;
  tables: number;
  extras_cents: number;
  cancelled_orders: number;
  removed_cents: number;
  paid_cents: number;
  open_cents: number;
};

export type OriginSlice = { orders: number; revenue_cents: number };

export type MetricsReport = {
  waiters: WaiterMetrics[];
  totals: MetricsTotals;
  by_day: Array<{ day: string; orders: number; revenue_cents: number }>;
  by_hour: Array<{ hour: number; orders: number }>;
  top_items: Array<{ name: string; qty: number; revenue_cents: number }>;
  table_origin: { waiter: OriginSlice; counter: OriginSlice; qr: OriginSlice };
};

// ─── Período ──────────────────────────────────────────────────────────────────

export type MetricsPeriod = 'today' | '7d' | '30d' | 'month' | 'all';

export const PERIOD_LABEL: Record<MetricsPeriod, string> = {
  today: 'Hoje',
  '7d': '7 dias',
  '30d': '30 dias',
  month: 'Este mês',
  all: 'Tudo',
};

export type PeriodRange = {
  from: string | null;
  to: string | null;
  /** A janela anterior, do mesmo tamanho, para comparar. Null em "Tudo". */
  previous: { from: string; to: string } | null;
};

const DAY_MS = 86_400_000;
/** Moçambique é UTC+2 todo o ano: sem hora de Verão. */
const inicioDoDia = (dia: string) => new Date(`${dia}T00:00:00+02:00`);

export function maputoDay(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Maputo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** A janela de cada período, a dias inteiros de Maputo; o fim é amanhã às 00:00. */
export function periodRange(period: MetricsPeriod, now = new Date()): PeriodRange {
  if (period === 'all') return { from: null, to: null, previous: null };
  const hoje = maputoDay(now);
  const to = new Date(inicioDoDia(hoje).getTime() + DAY_MS);
  const from =
    period === 'today'
      ? inicioDoDia(hoje)
      : period === '7d'
        ? new Date(to.getTime() - 7 * DAY_MS)
        : period === '30d'
          ? new Date(to.getTime() - 30 * DAY_MS)
          : inicioDoDia(`${hoje.slice(0, 8)}01`);
  const tamanho = to.getTime() - from.getTime();
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    previous: { from: new Date(from.getTime() - tamanho).toISOString(), to: from.toISOString() },
  };
}

/** Variação em % face ao período anterior. Sem base (zero), não há percentagem. */
export function deltaPct(actual: number, anterior: number | null | undefined): number | null {
  if (anterior == null || anterior <= 0) return null;
  return Math.round(((actual - anterior) / anterior) * 100);
}

// ─── Ranking ──────────────────────────────────────────────────────────────────

export type RankKey =
  | 'orders'
  | 'revenue_cents'
  | 'avg_ticket_cents'
  | 'items'
  | 'tables'
  | 'extras_cents'
  | 'served';

export const RANK_LABEL: Record<RankKey, string> = {
  orders: 'Pedidos',
  revenue_cents: 'Vendas',
  avg_ticket_cents: 'Ticket médio',
  items: 'Artigos',
  tables: 'Mesas',
  extras_cents: 'Extras',
  served: 'Servidos',
};

export const RANK_IS_MONEY: Record<RankKey, boolean> = {
  orders: false,
  revenue_cents: true,
  avg_ticket_cents: true,
  items: false,
  tables: false,
  extras_cents: true,
  served: false,
};

/** Do maior para o menor; em empate, mais vendas e depois o nome. A lista original não muda. */
export function rankWaiters(waiters: readonly WaiterMetrics[], key: RankKey): WaiterMetrics[] {
  return [...waiters].sort(
    (a, b) => b[key] - a[key] || b.revenue_cents - a.revenue_cents || a.full_name.localeCompare(b.full_name, 'pt'),
  );
}

/** Artigos por pedido, com uma casa. Zero pedidos não é divisão por zero. */
export function itemsPerOrder(w: Pick<WaiterMetrics, 'items' | 'orders'>): number {
  return w.orders > 0 ? Math.round((w.items / w.orders) * 10) / 10 : 0;
}

/** Um pedido só não faz campeão: ticket e rapidez pedem esta amostra mínima. */
export const AMOSTRA_MINIMA = 5;

export type Highlight = { label: string; waiter: WaiterMetrics; value: number; kind: 'count' | 'money' | 'minutes' };

function melhor(
  waiters: readonly WaiterMetrics[],
  valor: (w: WaiterMetrics) => number | null,
  criterio: 'maior' | 'menor',
): { waiter: WaiterMetrics; value: number } | null {
  let vencedor: { waiter: WaiterMetrics; value: number } | null = null;
  for (const waiter of waiters) {
    const value = valor(waiter);
    if (value == null) continue;
    if (
      !vencedor ||
      (criterio === 'maior' ? value > vencedor.value : value < vencedor.value) ||
      (value === vencedor.value && waiter.revenue_cents > vencedor.waiter.revenue_cents)
    ) {
      vencedor = { waiter, value };
    }
  }
  return vencedor;
}

/** Os destaques do período. Um destaque sem ninguém que o mereça não aparece. */
export function highlights(waiters: readonly WaiterMetrics[]): Highlight[] {
  const positivo = (n: number) => (n > 0 ? n : null);
  const comAmostra = (w: WaiterMetrics) => w.orders >= AMOSTRA_MINIMA;
  const lista: Array<Highlight | null> = [
    comKind('Mais pedidos', 'count', melhor(waiters, (w) => positivo(w.orders), 'maior')),
    comKind('Mais vendas', 'money', melhor(waiters, (w) => positivo(w.revenue_cents), 'maior')),
    comKind('Maior ticket médio', 'money', melhor(waiters, (w) => (comAmostra(w) ? positivo(w.avg_ticket_cents) : null), 'maior')),
    comKind('Mais extras vendidos', 'money', melhor(waiters, (w) => positivo(w.extras_cents), 'maior')),
    comKind('Mais rápido a servir', 'minutes', melhor(waiters, (w) => (comAmostra(w) ? w.median_minutes_to_serve : null), 'menor')),
  ];
  return lista.filter((h): h is Highlight => h !== null);
}

function comKind(
  label: string,
  kind: Highlight['kind'],
  m: { waiter: WaiterMetrics; value: number } | null,
): Highlight | null {
  return m ? { label, kind, ...m } : null;
}

// ─── Gráficos ─────────────────────────────────────────────────────────────────

/**
 * Os dias sem pedidos também contam: sem eles, o gráfico colava segunda a
 * sexta e parecia que não tinha havido quebra. Em "Tudo", vai do primeiro dia
 * com pedidos ao último.
 */
export function fillDays(
  rows: MetricsReport['by_day'],
  range: Pick<PeriodRange, 'from' | 'to'>,
): MetricsReport['by_day'] {
  const inicio = range.from ? maputoDay(new Date(range.from)) : rows[0]?.day;
  const fim = range.to ? maputoDay(new Date(new Date(range.to).getTime() - 1)) : rows[rows.length - 1]?.day;
  if (!inicio || !fim) return [];
  const porDia = new Map(rows.map((r) => [r.day, r]));
  const dias: MetricsReport['by_day'] = [];
  for (let t = inicioDoDia(inicio).getTime(); t <= inicioDoDia(fim).getTime(); t += DAY_MS) {
    const day = maputoDay(new Date(t));
    dias.push(porDia.get(day) ?? { day, orders: 0, revenue_cents: 0 });
  }
  return dias;
}

/** Da primeira à última hora com pedidos, sem buracos e sem a madrugada vazia. */
export function fillHours(rows: MetricsReport['by_hour']): Array<{ hour: string; orders: number }> {
  if (rows.length === 0) return [];
  const horas = rows.map((r) => r.hour);
  const porHora = new Map(rows.map((r) => [r.hour, r.orders]));
  const lista: Array<{ hour: string; orders: number }> = [];
  for (let h = Math.min(...horas); h <= Math.max(...horas); h += 1) {
    lista.push({ hour: `${String(h).padStart(2, '0')}h`, orders: porHora.get(h) ?? 0 });
  }
  return lista;
}

/** A fatia de cada origem nos pedidos de mesa, em %, a somar 100 quando há pedidos. */
export function originShare(origin: MetricsReport['table_origin']): { waiter: number; counter: number; qr: number } {
  const total = origin.waiter.orders + origin.counter.orders + origin.qr.orders;
  if (total === 0) return { waiter: 0, counter: 0, qr: 0 };
  const waiter = Math.round((origin.waiter.orders / total) * 100);
  const counter = Math.round((origin.counter.orders / total) * 100);
  return { waiter, counter, qr: 100 - waiter - counter };
}

/** Frase para os minutos: "12 min", "—" quando ninguém marcou entregue. */
export function formatMinutes(min: number | null): string {
  if (min == null) return '—';
  return min < 10 ? `${min.toFixed(1).replace('.', ',')} min` : `${Math.round(min)} min`;
}
