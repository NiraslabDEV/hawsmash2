import { describe, expect, it, vi } from 'vitest';
import { buildDisplayFrame, frameKey, sendDisplayFrame } from '../customer-display';

describe('visor do cliente — o que o POS manda dizer', () => {
  it('sem venda em curso pede o ocioso (o nome da casa a andar)', () => {
    expect(buildDisplayFrame({ step: 'idle' })).toEqual({ mode: 'idle' });
  });

  it('mostra o artigo acabado de tocar com a quantidade e o que já soma', () => {
    expect(
      buildDisplayFrame({ step: 'item', name: 'Classic', qty: 2, lineTotalCents: 60_000 }),
    ).toEqual({
      mode: 'text',
      top: { left: 'Classic' },
      bottom: { left: '2 x', right: '600 MT' },
    });
  });

  it('põe o número do M-Pesa à frente do cliente quando se escolhe a forma', () => {
    expect(
      buildDisplayFrame({
        step: 'payment',
        method: 'mpesa',
        totalCents: 45_000,
        number: '847 955 382',
      }),
    ).toEqual({
      mode: 'text',
      top: { left: 'M-PESA', right: '847 955 382' },
      bottom: { left: 'A PAGAR', right: '450 MT' },
    });
  });

  it('em dinheiro o cliente vê o recebido e o troco', () => {
    expect(
      buildDisplayFrame({ step: 'change', receivedCents: 50_000, changeCents: 5_000 }),
    ).toEqual({
      mode: 'text',
      top: { left: 'RECEBIDO', right: '500 MT' },
      bottom: { left: 'TROCO', right: '50 MT' },
    });
  });

  it('fecha com a senha, que é o número que a cozinha vai chamar', () => {
    expect(buildDisplayFrame({ step: 'thanks', dailyNumber: 42 })).toEqual({
      mode: 'text',
      top: { left: 'OBRIGADO!' },
      bottom: { left: 'SENHA', right: '42' },
    });
  });

  it('a chave da trama distingue estados diferentes e iguala os repetidos', () => {
    const a = buildDisplayFrame({ step: 'cart', itemCount: 2, totalCents: 45_000 });
    const b = buildDisplayFrame({ step: 'cart', itemCount: 2, totalCents: 45_000 });
    const c = buildDisplayFrame({ step: 'cart', itemCount: 3, totalCents: 45_000 });

    expect(frameKey(a)).toBe(frameKey(b));
    expect(frameKey(a)).not.toBe(frameKey(c));
  });

  // Regra 1 do CLAUDE: nada disto pode travar uma venda.
  it('um bridge em baixo devolve false em vez de lançar', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });

    await expect(
      sendDisplayFrame(
        { baseUrl: 'http://127.0.0.1:7777', token: 'x'.repeat(32) },
        { mode: 'idle' },
        fetcher as unknown as typeof fetch,
      ),
    ).resolves.toBe(false);
  });
});
