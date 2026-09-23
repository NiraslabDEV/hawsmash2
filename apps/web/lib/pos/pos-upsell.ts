/**
 * Funil de upsell do balcão.
 *
 * Diferença de fundo face ao upsell da loja online (`lib/upsell.ts`): lá quem
 * decide é o **cliente**, sozinho, e a regra é não incomodar — pergunta-se uma
 * vez e segue. Aqui quem é obrigado a passar pelo ecrã é o **operador**. O que
 * se força é a oferta, não a compra: cada passo salta-se com um toque quando o
 * cliente diz que não.
 *
 * A razão é de negócio, não de software. Um balcão que nunca oferece batata
 * perde margem todos os dias, e ninguém consegue provar que a oferta não foi
 * feita. O ecrã garante que foi.
 *
 * Regra do gatilho: **por categoria em falta**. Quem já levou bebida não leva
 * outra oferta de bebida à cara; quem levou três lanches e nenhuma batata leva
 * a oferta na mesma.
 */

import { companionOffers, type UpsellCartLine, type UpsellItem } from '@/lib/upsell';
import { pickScript, type PosUpsellStepKind } from './upsell-scripts';
import {
  FACTORY_POS_SETTINGS,
  type PosUpsellStepId,
  type PosUpsellStepSetting,
} from './settings';

export interface PosUpsellCategory {
  name: string;
  items: UpsellItem[];
}

export interface PosUpsellStep {
  kind: PosUpsellStepKind;
  /** Cabeçalho do ecrã. Curto: lê-se de relance. */
  title: string;
  /** A frase que o operador diz ao cliente. */
  script: string;
  items: UpsellItem[];
}

/**
 * Que categorias caem no passo da sobremesa. Vive aqui, num sítio só, porque a
 * alternativa — adivinhar pelo nome espalhado por três ficheiros — parte no dia
 * em que alguém renomear a categoria no painel.
 *
 * Quando existir um campo de papel na categoria (`role`), troca-se isto por ele
 * e deixa de haver adivinhação nenhuma.
 */
const CATEGORIA_SOBREMESA = /sobremesa|doce/i;

/**
 * Dentro do passo de acompanhar, a batata vem antes das bebidas.
 *
 * Não é estética: a frase que o operador lê fala de batata, e ter a batata em
 * oitavo lugar depois de sete refrigerantes é pedir uma coisa e mostrar outra.
 * A batata é também a margem maior.
 */
const CATEGORIA_ACOMPANHAMENTO = /acompanh|batata|extra/i;

/** O carrinho tem algum item principal (não-upsell)? Só bebida não abre funil. */
export function hasMainItem(cart: UpsellCartLine[], items: UpsellItem[]): boolean {
  const byId = new Map(items.map((item) => [item.id, item]));
  return cart.some((line) => {
    const item = byId.get(line.menuItemId);
    return !!item && item.is_upsell !== true;
  });
}

/**
 * O que um passo oferece quando a loja não escolheu produtos: os marcados como
 * upsell no Cardápio, no passo da sua categoria (sobremesa no fim), com os
 * acompanhamentos antes das bebidas. Sem filtrar carrinho nem esgotados — é
 * também o que o painel mostra como "o que o Cardápio oferece hoje".
 */
export function cardapioStepProducts(
  categories: PosUpsellCategory[],
  step: PosUpsellStepId,
): UpsellItem[] {
  const sobremesa = step === 'dessert';
  return categories
    .filter((category) => CATEGORIA_SOBREMESA.test(category.name) === sobremesa)
    // Acompanhamentos primeiro; o resto (bebidas) a seguir.
    .sort((a, b) => {
      const pa = CATEGORIA_ACOMPANHAMENTO.test(a.name) ? 0 : 1;
      const pb = CATEGORIA_ACOMPANHAMENTO.test(b.name) ? 0 : 1;
      return pa - pb;
    })
    .flatMap((category) => category.items)
    .filter((item) => item.is_upsell === true);
}

/**
 * Os passos a mostrar entre o carrinho e o pagamento, por ordem.
 *
 * Lista vazia significa "vai directo ao pagamento" — sem funil, sem atraso.
 */
export function buildPosUpsellFunnel(input: {
  enabled: boolean;
  categories: PosUpsellCategory[];
  cart: UpsellCartLine[];
  /** Estável durante uma venda, diferente entre vendas. Roda as frases. */
  seed: number;
  /**
   * Os passos como a loja os configurou no painel (título, frases, ligado).
   * Sem isto usa o valor de fábrica de `settings.ts`.
   */
  steps?: Record<PosUpsellStepId, PosUpsellStepSetting>;
}): PosUpsellStep[] {
  const { enabled, categories, cart, seed } = input;
  const steps = input.steps ?? FACTORY_POS_SETTINGS.upsell.steps;
  if (!enabled || cart.length === 0) return [];

  const todos = categories.flatMap((category) => category.items);
  // Vender só uma Coca não é motivo para oferecer sobremesa.
  if (!hasMainItem(cart, todos)) return [];

  // Reaproveita o filtro da loja online: marcado como upsell, disponível, e
  // ainda não está no carrinho. Uma lógica só a decidir o que se oferece.
  const disponiveis = new Set(companionOffers(cart, todos, Number.MAX_SAFE_INTEGER).map((i) => i.id));

  const doPasso = (sobremesa: boolean): UpsellItem[] =>
    cardapioStepProducts(categories, sobremesa ? 'dessert' : 'companion')
      .filter((item) => disponiveis.has(item.id));

  const passos: PosUpsellStep[] = [];

  // A loja escolheu os produtos deste passo na aba POS: são esses, por essa
  // ordem — mesmo que não estejam marcados no Cardápio. Continua a valer o
  // resto da regra: disponível e ainda não no carrinho. Um id que já não existe
  // (produto apagado) cai sem barulho.
  const porId = new Map(todos.map((item) => [item.id, item]));
  const noCarrinho = new Set(cart.map((line) => line.menuItemId));
  const escolhidos = (ids: string[]): UpsellItem[] =>
    ids
      .map((id) => porId.get(id))
      .filter((item): item is UpsellItem => !!item && item.available !== false && !noCarrinho.has(item.id));
  const doPassoDaLoja = (step: PosUpsellStepSetting, sobremesa: boolean): UpsellItem[] =>
    step.productIds.length > 0 ? escolhidos(step.productIds) : doPasso(sobremesa);

  const acompanhar = steps.companion.enabled ? doPassoDaLoja(steps.companion, false) : [];
  if (acompanhar.length > 0) {
    passos.push({
      kind: 'companion',
      title: steps.companion.title,
      script: pickScript(steps.companion.scripts, seed),
      items: acompanhar,
    });
  }

  const sobremesas = steps.dessert.enabled ? doPassoDaLoja(steps.dessert, true) : [];
  if (sobremesas.length > 0) {
    passos.push({
      kind: 'dessert',
      title: steps.dessert.title,
      script: pickScript(steps.dessert.scripts, seed),
      items: sobremesas,
    });
  }

  return passos;
}
