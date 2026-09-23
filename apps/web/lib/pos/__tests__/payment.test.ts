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
      cashReceivedCents: null,
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

  it('no misto, o dinheiro escrito é o entregue: dar a mais é troco, não bloqueio', () => {
    // Total 500: M-Pesa 300, cliente entrega 500 em notas → parcela 200, troco 300.
    const plan = buildPaymentPlan({
      totalCents: 50000,
      methods: ['cash', 'mpesa'],
      mixed: true,
      allocations: { cash: 50000, mpesa: 30000 },
    });
    expect(plan).toEqual({
      complete: true,
      remainingCents: -30000,
      payments: [
        { method: 'cash', amountCents: 20000 },
        { method: 'mpesa', amountCents: 30000 },
      ],
      cashReceivedCents: 50000,
    });
    // O servidor exige a soma das parcelas igual ao total (P0007).
    expect(plan.payments.reduce((sum, p) => sum + p.amountCents, 0)).toBe(50000);
    expect(calculateChange(plan.payments[0].amountCents, plan.cashReceivedCents!)).toBe(30000);
  });

  it('no misto, dinheiro a menos continua a faltar', () => {
    expect(
      buildPaymentPlan({
        totalCents: 50000,
        methods: ['cash', 'mpesa'],
        mixed: true,
        allocations: { cash: 10000, mpesa: 30000 },
      }),
    ).toMatchObject({ complete: false, remainingCents: 10000 });
  });

  it('meios digitais não dão troco: M-Pesa acima do total não fecha', () => {
    expect(
      buildPaymentPlan({
        totalCents: 50000,
        methods: ['cash', 'mpesa'],
        mixed: true,
        allocations: { cash: 10000, mpesa: 60000 },
      }),
    ).toMatchObject({ complete: false });
    expect(
      buildPaymentPlan({
        totalCents: 50000,
        methods: ['mpesa', 'credit_card'],
        mixed: true,
        allocations: { mpesa: 30000, credit_card: 30000 },
      }),
    ).toMatchObject({ complete: false, remainingCents: -10000 });
  });

  it('no misto, cada meio escolhido tem de pagar alguma coisa', () => {
    expect(
      buildPaymentPlan({
        totalCents: 50000,
        methods: ['cash', 'mpesa'],
        mixed: true,
        allocations: { cash: 50000 },
      }),
    ).toMatchObject({ complete: false });
  });

  it('calcula troco em centavos inteiros e rejeita valor insuficiente', () => {
    expect(calculateChange(30000, 50000)).toBe(20000);
    expect(() => calculateChange(30000, 29999)).toThrow('insufficient_cash_received');
  });
});
