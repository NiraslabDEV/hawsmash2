import { describe, it, expect } from 'vitest';
import { createOrderInputSchema } from '../schemas';

const base = {
  customerName: 'Ana',
  fulfillmentType: 'pickup' as const,
  paymentMethod: 'mpesa' as const,
};

const uuid = '11111111-1111-4111-8111-111111111111';

const baseOrder = {
  ...base,
  items: [{ menuItemId: uuid, qty: 1 }],
};

describe('createOrderInputSchema — F5.1 referralCode', () => {
  it('aceita pedido sem referralCode', () => {
    const r = createOrderInputSchema.safeParse(baseOrder);
    expect(r.success).toBe(true);
  });

  it('aceita referralCode válido', () => {
    const r = createOrderInputSchema.safeParse({ ...baseOrder, referralCode: 'AMIGO2026' });
    expect(r.success).toBe(true);
  });

  it('aceita referralCode vazio (campo opcional)', () => {
    const r = createOrderInputSchema.safeParse({ ...baseOrder, referralCode: '' });
    expect(r.success).toBe(true);
  });

  it('rejeita referralCode com mais de 50 caracteres', () => {
    const r = createOrderInputSchema.safeParse({
      ...baseOrder,
      referralCode: 'A'.repeat(51),
    });
    expect(r.success).toBe(false);
  });
});

describe('createOrderInputSchema — F8 variante/adicionais', () => {
  it('aceita item simples (sem variantId/addonIds)', () => {
    const r = createOrderInputSchema.safeParse({
      ...base,
      items: [{ menuItemId: uuid, qty: 1 }],
    });
    expect(r.success).toBe(true);
  });

  it('aceita variantId e addonIds válidos', () => {
    const r = createOrderInputSchema.safeParse({
      ...base,
      items: [{ menuItemId: uuid, qty: 2, variantId: uuid, addonIds: [uuid] }],
    });
    expect(r.success).toBe(true);
  });

  it('rejeita variantId que não é uuid', () => {
    const r = createOrderInputSchema.safeParse({
      ...base,
      items: [{ menuItemId: uuid, qty: 1, variantId: 'nope' }],
    });
    expect(r.success).toBe(false);
  });

  it('rejeita addonIds com elemento não-uuid', () => {
    const r = createOrderInputSchema.safeParse({
      ...base,
      items: [{ menuItemId: uuid, qty: 1, addonIds: [uuid, 'bad'] }],
    });
    expect(r.success).toBe(false);
  });
});
