import { describe, expect, it } from 'vitest';

import { cartLines, changeQty, resolveSellable } from '@/lib/pos/cart';
import type { PosMenuItem } from '@/lib/pos/offline-store';

import { actionSchema } from '../contract';
import {
  itensDoEnvio,
  lerRascunho,
  naPessoa,
  nomeDePessoa,
  novoRascunho,
  porPessoa,
  pratosDe,
  renomearPessoa,
  tirarPessoa,
  type Rascunho,
} from '../pedido';

const classic: PosMenuItem = {
  id: 'aaaaaaaa-1111-4111-8111-111111111111',
  name: 'Classic Smash',
  description: null,
  photo_url: null,
  price_cents: 30_000,
  station: 'kitchen',
  available: true,
};
const chips: PosMenuItem = { ...classic, id: 'bbbbbbbb-2222-4222-8222-222222222222', name: "Joe's Chips", price_cents: 15_000 };

const MESA = '0d2f4b6a-8c1e-4a3b-9f5d-7e6c5b4a3d21';
const UUID = '6f1c1a8e-0b8e-4c55-9d1a-2b8f4c1d9e01';

function mesaDeTres(): Rascunho {
  let r: Rascunho = { ...novoRascunho(MESA, UUID, 0), pessoas: ['Ana', 'Rui', 'Marta'] };
  const juntar = (item: PosMenuItem, pessoa: string | null, qty = 1) => {
    r = { ...r, cart: changeQty(r.cart, naPessoa(resolveSellable(item, null), pessoa), qty) };
  };
  juntar(classic, 'Ana');
  juntar(classic, 'Rui', 2);
  juntar(chips, 'Marta');
  juntar(chips, null);
  return r;
}

describe('cada prato com o nome de quem o pediu (1137)', () => {
  it('o mesmo artigo para pessoas diferentes são linhas diferentes', () => {
    const r = mesaDeTres();
    const classics = cartLines(r.cart).filter((l) => l.menuItemId === classic.id);
    expect(classics.map((l) => [l.person, l.qty])).toEqual([
      ['Ana', 1],
      ['Rui', 2],
    ]);
    expect(pratosDe(r.cart, 'Rui')).toBe(2);
    expect(pratosDe(r.cart, null)).toBe(1);
  });

  it('o pedido arruma-se pela ordem das pessoas, a mesa toda no fim', () => {
    const grupos = porPessoa(mesaDeTres());
    expect(grupos.map((g) => g.pessoa)).toEqual(['Ana', 'Rui', 'Marta', null]);
  });

  it('vai ao servidor o nome de cada prato, e nunca o preço (Regra 2)', () => {
    const itens = itensDoEnvio(cartLines(mesaDeTres().cart));
    expect(itens).toEqual([
      { menuItemId: classic.id, qty: 1, person: 'Ana' },
      { menuItemId: classic.id, qty: 2, person: 'Rui' },
      { menuItemId: chips.id, qty: 1, person: 'Marta' },
      { menuItemId: chips.id, qty: 1 },
    ]);
    const launch = actionSchema.safeParse({ action: 'launch', clientSaleId: UUID, tableId: MESA, items: itens });
    expect(launch.success).toBe(true);
  });

  it('o contrato recusa um nome comprido demais', () => {
    const launch = actionSchema.safeParse({
      action: 'launch',
      clientSaleId: UUID,
      tableId: MESA,
      items: [{ menuItemId: '11111111-1111-4111-8111-111111111111', qty: 1, person: 'x'.repeat(41) }],
    });
    expect(launch.success).toBe(false);
  });

  it('mudar o nome leva os pratos da pessoa', () => {
    const r = renomearPessoa({ ...mesaDeTres(), pessoa: 'Rui' }, 'Rui', 'Rui (camisa azul)');
    expect(r.pessoas).toEqual(['Ana', 'Rui (camisa azul)', 'Marta']);
    expect(r.pessoa).toBe('Rui (camisa azul)');
    expect(pratosDe(r.cart, 'Rui (camisa azul)')).toBe(2);
    expect(pratosDe(r.cart, 'Rui')).toBe(0);
  });

  it('tirar alguém da mesa não deita os pratos fora: passam para a mesa toda', () => {
    const r = tirarPessoa(mesaDeTres(), 'Marta');
    expect(r.pessoas).toEqual(['Ana', 'Rui']);
    // As chips da Marta juntam-se às da mesa toda numa só linha.
    expect(cartLines(r.cart).filter((l) => l.menuItemId === chips.id)).toMatchObject([{ person: null, qty: 2 }]);
  });

  it('nome em branco dá "Pessoa N"; nome repetido não entra', () => {
    expect(nomeDePessoa('', [])).toBe('Pessoa 1');
    expect(nomeDePessoa('  ', ['Ana', 'Pessoa 2'])).toBe('Pessoa 3');
    expect(nomeDePessoa(' ana ', ['Ana'])).toBeNull();
    expect(nomeDePessoa('Ana', ['Ana'], 'Ana')).toBe('Ana');
    expect(nomeDePessoa('João  da   Silva', [])).toBe('João da Silva');
  });

  it('um nome com "|" não baralha a linha', () => {
    const s = naPessoa(resolveSellable(classic, null), 'A|B');
    expect(naPessoa(s, null).id).toBe(resolveSellable(classic, null).id);
  });

  it('o rascunho guardado antes da 1137 abre sem pessoas', () => {
    const antigo = { ...novoRascunho(MESA, UUID, 0) } as Partial<Rascunho>;
    delete antigo.pessoas;
    delete antigo.pessoa;
    const lido = lerRascunho(JSON.stringify(antigo), MESA, 1);
    expect(lido?.pessoas).toEqual([]);
    expect(lido?.pessoa).toBeNull();
  });

  it('o rascunho com pessoas sobrevive a recarregar a página', () => {
    const r = { ...mesaDeTres(), pessoa: 'Ana' };
    const lido = lerRascunho(JSON.stringify(r), MESA, 1);
    expect(lido?.pessoa).toBe('Ana');
    expect(porPessoa(lido!).map((g) => g.pessoa)).toEqual(['Ana', 'Rui', 'Marta', null]);
  });
});
