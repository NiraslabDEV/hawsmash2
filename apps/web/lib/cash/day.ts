/**
 * O relatório do fecho do dia (1091), como o servidor o grava em
 * `cash_day_closes.report` e o devolve no `get_cash_day`.
 *
 * Módulo leve de propósito: o POS lê-o no browser e o email lê-o no servidor.
 * O PDF e o email de turno ficam em `report.ts`, que puxa o `pdf-lib`.
 */

export type CashDayShift = {
  session_id: string;
  shift_label: string;
  opened_at: string;
  closed_at: string;
  opened_by_name: string | null;
  closed_by_name: string | null;
  opening_float_cents: number;
  expected_cash_cents: number;
  counted_cash_cents: number;
  difference_cents: number;
  difference_reason: string | null;
  total_pedidos: number;
  total_faturado_cents: number;
};

export type CashDayReport = {
  day_close_id: string | null;
  business_date: string;
  shifts_count: number;
  first_opened_at: string;
  last_shift_closed_at: string;
  closed_at: string | null;
  closed_by_name: string | null;
  opening_float_cents: number;
  /** O que ficou na gaveta: a contagem do último turno. */
  closing_cash_cents: number;
  total_pedidos: number;
  total_faturado_cents: number;
  payments: { cash: number; mpesa: number; emola: number; credit_card: number };
  cash_sales_cents: number;
  sangria_cents: number;
  reforco_cents: number;
  despesa_cents: number;
  troco_inicial_cents: number;
  difference_cents: number;
  shifts: CashDayShift[];
};

const MONEY = [
  'shifts_count',
  'opening_float_cents',
  'closing_cash_cents',
  'total_pedidos',
  'total_faturado_cents',
  'cash_sales_cents',
  'sangria_cents',
  'reforco_cents',
  'despesa_cents',
  'troco_inicial_cents',
  'difference_cents',
] as const;

const SHIFT_MONEY = [
  'opening_float_cents',
  'expected_cash_cents',
  'counted_cash_cents',
  'difference_cents',
  'total_pedidos',
  'total_faturado_cents',
] as const;

const isCents = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const textOrNull = (value: unknown) => (typeof value === 'string' ? value : null);

function parseShift(raw: unknown): CashDayShift | null {
  if (!isRecord(raw)) return null;
  if (!SHIFT_MONEY.every((field) => isCents(raw[field]))) return null;
  if (typeof raw.opened_at !== 'string' || typeof raw.closed_at !== 'string') return null;
  return {
    session_id: String(raw.session_id ?? ''),
    shift_label: String(raw.shift_label ?? ''),
    opened_at: raw.opened_at,
    closed_at: raw.closed_at,
    opened_by_name: textOrNull(raw.opened_by_name),
    closed_by_name: textOrNull(raw.closed_by_name),
    opening_float_cents: raw.opening_float_cents as number,
    expected_cash_cents: raw.expected_cash_cents as number,
    counted_cash_cents: raw.counted_cash_cents as number,
    difference_cents: raw.difference_cents as number,
    difference_reason: textOrNull(raw.difference_reason),
    total_pedidos: raw.total_pedidos as number,
    total_faturado_cents: raw.total_faturado_cents as number,
  };
}

/**
 * Dinheiro que não venha em centavos inteiros invalida a leitura inteira:
 * um total do dia errado com ar de certo é pior do que "não foi possível".
 */
export function parseCashDayReport(raw: unknown): CashDayReport | null {
  if (!isRecord(raw)) return null;
  if (!MONEY.every((field) => isCents(raw[field]))) return null;
  const payments = raw.payments;
  if (!isRecord(payments) || !['cash', 'mpesa', 'emola', 'credit_card'].every((key) => isCents(payments[key]))) {
    return null;
  }
  if (typeof raw.business_date !== 'string' || typeof raw.first_opened_at !== 'string') return null;
  if (!Array.isArray(raw.shifts)) return null;
  const shifts = raw.shifts.map(parseShift);
  if (shifts.some((shift) => shift === null)) return null;

  return {
    day_close_id: textOrNull(raw.day_close_id),
    business_date: raw.business_date,
    shifts_count: raw.shifts_count as number,
    first_opened_at: raw.first_opened_at,
    last_shift_closed_at: String(raw.last_shift_closed_at ?? raw.first_opened_at),
    closed_at: textOrNull(raw.closed_at),
    closed_by_name: textOrNull(raw.closed_by_name),
    opening_float_cents: raw.opening_float_cents as number,
    closing_cash_cents: raw.closing_cash_cents as number,
    total_pedidos: raw.total_pedidos as number,
    total_faturado_cents: raw.total_faturado_cents as number,
    payments: {
      cash: payments.cash as number,
      mpesa: payments.mpesa as number,
      emola: payments.emola as number,
      credit_card: payments.credit_card as number,
    },
    cash_sales_cents: raw.cash_sales_cents as number,
    sangria_cents: raw.sangria_cents as number,
    reforco_cents: raw.reforco_cents as number,
    despesa_cents: raw.despesa_cents as number,
    troco_inicial_cents: raw.troco_inicial_cents as number,
    difference_cents: raw.difference_cents as number,
    shifts: shifts as CashDayShift[],
  };
}

export function dayShiftsLabel(count: number): string {
  return count === 1 ? '1 turno' : `${count} turnos`;
}

/** `2026-09-25` → `25/09/2026`: o dia de Maputo, sem passar por fusos. */
export function businessDateLabel(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  return year && month && day ? `${day}/${month}/${year}` : isoDate;
}
