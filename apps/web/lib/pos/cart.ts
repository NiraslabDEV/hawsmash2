/**
 * O carrinho do balcão, com variantes.
 *
 * Existe como módulo próprio — e não dentro do `pos-shell` — por duas razões.
 * A primeira é que isto é a conta do dinheiro: qual é o preço, que linha é que
 * é a mesma linha, o que se manda ao servidor. Isso testa-se sem browser.
 * A segunda é o WAGYU.
 *
 * O WAGYU não é um produto: é uma **variante** do Classic Smash, do Double
 * Smash e do Smoked Brisket. A migration 1018 pôs o servidor a cobrar o preço
 * da variante; faltava o balcão saber pedi-la. Aqui a regra é a mesma que o
 * servidor aplica e que o motor da loja online sempre aplicou: **o preço da
 * variante substitui o do item base**. Duas contas diferentes para o mesmo
 * preço é exactamente o que a Regra 2 do CLAUDE proíbe.
 *
 * A identidade da linha também muda por causa disto: um Classic HAW e um
 * Classic WAGYU no mesmo carrinho são **duas linhas**, não uma com quantidade
 * 2 — têm preços diferentes e saem na comanda com nomes diferentes.
 */

import type { PosMenuItem } from './offline-store';

export type PosVariant = NonNullable<PosMenuItem['variants']>[number];

export type CartLine = {
  /**
   * Identidade no carrinho: item, variante e nota. A nota entra na chave de
   * propósito — um Classic "sem jalapeño" e um Classic normal são dois pratos
   * diferentes para a cozinha, e juntá-los em `2x Classic` mandava para a
   * chapa um pedido que ninguém fez.
   */
  id: string;
  menuItemId: string;
  variantId: string | null;
  /** Já resolvido para leitura humana: "Classic Smash WAGYU". Vai ao talão. */
  name: string;
  price_cents: number;
  station: 'kitchen' | 'bar';
  photo_url: string | null;
  /** "SEM JALAPENO", "bem passado". Sai na comanda e no talão. */
  notes: string | null;
  qty: number;
};

export type Sellable = Omit<CartLine, 'qty'>;
export type Cart = Record<string, CartLine>;

export function cartKey(
  menuItemId: string,
  variantId?: string | null,
  notes?: string | null,
): string {
  const base = variantId ? `${menuItemId}:${variantId}` : menuItemId;
  const nota = notes?.trim();
  return nota ? `${base}#${nota.toLowerCase()}` : base;
}

/**
 * Perguntar a variante só faz sentido quando há escolha a fazer. Um item com
 * uma variante só não é uma pergunta — é um toque a mais entre o operador e a
 * venda, e ao balcão isso custa segundos que não existem.
 */
export function needsVariantChoice(item: PosMenuItem): boolean {
  return (item.variants?.length ?? 0) > 1;
}

/** A variante a assumir quando não se pergunta: a marcada por omissão, senão a primeira. */
export function defaultVariant(item: PosMenuItem): PosVariant | null {
  const variants = item.variants ?? [];
  if (variants.length === 0) return null;
  return variants.find((variant) => variant.is_default) ?? variants[0];
}

/** O nome que sai no ecrã e no papel. "Classic Smash" + "WAGYU" → "Classic Smash WAGYU". */
function resolveName(item: PosMenuItem, variant: PosVariant | null): string {
  if (!variant) return item.name;
  const nome = variant.name.trim();
  // Evita "Coca-Cola Coca-Cola" quando a variante já repete o nome do produto.
  if (!nome || item.name.toLowerCase().includes(nome.toLowerCase())) return item.name;
  return `${item.name} ${nome}`;
}

export function resolveSellable(
  item: PosMenuItem,
  variant?: PosVariant | null,
  notes?: string | null,
): Sellable {
  const escolhida = variant ?? null;
  const nota = notes?.trim() || null;
  return {
    id: cartKey(item.id, escolhida?.id, nota),
    menuItemId: item.id,
    variantId: escolhida?.id ?? null,
    notes: nota,
    name: resolveName(item, escolhida),
    // O preço da variante SUBSTITUI o do item base (migration 1018).
    price_cents: escolhida ? escolhida.price_cents : item.price_cents,
    station: item.station,
    photo_url: escolhida?.photo_url ?? item.photo_url ?? null,
  };
}

export function changeQty(cart: Cart, sellable: Sellable, delta: number): Cart {
  const existente = cart[sellable.id];
  const qty = (existente?.qty ?? 0) + delta;
  if (qty <= 0) {
    const seguinte = { ...cart };
    delete seguinte[sellable.id];
    return seguinte;
  }
  return { ...cart, [sellable.id]: { ...sellable, qty } };
}

export function cartLines(cart: Cart): CartLine[] {
  return Object.values(cart);
}

export function cartTotalCents(cart: Cart): number {
  return cartLines(cart).reduce((soma, linha) => soma + linha.price_cents * linha.qty, 0);
}

export function cartCount(cart: Cart): number {
  return cartLines(cart).reduce((soma, linha) => soma + linha.qty, 0);
}

/**
 * Quantos deste produto estão no carrinho, somando todas as variantes.
 *
 * É o número do emblema no cartão da grelha e do funil de upsell: quem já pôs
 * um Classic HAW e um Classic WAGYU tem dois Classic, e o cartão tem de o
 * dizer. Sem isto o emblema mostrava só uma das variantes e mentia.
 */
export function qtyOfItem(cart: Cart, menuItemId: string): number {
  return cartLines(cart)
    .filter((linha) => linha.menuItemId === menuItemId)
    .reduce((soma, linha) => soma + linha.qty, 0);
}

/**
 * Tira um deste produto, sem perguntar qual variante.
 *
 * É o que o `−` do funil de upsell precisa: ali o cartão é do **produto**, não
 * da variante, e quem se enganou quer desfazer o toque que deu — não escolher
 * outra vez entre HAW e WAGYU. Tira-se da linha adicionada mais recentemente,
 * que é a que o engano acabou de criar.
 */
export function removeOneOfItem(cart: Cart, menuItemId: string): Cart {
  const doItem = cartLines(cart).filter((linha) => linha.menuItemId === menuItemId);
  const ultima = doItem[doItem.length - 1];
  if (!ultima) return cart;
  return changeQty(cart, ultima, -1);
}

/**
 * O que se manda ao servidor: ids e quantidades, nunca preços (Regra 2). O
 * `variantId` só vai quando existe — a RPC aceita a chave ausente e é assim
 * que os produtos sem variante continuam a funcionar sem excepção nenhuma.
 */
export function salePayloadItems(
  lines: CartLine[],
): Array<{ menuItemId: string; qty: number; variantId?: string; notes?: string }> {
  return lines.map((linha) => ({
    menuItemId: linha.menuItemId,
    qty: linha.qty,
    ...(linha.variantId ? { variantId: linha.variantId } : {}),
    ...(linha.notes ? { notes: linha.notes } : {}),
  }));
}

/**
 * Trocar a nota de uma linha que já está no carrinho.
 *
 * A nota faz parte da identidade da linha, por isso mudá-la é mudar de linha:
 * tira-se a quantidade da antiga e põe-se na nova. Se já existir uma linha
 * igual com essa nota — dois "sem cebola" pedidos em momentos diferentes —
 * as quantidades somam-se, que é o que o operador espera ver.
 */
export function setLineNotes(cart: Cart, line: CartLine, notes: string | null): Cart {
  const nota = notes?.trim() || null;
  if (nota === line.notes) return cart;
  const seguinte = { ...cart };
  delete seguinte[line.id];
  const id = cartKey(line.menuItemId, line.variantId, nota);
  const existente = seguinte[id];
  seguinte[id] = {
    ...line,
    id,
    notes: nota,
    qty: (existente?.qty ?? 0) + line.qty,
  };
  return seguinte;
}
