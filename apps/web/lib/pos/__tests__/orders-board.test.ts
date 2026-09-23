import { describe, expect, it } from 'vitest';
import {
  BOARD_LIMIT,
  BOARD_ORDER,
  buildBoard,
  columnOf,
  fulfillmentLabel,
  isLate,
  isScheduled,
  needsProofCheck,
  nextStep,
  paymentLabel,
  type BoardOrder,
} from '../orders-board';

function order(over: Partial<BoardOrder> = {}): BoardOrder {
  return {
    id: crypto.randomUUID(),
    daily_number: 1,
    order_number: 'MTL-0001',
    status: 'paid',
    channel: 'counter',
    fulfillment_type: 'pickup',
    customer_name: 'Cliente',
    customer_phone: null,
    total_cents: 30_000,
    scheduled_for: null,
    created_at: '2026-08-24T12:00:00.000Z',
    payment_method: 'cash',
    payment_proof_path: null,
    flow: 'manual',
    ...over,
  };
}

describe('quadro de pedidos · o que chega ao ecrã', () => {
  it('lê os mais recentes primeiro, para o tecto cortar os velhos e não os novos', () => {
    // Por ordem crescente, uma loja com 355 pedidos activos mostrava os 120
    // mais antigos e escondia o que acabara de entrar da internet.
    expect(BOARD_ORDER).toEqual({ column: 'created_at', ascending: false });
    expect(BOARD_LIMIT).toBeGreaterThan(0);
  });

  it('mesmo lidos ao contrário, o quadro mostra-os por ordem de entrada', () => {
    const cedo = order({ id: 'cedo', created_at: '2026-09-23T10:00:00.000Z' });
    const tarde = order({ id: 'tarde', created_at: '2026-09-23T12:00:00.000Z' });

    const [aFazer] = buildBoard([tarde, cedo]);
    expect(aFazer.orders.map((o) => o.id)).toEqual(['cedo', 'tarde']);
  });
});

describe('quadro de pedidos · conferir o pagamento', () => {
  it('pede para conferir o comprovativo num pedido manual por aprovar', () => {
    expect(needsProofCheck(order({ status: 'awaiting_approval', flow: 'manual' }))).toBe(true);
  });

  it('não pede comprovativo a um pedido que o gateway já confirmou', () => {
    expect(needsProofCheck(order({ status: 'awaiting_approval', flow: 'digital' }))).toBe(false);
  });

  it('não pede comprovativo depois de aprovado', () => {
    expect(needsProofCheck(order({ status: 'approved', flow: 'manual' }))).toBe(false);
  });

  it('diz a forma de pagamento como o caixa a lê', () => {
    expect(paymentLabel(order({ payment_method: 'mpesa' }))).toBe('M-PESA');
    expect(paymentLabel(order({ payment_method: 'emola' }))).toBe('E-MOLA');
    expect(paymentLabel(order({ payment_method: null }))).toBe('—');
  });
});

describe('quadro de pedidos do balcão', () => {
  it('põe cada estado na coluna certa', () => {
    expect(columnOf('paid')).toBe('incoming');
    expect(columnOf('awaiting_approval')).toBe('incoming');
    expect(columnOf('in_preparation')).toBe('preparing');
    expect(columnOf('ready')).toBe('ready');
  });

  it('tira do quadro o que já terminou', () => {
    expect(columnOf('delivered')).toBeNull();
    expect(columnOf('cancelled')).toBeNull();

    const board = buildBoard([order({ status: 'delivered' }), order({ status: 'cancelled' })]);
    expect(board.flatMap((coluna) => coluna.orders)).toHaveLength(0);
  });

  // Um toque = um passo. A seta diz para onde vai.
  it('cada estado tem um passo seguinte e um só', () => {
    expect(nextStep('awaiting_approval')).toEqual({ event: 'APPROVE', label: 'Aprovar' });
    expect(nextStep('paid')).toEqual({ event: 'START_PREPARATION', label: 'Preparar' });
    expect(nextStep('in_preparation')).toEqual({ event: 'MARK_READY', label: 'Pronto' });
    expect(nextStep('ready')).toEqual({ event: 'DELIVER', label: 'Entregue' });
  });

  // Deixar o caixa avancar um pedido por pagar seria mandar comida para a rua
  // sem ter recebido.
  it('um pedido por pagar não tem seta', () => {
    expect(nextStep('awaiting_payment')).toBeNull();
    expect(nextStep('delivered')).toBeNull();
    expect(nextStep('cancelled')).toBeNull();
  });

  it('as três colunas têm cores diferentes, para se lerem de longe', () => {
    const tons = buildBoard([]).map((coluna) => coluna.tone);
    expect(tons).toEqual(['amber', 'blue', 'green']);
    expect(new Set(tons).size).toBe(3);
  });

  // Um agendado para as 20h não pode andar à frente de um que é para agora só
  // porque foi registado primeiro.
  it('ordena pela hora marcada e não pela de entrada', () => {
    const board = buildBoard([
      order({ order_number: 'A', created_at: '2026-08-24T12:00:00.000Z', scheduled_for: '2026-08-24T20:00:00.000Z' }),
      order({ order_number: 'B', created_at: '2026-08-24T12:30:00.000Z', scheduled_for: null }),
    ]);
    expect(board[0].orders.map((o) => o.order_number)).toEqual(['B', 'A']);
  });

  it('distingue o agendado do que é para agora', () => {
    const agora = Date.parse('2026-08-24T12:00:00.000Z');
    expect(isScheduled(order({ scheduled_for: '2026-08-24T20:00:00.000Z' }), agora)).toBe(true);
    expect(isScheduled(order({ scheduled_for: null }), agora)).toBe(false);
    expect(isScheduled(order({ scheduled_for: '2026-08-24T12:00:30.000Z' }), agora)).toBe(false);
  });

  // O unico alarme do quadro: a hora passou e ninguem preparou.
  it('marca como atrasado o agendamento cuja hora passou e ainda não está pronto', () => {
    const agora = Date.parse('2026-08-24T20:30:00.000Z');
    const marcado = '2026-08-24T20:00:00.000Z';
    expect(isLate(order({ scheduled_for: marcado, status: 'paid' }), agora)).toBe(true);
    expect(isLate(order({ scheduled_for: marcado, status: 'ready' }), agora)).toBe(false);
    expect(isLate(order({ scheduled_for: null, status: 'paid' }), agora)).toBe(false);
  });

  it('diz o que é cada pedido em duas palavras', () => {
    expect(fulfillmentLabel(order({ channel: 'counter', fulfillment_type: 'pickup' }))).toBe('BALCÃO');
    expect(fulfillmentLabel(order({ channel: 'counter', fulfillment_type: 'delivery' }))).toBe('ENTREGA');
    expect(fulfillmentLabel(order({ channel: 'delivery', fulfillment_type: 'delivery' }))).toBe('ENTREGA');
    expect(fulfillmentLabel(order({ channel: 'pickup', fulfillment_type: 'pickup' }))).toBe('LEVANTAMENTO');
  });
});
