import { describe, expect, it } from 'vitest';
import { alertState, arrivals, needsApproval } from '../new-orders';

const online = (id: string, status = 'awaiting_approval') => ({ id, status, channel: 'pickup' });
const balcao = (id: string) => ({ id, status: 'paid', channel: 'counter' });

describe('alarme de pedido novo no balcão', () => {
  it('um pedido online que o terminal não conhecia é uma chegada', () => {
    const r = arrivals([online('a'), online('b')], new Set(['a']));
    expect(r.map((o) => o.id)).toEqual(['b']);
  });

  it('uma venda de balcão nunca toca — foi o próprio caixa que a fez', () => {
    expect(arrivals([balcao('c')], new Set())).toEqual([]);
  });

  it('um pedido ainda por pagar não é chegada — só depois do pagamento', () => {
    expect(arrivals([online('d', 'awaiting_payment')], new Set())).toEqual([]);
  });

  it('um pedido digital já pago também é chegada: a cozinha já o tem', () => {
    expect(arrivals([online('e', 'paid')], new Set()).map((o) => o.id)).toEqual(['e']);
  });

  it('pisca enquanto houver pedido manual por aprovar, mesmo já visto', () => {
    const s = alertState([online('f')], new Set());
    expect(s).toEqual({ porAprovar: 1, naoVistos: 0, aAtender: 1, piscar: true });
  });

  it('pisca por um pedido novo até alguém abrir o quadro', () => {
    const s = alertState([online('g', 'paid')], new Set(['g']));
    expect(s).toEqual({ porAprovar: 0, naoVistos: 1, aAtender: 1, piscar: true });
  });

  it('um pedido novo e por aprovar conta uma vez no crachá', () => {
    expect(alertState([online('k')], new Set(['k'])).aAtender).toBe(1);
  });

  it('sem nada à espera e tudo visto, não pisca', () => {
    expect(alertState([online('h', 'approved')], new Set()).piscar).toBe(false);
  });

  it('só é "por aprovar" o pedido online manual à espera', () => {
    expect(needsApproval(online('i'))).toBe(true);
    expect(needsApproval(online('j', 'approved'))).toBe(false);
  });
});
