/**
 * O talão do fecho do dia (1091): os turnos do dia, quem abriu e fechou cada
 * um, e a soma — vendas por forma de pagamento, movimentos e a diferença.
 *
 * Chega ao bridge como um fecho de caixa (`kind = 'cash_close'`) com `day` e
 * `shifts`. O bridge antigo não conhece estes campos e imprime-o no formato do
 * fecho de turno, com "FECHO DO DIA" na linha do turno — por isso o payload
 * traz também todos os campos desse formato.
 */

import {
  ALIGN_LEFT,
  BOLD_OFF,
  BOLD_ON,
  CUT,
  FEED_BEFORE_CUT,
  SIZE_DOUBLE,
  SIZE_NORMAL,
  feed,
  line,
  maputoTime,
  mt,
  rule,
  signedMT,
  twoColumns,
  wrap,
  type Op,
} from './ops';
import { isCashClosePayload, type CashClosePayload, type PrintPayload } from './types';

export interface CashDayShift {
  session_id: string;
  shift_label: string;
  opened_at: string;
  closed_at: string;
  opened_by_name?: string | null;
  closed_by_name?: string | null;
  opening_float_cents: number;
  expected_cash_cents: number;
  counted_cash_cents: number;
  difference_cents: number;
  difference_reason?: string | null;
  total_pedidos: number;
  total_faturado_cents: number;
}

export interface CashDayPayload extends CashClosePayload {
  day: true;
  business_date: string;
  shifts_count: number;
  first_opened_at: string;
  /** O que ficou na gaveta: a contagem do último turno. */
  closing_cash_cents: number;
  total_pedidos: number;
  total_faturado_cents: number;
  troco_inicial_cents: number;
  shifts: CashDayShift[];
}

export function isCashDayPayload(p: PrintPayload): p is CashDayPayload {
  return (
    isCashClosePayload(p) &&
    (p as CashDayPayload).day === true &&
    Array.isArray((p as CashDayPayload).shifts)
  );
}

const cents = (value: unknown) => (Number.isInteger(value) ? (value as number) : 0);

function businessDate(iso: string): string {
  const [year, month, day] = iso.split('-');
  return year && month && day ? `${day}/${month}/${year}` : iso;
}

/** `header` é o cabeçalho da marca, que vive em `tickets.ts`. */
export function buildCashDayReceipt(payload: CashDayPayload, header: Op[]): Op[] {
  const ops: Op[] = [...header];
  const turnos = payload.shifts.length === 1 ? '1 turno' : `${payload.shifts.length} turnos`;
  ops.push(SIZE_DOUBLE, BOLD_ON, line('FECHO DO DIA'), BOLD_OFF, SIZE_NORMAL);
  ops.push(line(`${businessDate(payload.business_date)} - ${turnos}`));
  ops.push(line(`${maputoTime(payload.first_opened_at)} - ${maputoTime(payload.closed_at)}`));
  ops.push(ALIGN_LEFT, line(rule('=')), BOLD_ON, line('TURNOS'), BOLD_OFF);

  payload.shifts.forEach((shift, index) => {
    if (index > 0) ops.push(line(rule('-')));
    ops.push(line(`${index + 1}. ${maputoTime(shift.opened_at)} - ${maputoTime(shift.closed_at)}`));
    const quem = `Abriu ${shift.opened_by_name ?? '-'} / Fechou ${shift.closed_by_name ?? '-'}`;
    for (const quemLinha of wrap(quem)) ops.push(line(quemLinha));
    ops.push(line(twoColumns(`Pedidos ${cents(shift.total_pedidos)}`, mt(cents(shift.total_faturado_cents)))));
    ops.push(line(twoColumns('Contado', mt(cents(shift.counted_cash_cents)))));
    ops.push(line(twoColumns('Diferenca', signedMT(cents(shift.difference_cents)))));
    if (shift.difference_reason) {
      for (const motivo of wrap(`Motivo: ${shift.difference_reason}`)) ops.push(line(motivo));
    }
  });

  ops.push(line(rule('=')), BOLD_ON, line('VENDAS'), BOLD_OFF);
  ops.push(line(twoColumns('Pedidos', String(cents(payload.total_pedidos)))));
  ops.push(line(twoColumns('Dinheiro', mt(cents(payload.payments.cash)))));
  ops.push(line(twoColumns('M-Pesa', mt(cents(payload.payments.mpesa)))));
  ops.push(line(twoColumns('e-Mola', mt(cents(payload.payments.emola)))));
  ops.push(line(twoColumns('Cartao', mt(cents(payload.payments.credit_card)))));
  ops.push(BOLD_ON, line(twoColumns('TOTAL', mt(cents(payload.total_faturado_cents)))), BOLD_OFF);

  ops.push(line(rule('-')));
  ops.push(line(twoColumns('Sangrias', `-${mt(cents(payload.sangria_cents))}`)));
  ops.push(line(twoColumns('Reforcos', mt(cents(payload.reforco_cents)))));
  ops.push(line(twoColumns('Despesas', `-${mt(cents(payload.despesa_cents))}`)));
  if (cents(payload.troco_inicial_cents) > 0) {
    ops.push(line(twoColumns('Troco inicial', mt(cents(payload.troco_inicial_cents)))));
  }

  ops.push(line(rule('-')));
  ops.push(line(twoColumns('Fundo no inicio', mt(cents(payload.opening_float_cents)))));
  ops.push(line(twoColumns('Na gaveta ao fechar', mt(cents(payload.closing_cash_cents)))));
  ops.push(BOLD_ON, line(twoColumns('DIFERENCA DO DIA', signedMT(cents(payload.difference_cents)))), BOLD_OFF);

  if (payload.closed_by_name) ops.push(feed(1), line(`Fechado por: ${payload.closed_by_name}`));
  ops.push(feed(FEED_BEFORE_CUT), CUT);
  return ops;
}
