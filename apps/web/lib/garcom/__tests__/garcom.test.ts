import { describe, expect, it } from 'vitest';

import { changeQty, resolveSellable, salePayloadItems, toggleLineAddon, cartLines, type Cart } from '@/lib/pos/cart';
import type { PosMenuItem } from '@/lib/pos/offline-store';
import type { PosTable, TableOrder } from '@/lib/pos/tables';

import { actionSchema, waiterErrorCode, waiterErrorMessage } from '../contract';
import {
  buildSellable,
  falhaDeEnvio,
  lerRascunho,
  meiosDeCobrar,
  needsItemSheet,
  novoRascunho,
  novosProntos,
  origemPedido,
  podeRetirar,
  podeServir,
  prontosParaServir,
  RASCUNHO_MAX_IDADE_MS,
} from '../pedido';

const queijo = { id: 'add-queijo', name: 'Queijo', price_cents: 5_000 };
const bacon = { id: 'add-bacon', name: 'Bacon', price_cents: 8_000 };

const classic: PosMenuItem = {
  id: 'item-classic',
  name: 'Classic Smash',
  description: null,
  photo_url: null,
  price_cents: 30_000,
  station: 'kitchen',
  available: true,
  variants: [
    { id: 'var-haw', name: 'HAW', price_cents: 30_000, is_default: true },
    { id: 'var-wagyu', name: 'WAGYU', price_cents: 40_000 },
  ],
  // A ordem do Cardápio: é a que sai no talão.
  addons: [queijo, bacon],
};

const chips: PosMenuItem = {
  id: 'item-chips',
  name: "Joe's Chips",
  description: null,
  photo_url: null,
  price_cents: 15_000,
  station: 'kitchen',
  available: true,
};

const UUID = '6f1c1a8e-0b8e-4c55-9d1a-2b8f4c1d9e01';
const MESA = '0d2f4b6a-8c1e-4a3b-9f5d-7e6c5b4a3d21';

describe('o artigo que o garçom junta ao pedido', () => {
  it('com variante e extras dá a mesma linha e o mesmo preço que o POS', () => {
    const wagyu = classic.variants![1];
    // POS: o lanche entra e os extras põem-se depois, um a um.
    let pos: Cart = changeQty({}, resolveSellable(classic, wagyu, null), 1);
    let linha = cartLines(pos)[0];
    ({ cart: pos, lineId: linha.id } = toggleLineAddon(pos, linha, bacon, classic.addons!));
    linha = pos[linha.id];
    ({ cart: pos } = toggleLineAddon(pos, linha, queijo, classic.addons!));
    const doPos = cartLines(pos)[0];

    // Telemóvel: tudo de uma vez, tocado por outra ordem.
    const doGarcom = buildSellable(classic, wagyu, ['add-bacon', 'add-queijo'], null);

    expect(doGarcom.id).toBe(doPos.id);
    expect(doGarcom.price_cents).toBe(40_000 + 5_000 + 8_000);
    expect(doGarcom.price_cents).toBe(doPos.price_cents);
    expect(doGarcom.addons?.map((a) => a.name)).toEqual(['Queijo', 'Bacon']);
  });

  it('sem extras é exactamente o artigo do POS', () => {
    expect(buildSellable(chips, null, [], null)).toEqual(resolveSellable(chips, null, null));
  });

  it('um extra que não é deste produto não entra nem conta no preço', () => {
    const linha = buildSellable(chips, null, ['add-queijo'], null);
    expect(linha.addons).toBeUndefined();
    expect(linha.price_cents).toBe(15_000);
  });

  it('a nota separa a linha: "sem cebola" e normal são dois pratos', () => {
    const normal = buildSellable(classic, null, [], null);
    const semCebola = buildSellable(classic, null, [], 'Sem cebola');
    expect(normal.id).not.toBe(semCebola.id);
  });

  it('só pergunta quando há escolha: duas variantes ou algum extra', () => {
    expect(needsItemSheet(classic)).toBe(true);
    expect(needsItemSheet(chips)).toBe(false);
    expect(needsItemSheet({ ...chips, addons: [queijo] })).toBe(true);
  });

  it('ao servidor vão ids e quantidades, nunca o preço', () => {
    const cart = changeQty({}, buildSellable(classic, classic.variants![1], ['add-queijo'], 'Sem cebola'), 2);
    const [item] = salePayloadItems(cartLines(cart));
    expect(item).toEqual({
      menuItemId: 'item-classic',
      qty: 2,
      variantId: 'var-wagyu',
      addonIds: ['add-queijo'],
      notes: 'Sem cebola',
    });
    expect(JSON.stringify(item)).not.toContain('price');
  });
});

describe('o rascunho da mesa, no telemóvel', () => {
  const agora = 1_800_000_000_000;
  const comArtigo = () => {
    const r = novoRascunho(MESA, UUID, agora);
    return { ...r, cart: changeQty({}, buildSellable(chips, null, [], null), 2) };
  };

  it('volta inteiro depois de recarregar a página', () => {
    const r = comArtigo();
    expect(lerRascunho(JSON.stringify(r), MESA, agora + 1000)).toEqual(r);
  });

  it('lixo, outra mesa ou nada dão null sem rebentar', () => {
    expect(lerRascunho(null, MESA, agora)).toBeNull();
    expect(lerRascunho('{nao é json', MESA, agora)).toBeNull();
    expect(lerRascunho(JSON.stringify({ tableId: MESA }), MESA, agora)).toBeNull();
    expect(lerRascunho(JSON.stringify(comArtigo()), 'outra-mesa', agora)).toBeNull();
  });

  it('o de ontem não aparece no turno de hoje…', () => {
    const r = comArtigo();
    expect(lerRascunho(JSON.stringify(r), MESA, agora + RASCUNHO_MAX_IDADE_MS + 1)).toBeNull();
  });

  it('…a não ser que o envio tenha ficado sem resposta: pode estar na cozinha', () => {
    const r = { ...comArtigo(), pendente: true };
    expect(lerRascunho(JSON.stringify(r), MESA, agora + RASCUNHO_MAX_IDADE_MS + 1)?.clientSaleId).toBe(UUID);
  });

  it('só uma resposta da BD prova que nada foi gravado', () => {
    expect(falhaDeEnvio(409)).toBe('recusado');
    expect(falhaDeEnvio(400)).toBe('recusado');
    expect(falhaDeEnvio(401)).toBe('recusado');
    // Sem resposta, ou o proxy a falhar: a cozinha pode já o ter.
    expect(falhaDeEnvio(0)).toBe('incerto');
    expect(falhaDeEnvio(500)).toBe('incerto');
    expect(falhaDeEnvio(502)).toBe('incerto');
  });
});

function pedido(id: string, status: string, criadoHa: number, extra: Partial<TableOrder> = {}): TableOrder {
  return {
    id,
    order_number: `MTL-${id}`,
    daily_number: 1,
    status,
    origin: 'pos',
    customer_name: null,
    created_at: new Date(Date.UTC(2026, 10, 5, 12, 0) - criadoHa * 60_000).toISOString(),
    total_cents: 30_000,
    notes: null,
    items: [],
    ...extra,
  };
}

function mesa(id: string, number: number, orders: TableOrder[]): PosTable {
  return { id, number, active: true, orders };
}

describe('as mesas no telemóvel', () => {
  const mesas = [
    mesa('m1', 1, [pedido('a', 'ready', 5), pedido('b', 'in_preparation', 2)]),
    mesa('m2', 2, [pedido('c', 'ready', 9), pedido('d', 'delivered', 20)]),
  ];

  it('prontos para servir: só os prontos, o mais antigo primeiro', () => {
    expect(prontosParaServir(mesas).map(({ table, order }) => `${table.number}:${order.id}`)).toEqual(['2:c', '1:a']);
  });

  it('vibra só pelo que ficou pronto desde a última leitura', () => {
    expect(novosProntos(new Set(['c']), mesas)).toEqual(['a']);
    expect(novosProntos(new Set(['a', 'c']), mesas)).toEqual([]);
  });

  it('servido só no que está na cozinha ou pronto', () => {
    expect(podeServir({ status: 'in_preparation' })).toBe(true);
    expect(podeServir({ status: 'ready' })).toBe(true);
    expect(podeServir({ status: 'delivered' })).toBe(false);
    expect(podeServir({ status: 'cancelled' })).toBe(false);
  });

  it('diz quem lançou: o garçom, o QR ou o balcão', () => {
    expect(origemPedido({ origin: 'pos', waiter_name: 'Ana' })).toBe('Ana');
    expect(origemPedido({ origin: 'qr', waiter_name: null })).toBe('QR');
    expect(origemPedido({ origin: 'pos' })).toBe('Balcão');
  });
});

describe('o mini POS', () => {
  const agora = Date.UTC(2026, 10, 5, 12, 0);
  const pedidoDe = (extra: Partial<TableOrder>) => pedido('p', 'in_preparation', 1, { waiter_id: 'ana', ...extra });

  it('retirar: só o dele, na cozinha, dentro do limite', () => {
    expect(podeRetirar(pedidoDe({}), 'ana', 3, agora)).toBe(true);
    expect(podeRetirar(pedidoDe({}), 'beto', 3, agora)).toBe(false);
    expect(podeRetirar(pedidoDe({ status: 'ready' }), 'ana', 3, agora)).toBe(false);
    expect(podeRetirar(pedido('p', 'in_preparation', 4, { waiter_id: 'ana' }), 'ana', 3, agora)).toBe(false);
    expect(podeRetirar(pedidoDe({}), 'ana', 0, agora)).toBe(false);
  });

  it('cobrar: nunca oferece dinheiro em notas, e respeita o que a loja desligou', () => {
    expect(meiosDeCobrar(null).map((m) => m.id)).not.toContain('cash');
    const config = {
      payments: {
        methods: [
          { id: 'cash', enabled: true, label: 'Dinheiro' },
          { id: 'mpesa', enabled: true, label: 'M-Pesa' },
          { id: 'emola', enabled: false, label: 'e-Mola' },
          { id: 'credit_card', enabled: true, label: 'POS Millennium' },
        ],
      },
    };
    expect(meiosDeCobrar(config)).toEqual([
      { id: 'mpesa', label: 'M-Pesa' },
      { id: 'credit_card', label: 'POS Millennium' },
    ]);
  });

  it('o contrato não aceita dinheiro em notas no cobrar', () => {
    const base = { action: 'close', clientCloseId: UUID, tableId: MESA, expectedTotalCents: 100 };
    expect(actionSchema.safeParse({ ...base, method: 'mpesa' }).success).toBe(true);
    expect(actionSchema.safeParse({ ...base, method: 'cash' }).success).toBe(false);
  });
});

describe('o contrato com /api/garcom', () => {
  it('um preço que viesse do telemóvel não passa da rota', () => {
    const parsed = actionSchema.parse({
      action: 'launch',
      clientSaleId: UUID,
      tableId: MESA,
      items: [{ menuItemId: UUID, qty: 1, unitPriceCents: 1, price_cents: 1 }],
      totalCents: 1,
    });
    expect(JSON.stringify(parsed)).not.toMatch(/price|total/i);
  });

  it('sem chave de envio, ou com quantidade absurda, é recusado', () => {
    expect(actionSchema.safeParse({ action: 'launch', tableId: MESA, items: [{ menuItemId: UUID, qty: 1 }] }).success).toBe(false);
    expect(
      actionSchema.safeParse({ action: 'launch', clientSaleId: UUID, tableId: MESA, items: [{ menuItemId: UUID, qty: 500 }] })
        .success,
    ).toBe(false);
    expect(actionSchema.safeParse({ action: 'launch', clientSaleId: UUID, tableId: MESA, items: [] }).success).toBe(false);
  });

  it('o erro da BD vira uma frase para a sala', () => {
    const msg = 'item_unavailable:6f1c1a8e-0b8e-4c55-9d1a-2b8f4c1d9e01';
    expect(waiterErrorCode(msg)).toBe('item_unavailable');
    expect(waiterErrorMessage(msg)).toMatch(/esgotou/);
    expect(waiterErrorCode('erro qualquer')).toBeNull();
    expect(waiterErrorMessage(null)).toMatch(/rede/);
  });
});
