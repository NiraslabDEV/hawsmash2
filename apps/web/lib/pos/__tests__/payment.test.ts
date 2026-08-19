import { describe, expect, it } from 'vitest';
import { buildPaymentPlan, calculateChange } from '../payment';

describe('pagamento do POS', () => {
  it('atribui o total inteiro a uma forma de pagamento simples', () => {
    expect(
      buildPaymentPlan({
        totalCents: 45000,
        methods: ['mpesa'],
        mixed: false,
        allocations: {},
      }),
    ).toEqual({
      complete: true,
      remainingCents: 0,
      payments: [{ method: 'mpesa', amountCents: 45000 }],
    });
  });

  it('só aceita pagamento misto quando as parcelas fecham o total', () => {
    expect(
      buildPaymentPlan({
        totalCents: 60000,
        methods: ['cash', 'emola'],
        mixed: true,
        allocations: { cash: 25000, emola: 35000 },
      }),
    ).toMatchObject({ complete: true, remainingCents: 0 });

    expect(
      buildPaymentPlan({
        totalCents: 60000,
        methods: ['cash', 'emola'],
        mixed: true,
        allocations: { cash: 25000, emola: 30000 },
      }),
    ).toMatchObject({ complete: false, remainingCents: 5000 });
  });

  it('calcula troco em centavos inteiros e rejeita valor insuficiente', () => {
    expect(calculateChange(30000, 50000)).toBe(20000);
    expect(() => calculateChange(30000, 29999)).toThrow('insufficient_cash_received');
  });
});
