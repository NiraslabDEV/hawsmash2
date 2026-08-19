import { describe, expect, it } from 'vitest';

import {
  ImportDataError,
  aggregateCustomers,
  buildReport,
  mapOrder,
  mapOrderItem,
  mapOrderStatus,
  mapProduct,
  mtToCents,
  normalizePhone,
  productBasePriceCents,
  type LegacyOrder,
  type LegacyProduct,
} from '../lib/import-mapping';

const STORE = '00000000-0000-4000-8000-000000000101';

const product: LegacyProduct = {
  id: 'prod-1',
  name: 'Classic Smash',
  category_id: 'cat-1',
  description: 'Smash artesanal',
  price_single: null,
  price_haw: 300,
  price_wagyu: 400,
  image_url: null,
  available: true,
  sort: 1,
};

const order: LegacyOrder = {
  id: 'ord-1',
  order_number: 42,
  customer_name: 'Ridwan',
  customer_phone: '+258 84 123 4567',
  customer_email: null,
  fulfillment: 'delivery',
  delivery_address: 'Av. Julius Nyerere',
  delivery_zone: 'Centro',
  payment_method: 'mpesa',
  subtotal_mt: 300,
  delivery_fee_mt: 150,
  total_mt: 450,
  customer_notes: 'Sem cebola',
  status: 'paid',
  created_at: '2026-07-01T18:30:00Z',
};

describe('importação do HAWSMASH 1.0', () => {
  it('converte meticais em centavos sem float solto', () => {
    expect(mtToCents(300)).toBe(30000);
    expect(mtToCents(0)).toBe(0);
    expect(mtToCents(null)).toBe(0);
    expect(() => mtToCents(-5)).toThrow(ImportDataError);
  });

  it('usa o preço base mais baixo do produto e recusa produto sem preço', () => {
    expect(productBasePriceCents(product)).toBe(30000);
    expect(() =>
      productBasePriceCents({ ...product, price_haw: null, price_wagyu: null }),
    ).toThrow(ImportDataError);
  });

  it('mapeia o produto para a categoria já importada', () => {
    const mapped = mapProduct(product, new Map([['cat-1', 'new-cat']]));
    expect(mapped).toMatchObject({
      category_id: 'new-cat',
      name: 'Classic Smash',
      price_cents: 30000,
      available: true,
    });
    expect(() => mapProduct(product, new Map())).toThrow(ImportDataError);
  });

  it('traduz os estados sem inventar nenhum', () => {
    expect(mapOrderStatus('pending')).toBe('awaiting_approval');
    expect(mapOrderStatus('paid')).toBe('delivered');
    expect(mapOrderStatus('cancelled')).toBe('cancelled');
    expect(() => mapOrderStatus('em_transito')).toThrow(ImportDataError);
  });

  it('preserva número e data do pedido e recalcula em centavos', () => {
    const mapped = mapOrder(order, STORE);
    expect(mapped).toMatchObject({
      store_id: STORE,
      order_number: '42',
      status: 'delivered',
      fulfillment_type: 'delivery',
      subtotal_cents: 30000,
      delivery_fee_cents: 15000,
      total_cents: 45000,
      created_at: '2026-07-01T18:30:00Z',
    });
  });

  it('recusa importar um pedido cujo total não bate certo', () => {
    expect(() => mapOrder({ ...order, total_mt: 500 }, STORE)).toThrow(/Total inconsistente/);
  });

  it('mantém a variante no nome do item, como o talão do 1.0 mostrava', () => {
    const mapped = mapOrderItem(
      {
        order_id: 'ord-1',
        product_name: 'Classic Smash (HAW)',
        variant: 'HAW',
        unit_price_mt: 300,
        qty: 2,
        line_total_mt: 600,
      },
      'new-order',
      STORE,
    );
    expect(mapped).toMatchObject({
      name_snapshot: 'Classic Smash (HAW)',
      qty: 2,
      unit_price_cents: 30000,
      store_id: STORE,
    });
  });

  it('normaliza telefones e agrega clientes pelo número', () => {
    expect(normalizePhone('+258 84 123 4567')).toBe('841234567');
    expect(normalizePhone('84 123 4567')).toBe('841234567');
    expect(normalizePhone('123')).toBeNull();

    const customers = aggregateCustomers([
      order,
      { ...order, id: 'ord-2', created_at: '2026-07-05T12:00:00Z', total_mt: 300, subtotal_mt: 150, delivery_fee_mt: 150 },
      { ...order, id: 'ord-3', status: 'cancelled' },
      { ...order, id: 'ord-4', customer_phone: null },
    ]);

    expect(customers).toHaveLength(1);
    expect(customers[0]).toMatchObject({
      phone: '841234567',
      orders_count: 2,
      total_spent_cents: 75000,
      last_order_at: '2026-07-05T12:00:00Z',
    });
  });

  it('produz o relatório de contagens que se confere com o 1.0', () => {
    const report = buildReport({
      categories: [{ id: 'cat-1', name: 'Burgers', sort: 1, active: true }],
      products: [product],
      orders: [order, { ...order, id: 'ord-2', status: 'cancelled' }],
      items: [
        {
          order_id: 'ord-1',
          product_name: 'Classic Smash',
          variant: null,
          unit_price_mt: 300,
          qty: 1,
          line_total_mt: 300,
        },
      ],
    });

    expect(report).toMatchObject({
      categories: 1,
      products: 1,
      orders: 2,
      order_items: 1,
      customers: 1,
      revenue_cents: 45000,
    });
  });
});
