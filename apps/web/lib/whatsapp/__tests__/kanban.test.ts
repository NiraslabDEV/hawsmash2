import { describe, expect, it } from 'vitest';

import { groupByColumn, outboundText, since, toCard, type ConversationRow } from '../kanban';

const NOW = Date.parse('2026-11-10T18:00:00Z');
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

const row = (state: unknown, lastMin: number | null = 5, extra: Partial<ConversationRow> = {}): ConversationRow => ({
  id: crypto.randomUUID(),
  phone: '+258841234567',
  profile_name: 'Ana',
  last_inbound_at: lastMin === null ? null : ago(lastMin),
  updated_at: ago(1),
  state,
  ...extra,
});

describe('kanban do WhatsApp — a coluna vem do passo do bot', () => {
  it('quem só escreveu fica em Novas', () => {
    expect(toCard(row({}), NOW).column).toBe('novas');
    expect(toCard(row({ step: 'idle', cart: [] }), NOW).column).toBe('novas');
  });

  it('a montar o pedido, ou com carrinho, fica em A pedir', () => {
    expect(toCard(row({ step: 'address' }), NOW).column).toBe('a_pedir');
    expect(toCard(row({ step: 'confirm' }), NOW).stepLabel).toContain('Confirmar');
    const comCarrinho = toCard(row({ step: 'idle', cart: [{}, {}] }), NOW);
    expect(comCarrinho.column).toBe('a_pedir');
    expect(comCarrinho.cartItems).toBe(2);
  });

  it('pedido criado sem comprovativo fica à espera, mesmo depois de 24 h', () => {
    const card = toCard(row({ step: 'proof', order: { number: 'MPT-0042' } }, 60 * 30), NOW);
    expect(card.column).toBe('comprovativo');
    expect(card.orderNumber).toBe('MPT-0042');
    expect(card.windowOpen).toBe(false);
  });

  it('"correu mal" vai para Precisa de humano e não sai sozinho', () => {
    expect(toCard(row({ step: 'feedback' }, 60 * 48), NOW).column).toBe('humano');
  });

  it('sem resposta há mais de 24 h fecha (a Meta fecha a janela)', () => {
    const card = toCard(row({ step: 'address' }, 60 * 25), NOW);
    expect(card.column).toBe('fechadas');
    expect(card.windowOpen).toBe(false);
    expect(toCard(row({}, null), NOW).column).toBe('fechadas');
  });

  it('pedido já pago e de volta ao menu fica em Fechadas', () => {
    expect(toCard(row({ step: 'idle', order: { number: 'MPT-0042' } }), NOW).column).toBe('fechadas');
  });

  it('estado estranho não parte o quadro', () => {
    expect(toCard(row(null), NOW).column).toBe('novas');
    expect(toCard(row({ step: 'inventado', cart: 'x' }), NOW).stepLabel).toBe('No menu');
  });

  it('agrupa por coluna, a conversa mais recente primeiro', () => {
    const grupos = groupByColumn([row({}, 30, { id: 'velha' }), row({}, 2, { id: 'nova' }), row({ step: 'proof' })], NOW);
    expect(grupos.novas.map((c) => c.id)).toEqual(['nova', 'velha']);
    expect(grupos.comprovativo).toHaveLength(1);
    expect(grupos.humano).toEqual([]);
  });

  it('mostra a resposta do bot com os botões; aviso sem payload fica null', () => {
    expect(outboundText({ type: 'text', text: 'Olá' })).toBe('Olá');
    expect(outboundText({ type: 'buttons', text: 'Confirmas?', buttons: [{ id: 'a', title: 'Confirmar' }, { id: 'b', title: 'Alterar' }] }))
      .toBe('Confirmas?\n[Confirmar] [Alterar]');
    expect(outboundText({ type: 'list', text: 'Cardápio', button: 'Ver', sections: [] })).toBe('Cardápio\n[Ver]');
    expect(outboundText(null)).toBeNull();
  });

  it('diz há quanto tempo foi', () => {
    expect(since(ago(0), NOW)).toBe('agora');
    expect(since(ago(12), NOW)).toBe('há 12 min');
    expect(since(ago(180), NOW)).toBe('há 3 h');
    expect(since(ago(60 * 24), NOW)).toBe('há 1 dia');
    expect(since(null, NOW)).toBe('—');
  });
});
