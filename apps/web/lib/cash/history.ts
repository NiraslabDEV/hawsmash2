/**
 * O histórico do caixa de uma loja — os turnos fechados e os fechos do dia
 * (1091), com o que cada fecho congelou (1095). O mesmo no painel e no POS:
 * só se lê, com a sessão de quem está a ver, e a RLS deixa ver a loja dele
 * (a cozinha não vê dinheiro, CLAUDE §6).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { parseCashSold, type CashSold } from '@delivery/receipt';

import { parseCashDayReport, type CashDayReport } from './day';

export type CashPayments = { cash: number; mpesa: number; emola: number; credit_card: number };

export type ShiftReport = {
  total_pedidos: number | null;
  total_faturado_cents: number | null;
  payments: CashPayments | null;
  cash_sales_cents: number;
  sangria_cents: number;
  reforco_cents: number;
  despesa_cents: number;
  troco_inicial_cents: number;
  sold: CashSold | null;
};

export type ShiftRow = {
  id: string;
  store_id: string;
  shift_label: string;
  opened_at: string;
  closed_at: string;
  opening_float_cents: number;
  expected_cash_cents: number;
  counted_cash_cents: number;
  difference_cents: number;
  difference_reason: string | null;
  day_close_id: string | null;
  report: ShiftReport;
};

export type DayCloseRow = {
  id: string;
  store_id: string;
  business_date: string;
  closed_at: string;
  report: CashDayReport | null;
  backfill: boolean;
};

export type ShiftPeople = { opened: string | null; closed: string | null };

export type CashHistory = {
  shifts: ShiftRow[];
  days: DayCloseRow[];
  /** Quem abriu e fechou cada turno, por `cash_sessions.id`. */
  people: Map<string, ShiftPeople>;
};

const isCents = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value);
const cents = (value: unknown) => (isCents(value) ? value : 0);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** O `report` de um turno, lido com desconfiança: o que faltar fica a zero ou vazio. */
export function parseShiftReport(raw: unknown): ShiftReport {
  const record = isRecord(raw) ? raw : {};
  const payments = isRecord(record.payments) ? record.payments : null;
  const hasPayments = !!payments && ['cash', 'mpesa', 'emola', 'credit_card'].every((key) => isCents(payments[key]));
  return {
    total_pedidos: isCents(record.total_pedidos) ? record.total_pedidos : null,
    total_faturado_cents: isCents(record.total_faturado_cents) ? record.total_faturado_cents : null,
    payments: hasPayments
      ? {
          cash: payments.cash as number,
          mpesa: payments.mpesa as number,
          emola: payments.emola as number,
          credit_card: payments.credit_card as number,
        }
      : null,
    cash_sales_cents: cents(record.cash_sales_cents),
    sangria_cents: cents(record.sangria_cents),
    reforco_cents: cents(record.reforco_cents),
    despesa_cents: cents(record.despesa_cents),
    troco_inicial_cents: cents(record.troco_inicial_cents),
    sold: parseCashSold(record.sold),
  };
}

export function parseShiftRow(row: Record<string, unknown>): ShiftRow {
  return {
    id: String(row.id),
    store_id: String(row.store_id),
    shift_label: String(row.shift_label ?? ''),
    opened_at: String(row.opened_at),
    closed_at: String(row.closed_at),
    opening_float_cents: cents(row.opening_float_cents),
    expected_cash_cents: cents(row.expected_cash_cents),
    counted_cash_cents: cents(row.counted_cash_cents),
    difference_cents: cents(row.difference_cents),
    difference_reason: typeof row.difference_reason === 'string' ? row.difference_reason : null,
    day_close_id: typeof row.day_close_id === 'string' ? row.day_close_id : null,
    report: parseShiftReport(row.report),
  };
}

export function parseDayCloseRow(row: Record<string, unknown>): DayCloseRow {
  return {
    id: String(row.id),
    store_id: String(row.store_id),
    business_date: String(row.business_date),
    closed_at: String(row.closed_at),
    report: parseCashDayReport(row.report),
    backfill: isRecord(row.report) && row.report.backfill === true,
  };
}

/**
 * Os nomes de quem abriu e fechou só vêm nos relatórios do dia: os fechados
 * e, com a loja escolhida, o do dia por fechar — é aí que estão os turnos de
 * hoje.
 */
export function shiftPeople(reports: Array<CashDayReport | null | undefined>): Map<string, ShiftPeople> {
  const map = new Map<string, ShiftPeople>();
  for (const report of reports) {
    for (const shift of report?.shifts ?? []) {
      if (shift.session_id) map.set(shift.session_id, { opened: shift.opened_by_name, closed: shift.closed_by_name });
    }
  }
  return map;
}

const SHIFT_COLUMNS =
  'id,store_id,shift_label,opened_at,closed_at,opening_float_cents,expected_cash_cents,counted_cash_cents,difference_cents,difference_reason,day_close_id,report';

/**
 * Os últimos `limit` turnos fechados e fechos do dia. Sem `storeId`, todas as
 * lojas do perfil (a RLS filtra). Os fechos do dia e o dia por fechar são
 * best-effort: sem eles, os turnos aparecem na mesma, só sem os nomes.
 */
export async function fetchCashHistory(
  supabase: SupabaseClient,
  { storeId, limit }: { storeId: string | null; limit: number },
): Promise<{ ok: true; history: CashHistory } | { ok: false; message: string }> {
  let shiftQuery = supabase
    .from('cash_sessions')
    .select(SHIFT_COLUMNS)
    .not('closed_at', 'is', null)
    .order('closed_at', { ascending: false })
    .limit(limit);
  let dayQuery = supabase
    .from('cash_day_closes')
    .select('id,store_id,business_date,closed_at,report')
    .order('closed_at', { ascending: false })
    .limit(limit);
  if (storeId) {
    shiftQuery = shiftQuery.eq('store_id', storeId);
    dayQuery = dayQuery.eq('store_id', storeId);
  }
  const pendingQuery = storeId
    ? supabase.rpc('get_cash_day', { p_store: storeId })
    : Promise.resolve({ data: null, error: null });

  const [shiftResult, dayResult, pendingResult] = await Promise.all([shiftQuery, dayQuery, pendingQuery]);
  if (shiftResult.error) return { ok: false, message: shiftResult.error.message };

  const days = dayResult.error ? [] : ((dayResult.data ?? []) as Record<string, unknown>[]).map(parseDayCloseRow);
  const pendingRaw = pendingResult.error ? null : (pendingResult.data as { pending?: unknown } | null)?.pending;
  return {
    ok: true,
    history: {
      shifts: ((shiftResult.data ?? []) as Record<string, unknown>[]).map(parseShiftRow),
      days,
      people: shiftPeople([...days.map((day) => day.report), parseCashDayReport(pendingRaw)]),
    },
  };
}

/** O dia de Maputo de um instante, `YYYY-MM-DD`. */
export const maputoDay = (iso: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Maputo', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(iso));

/** `2026-09-27` → "Hoje", "Ontem" ou "sáb., 25/09". */
export function dayHeading(day: string, now: Date = new Date()): string {
  const today = maputoDay(now.toISOString());
  const yesterday = maputoDay(new Date(now.getTime() - 86_400_000).toISOString());
  if (day === today) return 'Hoje';
  if (day === yesterday) return 'Ontem';
  const [year, month, date] = day.split('-').map(Number);
  if (!year || !month || !date) return day;
  return new Intl.DateTimeFormat('pt-PT', { timeZone: 'UTC', weekday: 'short', day: '2-digit', month: '2-digit' })
    .format(new Date(Date.UTC(year, month - 1, date)));
}

/** `10h39` ou `45 min`. */
export function duration(fromIso: string, toIso: string): string {
  const minutes = Math.max(0, Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 60_000));
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours}h${String(minutes % 60).padStart(2, '0')}` : `${minutes} min`;
}

/** Itens seguidos do mesmo dia juntam-se num grupo; a ordem da lista mantém-se. */
export function groupByDay<T>(items: T[], dayOf: (item: T) => string): Array<{ day: string; items: T[] }> {
  const groups: Array<{ day: string; items: T[] }> = [];
  for (const item of items) {
    const day = dayOf(item);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(item);
    else groups.push({ day, items: [item] });
  }
  return groups;
}

/** A parte de cada meio no total, em % inteiros; tudo a zero sem vendas. */
export function paymentShares(payments: CashPayments): CashPayments {
  const total = payments.cash + payments.mpesa + payments.emola + payments.credit_card;
  const share = (value: number) => (total > 0 ? Math.round((value / total) * 100) : 0);
  return {
    cash: share(payments.cash),
    mpesa: share(payments.mpesa),
    emola: share(payments.emola),
    credit_card: share(payments.credit_card),
  };
}
