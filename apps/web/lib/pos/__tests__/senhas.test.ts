import { describe, expect, it } from 'vitest';
import {
  TICKET_MAX_DIGITS,
  maputoDayStart,
  newlyReady,
  parseTicket,
  pressTicketKey,
  splitTickets,
  ticketErrorMessage,
  ticketLabel,
  type TicketOrder,
} from '../senhas';

function ticket(over: Partial<TicketOrder> = {}): TicketOrder {
  return {
    id: crypto.randomUUID(),
    daily_number: 1,
    order_number: 'MPT-0001',
    status: 'paid',
    channel: 'counter',
    fulfillment_type: 'pickup',
    customer_name: null,
    created_at: '2026-09-24T10:00:00Z',
    updated_at: '2026-09-24T10:00:00Z',
    ...over,
  };
}

describe('teclado da senha', () => {
  it('escreve os algarismos pela ordem em que se tocam', () => {
    expect(pressTicketKey('', '4')).toBe('4');
    expect(pressTicketKey('4', '2')).toBe('42');
  });

  it('um zero à esquerda não conta — a senha 07 é a 7', () => {
    expect(pressTicketKey('', '0')).toBe('');
    expect(pressTicketKey('7', '0')).toBe('70');
  });

  it('não passa do tamanho de uma senha', () => {
    const cheio = '9'.repeat(TICKET_MAX_DIGITS);
    expect(pressTicketKey(cheio, '1')).toBe(cheio);
  });

  it('C limpa e ⌫ apaga o último', () => {
    expect(pressTicketKey('42', 'C')).toBe('');
    expect(pressTicketKey('42', '⌫')).toBe('4');
    expect(pressTicketKey('', '⌫')).toBe('');
  });

  it('só aceita um número inteiro positivo', () => {
    expect(parseTicket('42')).toBe(42);
    expect(parseTicket('')).toBeNull();
    expect(parseTicket('0')).toBeNull();
    expect(parseTicket('4a')).toBeNull();
    expect(parseTicket('-3')).toBeNull();
  });
});

describe('o que diz a TV por baixo da senha', () => {
  it('balcão, levantamento e entrega', () => {
    expect(ticketLabel({ channel: 'counter', fulfillment_type: 'pickup' })).toBe('BALCÃO');
    expect(ticketLabel({ channel: 'counter', fulfillment_type: 'delivery' })).toBe('ENTREGA');
    expect(ticketLabel({ channel: 'pickup', fulfillment_type: 'pickup' })).toBe('LEVANTAMENTO');
    expect(ticketLabel({ channel: 'delivery', fulfillment_type: 'delivery' })).toBe('ENTREGA');
    expect(ticketLabel({ channel: 'dine_in', fulfillment_type: 'dine_in' })).toBe('MESA');
  });

  it('sem tipo conhecido, diz balcão — é para onde o cliente vai', () => {
    expect(ticketLabel({ channel: null, fulfillment_type: null })).toBe('BALCÃO');
  });
});

describe('as duas listas da aba Senhas', () => {
  it('separa o que está a ser feito do que já está na TV', () => {
    const { preparing, ready } = splitTickets([
      ticket({ daily_number: 1, status: 'paid' }),
      ticket({ daily_number: 2, status: 'approved' }),
      ticket({ daily_number: 3, status: 'in_preparation' }),
      ticket({ daily_number: 4, status: 'ready' }),
      ticket({ daily_number: 5, status: 'awaiting_approval' }),
      ticket({ daily_number: 6, status: 'delivered' }),
    ]);
    expect(preparing.map((t) => t.daily_number)).toEqual([1, 2, 3]);
    expect(ready.map((t) => t.daily_number)).toEqual([4]);
  });

  it('em preparo pela ordem de entrada; na TV o último chamado primeiro', () => {
    const { preparing, ready } = splitTickets([
      ticket({ daily_number: 9, status: 'paid', created_at: '2026-09-24T10:05:00Z' }),
      ticket({ daily_number: 8, status: 'paid', created_at: '2026-09-24T10:01:00Z' }),
      ticket({ daily_number: 3, status: 'ready', updated_at: '2026-09-24T10:02:00Z' }),
      ticket({ daily_number: 5, status: 'ready', updated_at: '2026-09-24T10:09:00Z' }),
    ]);
    expect(preparing.map((t) => t.daily_number)).toEqual([8, 9]);
    expect(ready.map((t) => t.daily_number)).toEqual([5, 3]);
  });

  it('um pedido sem senha não entra — não há número para chamar', () => {
    const { preparing } = splitTickets([ticket({ daily_number: null, status: 'paid' })]);
    expect(preparing).toEqual([]);
  });
});

describe('destaque da TV', () => {
  it('na primeira leitura não destaca nada — a TV acabou de ligar', () => {
    expect(newlyReady(null, [{ order_number: 'MPT-0001' }])).toEqual([]);
  });

  it('destaca só as senhas que ainda não estavam prontas', () => {
    const antes = new Set(['MPT-0001']);
    const agora = [{ order_number: 'MPT-0002' }, { order_number: 'MPT-0001' }];
    expect(newlyReady(antes, agora)).toEqual([{ order_number: 'MPT-0002' }]);
  });
});

describe('mensagens de erro da senha', () => {
  it('senha que não existe hoje', () => {
    expect(ticketErrorMessage('ticket_not_found', 42)).toMatch(/Não há senha 42 hoje/);
  });

  it('pedido da internet por aprovar ou por pagar não vai para a TV', () => {
    expect(ticketErrorMessage('ticket_not_paid', 42)).toMatch(/ainda não foi aprovado/);
  });

  it('já entregue ou anulado', () => {
    expect(ticketErrorMessage('ticket_already_delivered', 42)).toMatch(/já foi entregue/);
    expect(ticketErrorMessage('ticket_cancelled', 42)).toMatch(/anulado/);
  });

  it('terminal de outra loja', () => {
    expect(ticketErrorMessage('store_access_denied', 42)).toMatch(/não tem acesso/);
  });

  it('o resto mostra o código, para se ler ao telefone', () => {
    expect(ticketErrorMessage('boom', 42)).toContain('boom');
  });
});

describe('o dia da loja', () => {
  it('começa à meia-noite de Maputo, não à de UTC', () => {
    // 23h30 UTC de dia 23 já é dia 24 em Maputo (UTC+2).
    expect(maputoDayStart(new Date('2026-09-23T23:30:00Z'))).toBe('2026-09-23T22:00:00.000Z');
    expect(maputoDayStart(new Date('2026-09-24T10:00:00Z'))).toBe('2026-09-23T22:00:00.000Z');
  });
});
