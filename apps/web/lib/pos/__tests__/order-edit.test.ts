import { describe, expect, it } from 'vitest';
import type { BoardOrder, OrderStatus } from '../orders-board';
import {
  canEditAddress,
  canEditSchedule,
  orderEditErrorMessage,
  zoneChoices,
} from '../order-edit';

function order(over: Partial<BoardOrder> = {}): BoardOrder {
  return {
    id: crypto.randomUUID(),
    daily_number: 7,
    order_number: 'MPT-0007',
    status: 'approved',
    channel: 'delivery',
    fulfillment_type: 'delivery',
    customer_name: 'Cliente',
    customer_phone: '841234567',
    total_cents: 45_000,
    scheduled_for: null,
    created_at: '2026-09-24T12:00:00.000Z',
    payment_method: 'mpesa',
    payment_proof_path: null,
    flow: 'manual',
    address: 'Av. Julius Nyerere 100',
    delivery_zone_id: 'zona-a',
    delivery_fee_cents: 15_000,
    ...over,
  };
}

describe('alterar pedido · o que se pode mudar', () => {
  it('a morada muda até o pedido sair — pronto incluído, é quando o entregador está à porta', () => {
    for (const status of ['awaiting_approval', 'awaiting_payment', 'approved', 'paid', 'in_preparation', 'ready'] as OrderStatus[]) {
      expect(canEditAddress(order({ status })), status).toBe(true);
    }
    expect(canEditAddress(order({ status: 'delivered' }))).toBe(false);
    expect(canEditAddress(order({ status: 'cancelled' }))).toBe(false);
  });

  it('num levantamento ou ao balcão não há morada para mudar', () => {
    expect(canEditAddress(order({ fulfillment_type: 'pickup' }))).toBe(false);
    expect(canEditAddress(order({ channel: 'counter', fulfillment_type: 'pickup' }))).toBe(false);
  });

  it('a hora muda até o pedido estar pronto — depois a comida já está feita', () => {
    expect(canEditSchedule(order({ status: 'in_preparation' }))).toBe(true);
    expect(canEditSchedule(order({ status: 'ready' }))).toBe(false);
    expect(canEditSchedule(order({ status: 'delivered' }))).toBe(false);
  });

  it('a hora também muda num levantamento', () => {
    expect(canEditSchedule(order({ fulfillment_type: 'pickup' }))).toBe(true);
  });

  it('uma entrega vendida ao balcão também se altera', () => {
    const balcao = order({ channel: 'counter', fulfillment_type: 'delivery', status: 'paid' });
    expect(canEditAddress(balcao)).toBe(true);
    expect(canEditSchedule(balcao)).toBe(true);
  });
});

describe('alterar pedido · zonas', () => {
  const zonas = [
    { id: 'zona-a', name: 'Centro', fee_cents: 15_000 },
    { id: 'zona-b', name: 'Polana', fee_cents: 15_000 },
    { id: 'zona-c', name: 'Costa do Sol', fee_cents: 25_000 },
  ];

  it('só deixa escolher zonas com a taxa que o pedido já tem — o dinheiro não se mexe aqui', () => {
    const escolhas = zoneChoices(zonas, order());
    expect(escolhas.map((z) => [z.zone.id, z.allowed])).toEqual([
      ['zona-a', true],
      ['zona-b', true],
      ['zona-c', false],
    ]);
  });

  it('a zona actual fica escolhível mesmo que a taxa dela tenha mudado entretanto', () => {
    const escolhas = zoneChoices(
      [{ id: 'zona-a', name: 'Centro', fee_cents: 20_000 }],
      order({ delivery_fee_cents: 15_000 }),
    );
    expect(escolhas[0].allowed).toBe(true);
  });
});

describe('alterar pedido · o que dizer ao caixa', () => {
  it('taxa diferente explica os valores e o caminho — anular e refazer com gerente', () => {
    const texto = orderEditErrorMessage('delivery_fee_would_change:15000:25000');
    expect(texto).toContain('150');
    expect(texto).toContain('250');
    expect(texto.toLowerCase()).toContain('anular');
  });

  it('traduz os erros do servidor que o caixa pode encontrar', () => {
    expect(orderEditErrorMessage('schedule_not_editable')).toMatch(/pronto/i);
    expect(orderEditErrorMessage('order_not_editable')).toMatch(/já não se pode alterar/i);
    expect(orderEditErrorMessage('scheduled_for_in_past')).toMatch(/já passou/i);
    expect(orderEditErrorMessage('address_required')).toMatch(/morada/i);
    expect(orderEditErrorMessage('order_edit_access_denied')).toMatch(/perfil/i);
  });

  it('o que não conhece mostra-se com o código — lido ao telefone resolve mais depressa', () => {
    expect(orderEditErrorMessage('qualquer_coisa_nova')).toContain('qualquer_coisa_nova');
    expect(orderEditErrorMessage(undefined)).toMatch(/não foi possível/i);
  });
});
