import type { CounterPayment } from './payment';

/**
 * O fecho de uma venda no ecrã "VENDA REGISTADA".
 *
 * Com dinheiro na venda, o ecrã **não se fecha sozinho**: mostra o troco em
 * grande e espera que o caixa toque em OK depois de o entregar (decisão do
 * dono, 24 Set). Três segundos a passar por cima do troco eram o sítio onde a
 * gaveta começava a não bater no fecho — e a discussão vinha depois, sem
 * ninguém se lembrar de quanto se deu.
 *
 * O troco mostrado é o que o **servidor** gravou (`orders.change_cents`,
 * §7.3), não o que o POS calculou. Se os dois diferirem, o ecrã diz — é o do
 * servidor que conta no fecho de caixa.
 */
export type SaleClosing = {
  /** Só fecha com um toque em OK. */
  requiresAck: boolean;
  /** A parte da venda paga em dinheiro. 0 = venda sem dinheiro. */
  cashDueCents: number;
  receivedCents: number | null;
  changeCents: number | null;
  /** O servidor gravou um troco diferente do que o POS mostrou ao pagar. */
  changeMismatch: boolean;
  /** Os meios que não são dinheiro, para o caixa confirmar o resto. */
  otherPayments: CounterPayment[];
};

export function buildSaleClosing({
  payments,
  cashReceivedCents,
  clientChangeCents,
  serverChangeCents,
}: {
  payments: CounterPayment[];
  cashReceivedCents: number | null;
  clientChangeCents: number | null;
  /** O que a RPC devolveu. `undefined` offline: ainda não há servidor. */
  serverChangeCents?: unknown;
}): SaleClosing {
  const cashDueCents = payments
    .filter((p) => p.method === 'cash')
    .reduce((sum, p) => sum + p.amountCents, 0);
  const otherPayments = payments.filter((p) => p.method !== 'cash' && p.amountCents > 0);

  if (cashDueCents === 0) {
    return {
      requiresAck: false,
      cashDueCents: 0,
      receivedCents: null,
      changeCents: null,
      changeMismatch: false,
      otherPayments,
    };
  }

  const server =
    typeof serverChangeCents === 'number' && Number.isSafeInteger(serverChangeCents) && serverChangeCents >= 0
      ? serverChangeCents
      : null;
  const changeCents = server ?? clientChangeCents;

  return {
    requiresAck: true,
    cashDueCents,
    receivedCents: cashReceivedCents,
    changeCents,
    changeMismatch: server !== null && clientChangeCents !== null && server !== clientChangeCents,
    otherPayments,
  };
}
