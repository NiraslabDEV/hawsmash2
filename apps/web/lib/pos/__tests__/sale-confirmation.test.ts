import { describe, expect, it } from 'vitest';
import { buildSaleClosing } from '../sale-confirmation';

describe('fecho da venda no ecrã VENDA REGISTADA', () => {
  it('venda em dinheiro só fecha com OK, e mostra recebido e troco', () => {
    const r = buildSaleClosing({
      payments: [{ method: 'cash', amountCents: 40_000 }],
      cashReceivedCents: 50_000,
      clientChangeCents: 10_000,
      serverChangeCents: 10_000,
    });
    expect(r).toMatchObject({
      requiresAck: true,
      cashDueCents: 40_000,
      receivedCents: 50_000,
      changeCents: 10_000,
      changeMismatch: false,
    });
  });

  it('dinheiro certo, sem troco, continua a pedir OK', () => {
    const r = buildSaleClosing({
      payments: [{ method: 'cash', amountCents: 30_000 }],
      cashReceivedCents: 30_000,
      clientChangeCents: 0,
      serverChangeCents: 0,
    });
    expect(r.requiresAck).toBe(true);
    expect(r.changeCents).toBe(0);
  });

  it('o troco que conta é o do servidor, e avisa se não bate com o do POS', () => {
    const r = buildSaleClosing({
      payments: [{ method: 'cash', amountCents: 40_000 }],
      cashReceivedCents: 50_000,
      clientChangeCents: 10_000,
      serverChangeCents: 5_000,
    });
    expect(r.changeCents).toBe(5_000);
    expect(r.changeMismatch).toBe(true);
  });

  it('offline usa o troco do POS — ainda não há servidor', () => {
    const r = buildSaleClosing({
      payments: [{ method: 'cash', amountCents: 40_000 }],
      cashReceivedCents: 50_000,
      clientChangeCents: 10_000,
    });
    expect(r.changeCents).toBe(10_000);
    expect(r.changeMismatch).toBe(false);
  });

  it('ignora um troco do servidor que não seja centavos válidos', () => {
    const r = buildSaleClosing({
      payments: [{ method: 'cash', amountCents: 40_000 }],
      cashReceivedCents: 50_000,
      clientChangeCents: 10_000,
      serverChangeCents: '10000',
    });
    expect(r.changeCents).toBe(10_000);
  });

  it('venda só em M-Pesa ou cartão não prende o ecrã', () => {
    const r = buildSaleClosing({
      payments: [{ method: 'mpesa', amountCents: 40_000 }],
      cashReceivedCents: null,
      clientChangeCents: null,
      serverChangeCents: null,
    });
    expect(r.requiresAck).toBe(false);
    expect(r.otherPayments).toEqual([{ method: 'mpesa', amountCents: 40_000 }]);
  });

  it('no misto mostra a parte em dinheiro e o resto à parte', () => {
    const r = buildSaleClosing({
      payments: [
        { method: 'mpesa', amountCents: 20_000 },
        { method: 'cash', amountCents: 20_000 },
      ],
      cashReceivedCents: 25_000,
      clientChangeCents: 5_000,
      serverChangeCents: 5_000,
    });
    expect(r.requiresAck).toBe(true);
    expect(r.cashDueCents).toBe(20_000);
    expect(r.otherPayments).toEqual([{ method: 'mpesa', amountCents: 20_000 }]);
  });
});
