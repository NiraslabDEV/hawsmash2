import { describe, expect, it } from 'vitest';
import {
  billLines,
  itemLabel,
  minutesOpen,
  orderCustomerName,
  tableErrorMessage,
  tableName,
  tableTotalCents,
  type PosTable,
  type TableOrder,
} from '../tables';

function pedido(parcial: Partial<TableOrder>): TableOrder {
  return {
    id: 'o1',
    order_number: 'MPT-0042',
    daily_number: 12,
    status: 'in_preparation',
    origin: 'pos',
    customer_name: 'Mesa 2',
    created_at: '2026-09-24T18:00:00.000Z',
    total_cents: 0,
    notes: null,
    items: [],
    ...parcial,
  };
}

function mesa(orders: TableOrder[]): PosTable {
  return { id: 't2', number: 2, active: true, orders };
}

describe('mesas · o nome do artigo', () => {
  it('junta a variante e os extras, como o talão', () => {
    expect(
      itemLabel({
        name: 'Classic Smash',
        variant: 'WAGYU',
        qty: 1,
        unit_price_cents: 45000,
        notes: null,
        person: null,
        addons: [{ name: 'Queijo', price_cents: 5000 }],
      }),
    ).toBe('Classic Smash WAGYU + Queijo');
  });

  it('não repete a variante que o nome já traz', () => {
    expect(
      itemLabel({ name: 'Coca-Cola Zero', variant: 'Zero', qty: 1, unit_price_cents: 9000, notes: null, person: null, addons: [] }),
    ).toBe('Coca-Cola Zero');
  });
});

describe('mesas · a conta', () => {
  const classicHaw = { name: 'Classic Smash', variant: 'HAW', unit_price_cents: 30000, notes: null, person: null, addons: [] };

  it('o total é a soma dos pedidos por pagar, do QR e do balcão', () => {
    const conta = mesa([
      pedido({ id: 'a', total_cents: 60000 }),
      pedido({ id: 'b', origin: 'qr', total_cents: 30000 }),
    ]);
    expect(tableTotalCents(conta)).toBe(90000);
    expect(tableTotalCents(mesa([]))).toBe(0);
  });

  it('o resumo junta o mesmo artigo de vários pedidos e separa o que tem nota', () => {
    const conta = mesa([
      pedido({ id: 'a', items: [{ ...classicHaw, qty: 2 }] }),
      pedido({
        id: 'b',
        origin: 'qr',
        items: [
          { ...classicHaw, qty: 1 },
          { ...classicHaw, qty: 1, notes: 'Sem cebola' },
        ],
      }),
    ]);
    expect(billLines(conta)).toEqual([
      { key: 'Classic Smash HAW|', label: 'Classic Smash HAW', notes: null, qty: 3, totalCents: 90000 },
      {
        key: 'Classic Smash HAW|Sem cebola',
        label: 'Classic Smash HAW',
        notes: 'Sem cebola',
        qty: 1,
        totalCents: 30000,
      },
    ]);
  });

  it('diz há quanto tempo a mesa está aberta, a contar do primeiro pedido', () => {
    const conta = mesa([
      pedido({ id: 'b', created_at: '2026-09-24T18:20:00.000Z' }),
      pedido({ id: 'a', created_at: '2026-09-24T18:05:00.000Z' }),
    ]);
    expect(minutesOpen(conta, new Date('2026-09-24T18:35:30.000Z'))).toBe(30);
    expect(minutesOpen(mesa([]), new Date())).toBeNull();
  });
});

describe('mesas · o nome da conta (1092)', () => {
  it('tira a mesa da frente: "Mesa 5 · João" é o João', () => {
    expect(orderCustomerName('Mesa 5 · João')).toBe('João');
    expect(orderCustomerName('mesa 12 ·  Ana Maria ')).toBe('Ana Maria');
    expect(orderCustomerName('Mesa 5')).toBeNull();
    expect(orderCustomerName(null)).toBeNull();
    // Um nome escrito sem a mesa (QR antigo) fica como está.
    expect(orderCustomerName('Ana')).toBe('Ana');
  });

  it('o cartão mostra o último nome escrito na conta; sem nome, nada', () => {
    const conta = mesa([
      pedido({ id: 'a', customer_name: 'Mesa 2 · João', created_at: '2026-09-25T10:00:00.000Z' }),
      pedido({ id: 'b', customer_name: 'Mesa 2', created_at: '2026-09-25T10:30:00.000Z' }),
    ]);
    expect(tableName(conta)).toBe('João');
    expect(tableName(mesa([pedido({ customer_name: 'Mesa 2' })]))).toBeNull();
    expect(tableName(mesa([]))).toBeNull();
  });
});

describe('mesas · mensagens para o caixa', () => {
  it.each([
    ['table_bill_changed', 'Entrou um pedido novo'],
    ['table_has_no_open_orders', 'não tem nada por pagar'],
    ['invalid_table', 'mesa'],
    ['out_of_stock:e086dd3d', 'esgotou'],
    ['device_locked', 'bloqueado'],
    ['Failed to fetch', 'Sem ligação'],
  ])('%s', (codigo, esperado) => {
    expect(tableErrorMessage(codigo)).toContain(esperado);
  });

  it('um erro desconhecido não se esconde', () => {
    expect(tableErrorMessage('algo_novo')).toContain('algo_novo');
    expect(tableErrorMessage(undefined)).toBe('Não foi possível concluir. Tenta outra vez.');
  });
});
