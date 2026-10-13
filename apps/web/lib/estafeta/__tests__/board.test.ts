import { describe, expect, it } from 'vitest';

import {
  assignableCouriers,
  canAssignCourier,
  courierForOrder,
  firstName,
  ordersAwaitingCourier,
  type BoardCourier,
  type CouriersBoard,
} from '../board';

const estafeta = (over: Partial<BoardCourier>): BoardCourier => ({
  id: 'c',
  full_name: 'X',
  phone: '840000000',
  active: true,
  on_shift: false,
  last_seen_at: null,
  has_pin: true,
  position: null,
  jobs: [],
  delivered_today: 0,
  balance_cents: null,
  ...over,
});

const job = (orderId: string) => ({
  delivery_id: `d-${orderId}`,
  order_id: orderId,
  order_number: 'MPT-1',
  daily_number: 1,
  status: 'assigned' as const,
  address: null,
  assigned_at: '2026-10-13T10:00:00Z',
  picked_up_at: null,
});

const board: CouriersBoard = {
  store_id: 's',
  pay_rule: { fixed_cents: null, pct: 100 },
  couriers: [
    estafeta({ id: 'a', full_name: 'Zeca Fora', on_shift: false }),
    estafeta({ id: 'b', full_name: 'Bruno Ocupado', on_shift: true, jobs: [job('o1'), job('o2')] }),
    estafeta({ id: 'c', full_name: 'Carla Livre', on_shift: true }),
    estafeta({ id: 'd', full_name: 'Desactivado', active: false, on_shift: true }),
  ],
};

describe('estafetas no POS', () => {
  it('só pedidos de entrega, aprovados e por sair, ganham estafeta', () => {
    expect(canAssignCourier({ fulfillment_type: 'delivery', status: 'ready' })).toBe(true);
    expect(canAssignCourier({ fulfillment_type: 'delivery', status: 'awaiting_approval' })).toBe(false);
    expect(canAssignCourier({ fulfillment_type: 'pickup', status: 'ready' })).toBe(false);
  });

  it('sabe quem leva cada pedido', () => {
    expect(courierForOrder(board, 'o2')?.courier.id).toBe('b');
    expect(courierForOrder(board, 'o9')).toBeNull();
    expect(courierForOrder(null, 'o1')).toBeNull();
  });

  it('o botão mais provável primeiro: de serviço e livre; desactivado nunca', () => {
    expect(assignableCouriers(board).map((c) => c.id)).toEqual(['c', 'b', 'a']);
  });

  it('lista o que está à espera de estafeta', () => {
    const pedidos = [
      { id: 'o1', fulfillment_type: 'delivery', status: 'ready' },
      { id: 'o3', fulfillment_type: 'delivery', status: 'in_preparation' },
      { id: 'o4', fulfillment_type: 'pickup', status: 'ready' },
    ];
    expect(ordersAwaitingCourier(pedidos, board).map((o) => o.id)).toEqual(['o3']);
  });

  it('primeiro nome', () => {
    expect(firstName('  Abel  Mondlane ')).toBe('Abel');
  });
});
