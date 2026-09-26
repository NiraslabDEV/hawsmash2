export type Cents = number & { __brand: 'cents' };

export const cents = (n: number): Cents => {
  if (!Number.isInteger(n) || n < 0) throw new Error('invalid cents');
  return n as Cents;
};

export const centsToDecimalString = (c: Cents): string => (c / 100).toFixed(2);

/**
 * "1250.50" → 125050, sem passar por float (CLAUDE §1 regra 2).
 *
 * Aceita inteiro com casas decimais opcionais, ponto ou vírgula. A partir da
 * terceira casa arredonda meio para cima ("99.995" → 10000). Tudo o resto —
 * negativo, notação científica, texto a seguir ao número ("12abc", que o
 * `parseFloat` aceitava como 12) — é recusado.
 */
export const decimalStringToCents = (decimal: string): Cents => {
  const match = /^(\d+)(?:[.,](\d+))?$/.exec(String(decimal).trim());
  if (!match) throw new Error('invalid decimal');
  const frac = match[2] ?? '';
  const roundUp = frac.length > 2 && Number(frac[2]) >= 5 ? 1 : 0;
  const value = Number(match[1]) * 100 + Number(frac.slice(0, 2).padEnd(2, '0')) + roundUp;
  if (!Number.isSafeInteger(value)) throw new Error('invalid decimal');
  return cents(value);
};

// Preços em MZN são, na prática, valores redondos ("1200MT" nos cartazes).
// Só mostramos casas decimais quando o valor realmente as tem.
export const formatMT = (c: Cents): string =>
  `${(c / 100).toLocaleString('pt-MZ', {
    minimumFractionDigits: c % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })} MT`;

export const orderTotal = (items: { qty: number; unitPriceCents: Cents }[]): Cents =>
  cents(items.reduce((sum, i) => sum + i.qty * i.unitPriceCents, 0));
