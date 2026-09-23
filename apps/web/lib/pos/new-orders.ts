/**
 * "Chegou um pedido" — o alarme do balcão, a parte que se testa sem browser.
 *
 * O caixa passa o turno no ecrã de vender, não no quadro. Um pedido que entra
 * pela internet tem de se fazer ouvir e ver dali, senão fica à espera até
 * alguém se lembrar de abrir "Pedidos" (pedido do dono, 23 Set).
 *
 * Duas coisas diferentes, de propósito:
 *   · **chegou** — um pedido online que este terminal ainda não viu. Toca uma
 *     vez e o botão pisca até alguém abrir o quadro.
 *   · **à espera de ti** — um pedido manual por aprovar. O botão continua a
 *     piscar enquanto houver algum, mesmo depois de visto: o cliente pagou e
 *     está à espera de que alguém confira o comprovativo.
 *
 * As vendas de balcão nunca contam: foi o próprio caixa que as fez.
 */

export type AlertOrder = { id: string; status: string; channel: string };

/** Estados em que um pedido online "chegou" à loja e alguém tem de saber. */
export const ARRIVAL_STATUSES = ['awaiting_approval', 'approved', 'paid'] as const;

export function isOnlineOrder(order: AlertOrder): boolean {
  return order.channel !== 'counter';
}

export function needsApproval(order: AlertOrder): boolean {
  return isOnlineOrder(order) && order.status === 'awaiting_approval';
}

/** Pedidos online que o terminal ainda não tinha visto. */
export function arrivals(orders: AlertOrder[], known: ReadonlySet<string>): AlertOrder[] {
  return orders.filter(
    (o) =>
      isOnlineOrder(o) &&
      (ARRIVAL_STATUSES as readonly string[]).includes(o.status) &&
      !known.has(o.id),
  );
}

export type AlertState = {
  /** Pedidos manuais à espera de aprovação. */
  porAprovar: number;
  /** Pedidos que chegaram desde a última vez que alguém abriu o quadro. */
  naoVistos: number;
  /** O número do crachá: cada pedido conta uma vez, mesmo sendo as duas coisas. */
  aAtender: number;
  piscar: boolean;
};

export function alertState(orders: AlertOrder[], unseen: ReadonlySet<string>): AlertState {
  const porAprovar = orders.filter(needsApproval).length;
  const naoVistos = orders.filter((o) => unseen.has(o.id)).length;
  const aAtender = orders.filter((o) => needsApproval(o) || unseen.has(o.id)).length;
  return { porAprovar, naoVistos, aAtender, piscar: aAtender > 0 };
}
