/**
 * Os artigos vendidos no talão do fecho — de turno e do dia (1095).
 *
 * Chegam no payload como `sold`, a lista que a `close_cash_session` congelou
 * (ou que a `close_cash_day` somou): por produto e variante, com a quantidade
 * e o valor, que já leva os extras. Um fecho anterior à 1095 não a traz e o
 * talão sai como sempre — os bytes desse papel não mudam.
 *
 * O bridge antigo ignora o campo: a lista só sai em papel com o `.exe` novo.
 */

import { BOLD_OFF, BOLD_ON, WIDTH, line, mt, rule, twoColumns, wrap, type Op } from './ops';

export interface CashSoldItem {
  name: string;
  variant: string | null;
  qty: number;
  total_cents: number;
}

export interface CashSold {
  items: CashSoldItem[];
  items_total_cents: number;
  delivery_fees_cents: number;
  discounts_cents: number;
}

const isCents = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

function parseItem(raw: unknown): CashSoldItem | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.name !== 'string' || raw.name.trim() === '') return null;
  if (!isCents(raw.qty) || !isCents(raw.total_cents)) return null;
  const variant = typeof raw.variant === 'string' && raw.variant.trim() !== '' ? raw.variant : null;
  return { name: raw.name, variant, qty: raw.qty, total_cents: raw.total_cents };
}

/**
 * A lista, lida com desconfiança: um valor que não venha em centavos inteiros
 * descarta a lista inteira. Uma lista errada com ar de certa é pior do que
 * nenhuma — e o fecho continua a sair sem ela.
 */
export function parseCashSold(raw: unknown): CashSold | null {
  if (!isRecord(raw) || !Array.isArray(raw.items)) return null;
  if (![raw.items_total_cents, raw.delivery_fees_cents, raw.discounts_cents].every(isCents)) return null;
  const items = raw.items.map(parseItem);
  if (items.some((item) => item === null)) return null;
  return {
    items: items as CashSoldItem[],
    items_total_cents: raw.items_total_cents as number,
    delivery_fees_cents: raw.delivery_fees_cents as number,
    discounts_cents: raw.discounts_cents as number,
  };
}

export function cashSoldItemLabel(item: CashSoldItem): string {
  return `${item.qty}x ${item.name}${item.variant ? ` ${item.variant}` : ''}`;
}

/** `12x Classic Smash WAGYU ....... 4.800,00 MT`; um nome comprido parte-se por cima. */
function itemLines(item: CashSoldItem): Op[] {
  const valor = mt(item.total_cents);
  const partes = wrap(cashSoldItemLabel(item), WIDTH - valor.length - 1);
  const ultima = partes.pop() ?? '';
  return [...partes.map((parte) => line(parte)), line(twoColumns(ultima, valor))];
}

/** A secção do talão; vazia quando o payload não traz lista. */
export function cashSoldSection(raw: unknown): Op[] {
  const sold = parseCashSold(raw);
  if (!sold) return [];
  const ops: Op[] = [line(rule('=')), BOLD_ON, line('ARTIGOS VENDIDOS'), BOLD_OFF];
  if (sold.items.length === 0) {
    ops.push(line('Nenhum artigo vendido'));
    return ops;
  }
  for (const item of sold.items) ops.push(...itemLines(item));
  ops.push(line(rule('-')));
  ops.push(BOLD_ON, line(twoColumns('Total artigos', mt(sold.items_total_cents))), BOLD_OFF);
  if (sold.delivery_fees_cents > 0) {
    ops.push(line(twoColumns('Taxas de entrega', mt(sold.delivery_fees_cents))));
  }
  if (sold.discounts_cents > 0) {
    ops.push(line(twoColumns('Descontos', `-${mt(sold.discounts_cents)}`)));
  }
  return ops;
}
