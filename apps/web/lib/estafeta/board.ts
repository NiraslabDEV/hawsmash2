/**
 * O quadro dos estafetas (`get_couriers_board`, 1115) lido pelo POS e pelo
 * painel. Só leitura e ordenação — atribuir e pagar são RPCs, a BD decide.
 */

export type BoardJob = {
  delivery_id: string;
  order_id: string;
  order_number: string;
  daily_number: number | null;
  status: 'assigned' | 'picked_up';
  address: string | null;
  assigned_at: string;
  picked_up_at: string | null;
};

export type BoardCourier = {
  id: string;
  full_name: string;
  phone: string;
  active: boolean;
  on_shift: boolean;
  last_seen_at: string | null;
  has_pin: boolean;
  position: { lat: number; lng: number; accuracy_m: number | null; recorded_at: string } | null;
  jobs: BoardJob[];
  delivered_today: number;
  /** Null para o balcão: o saldo é do gerente e do dono. */
  balance_cents: number | null;
};

export type CouriersBoard = {
  store_id: string;
  pay_rule: { fixed_cents: number | null; pct: number };
  couriers: BoardCourier[];
};

/** Estados em que um pedido de entrega pode ganhar estafeta (igual a `assign_courier`). */
export const ASSIGNABLE_STATUSES = ['approved', 'paid', 'in_preparation', 'ready'] as const;

export function canAssignCourier(order: { fulfillment_type: string; status: string }): boolean {
  return order.fulfillment_type === 'delivery' && (ASSIGNABLE_STATUSES as readonly string[]).includes(order.status);
}

/** Quem leva este pedido agora (entrega aberta), ou null. */
export function courierForOrder(
  board: CouriersBoard | null | undefined,
  orderId: string,
): { courier: BoardCourier; job: BoardJob } | null {
  for (const courier of board?.couriers ?? []) {
    const job = courier.jobs.find((j) => j.order_id === orderId);
    if (job) return { courier, job };
  }
  return null;
}

/**
 * A ordem dos botões ao atribuir: primeiro quem está de serviço, e entre esses
 * quem leva menos entregas — o toque mais provável fica à mão. Desactivados
 * não entram.
 */
export function assignableCouriers(board: CouriersBoard | null | undefined): BoardCourier[] {
  return (board?.couriers ?? [])
    .filter((c) => c.active)
    .slice()
    .sort((a, b) => {
      if (a.on_shift !== b.on_shift) return a.on_shift ? -1 : 1;
      if (a.jobs.length !== b.jobs.length) return a.jobs.length - b.jobs.length;
      return a.full_name.localeCompare(b.full_name, 'pt');
    });
}

/** Pedidos de entrega que ainda não têm estafeta. */
export function ordersAwaitingCourier<T extends { id: string; fulfillment_type: string; status: string }>(
  orders: T[],
  board: CouriersBoard | null | undefined,
): T[] {
  return orders.filter((o) => canAssignCourier(o) && !courierForOrder(board, o.id));
}

export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}
