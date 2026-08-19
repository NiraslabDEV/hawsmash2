import { describe, it, expect } from 'vitest';
import { orderToReference, referenceToOrderId } from '../reference';

const UUID = '3f1a2b4c-5d6e-7081-92a3-b4c5d6e7f809';

describe('orderToReference', () => {
  it('produz uma referência só alfanumérica (exigência do Paysuite)', () => {
    const ref = orderToReference(UUID);
    expect(ref).toMatch(/^[a-zA-Z0-9]+$/);
    expect(ref).toBe('ord3f1a2b4c5d6e708192a3b4c5d6e7f809');
  });
});

describe('round-trip', () => {
  it('referenceToOrderId reverte orderToReference', () => {
    expect(referenceToOrderId(orderToReference(UUID))).toBe(UUID);
  });

  it('aceita o formato legado order_<uuid>', () => {
    expect(referenceToOrderId(`order_${UUID}`)).toBe(UUID);
  });

  it('devolve a string original se o formato for inesperado', () => {
    expect(referenceToOrderId('qualquercoisa')).toBe('qualquercoisa');
  });
});
