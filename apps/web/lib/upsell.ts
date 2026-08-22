/**
 * Upsell — o que oferecer entre o carrinho e o pagamento.
 *
 * Duas ofertas, por esta ordem:
 *
 *  1. **Subir de gama** — uma linha que leva a variante barata quando existe uma
 *     melhor (HAW → WAGYU). É a oferta mais valiosa: o cliente já quer o produto,
 *     só falta perguntar. Nunca se oferece a quem já escolheu a de cima.
 *  2. **Acompanhar** — itens marcados `is_upsell` no painel (bebidas, batatas,
 *     natas) que ainda não estão no carrinho.
 *
 * Regras de ouro, herdadas da SLICE: o upsell **nunca bloqueia a venda**. Sem
 * nada para oferecer, com o upsell desligado, ou com o cliente já servido, o
 * ecrã salta sozinho para o pagamento. E pergunta-se **uma vez**: quem já tem
 * bebida no carrinho não leva outra oferta de bebida à cara.
 *
 * Preços aqui são pré-visualização. Quem decide o preço é o servidor.
 */

export interface UpsellVariant {
  id: string;
  name: string;
  price_cents: number;
  photo_url?: string | null;
}

export interface UpsellItem {
  id: string;
  name: string;
  description?: string | null;
  price_cents: number;
  photo_url?: string | null;
  available?: boolean;
  is_upsell?: boolean;
  variants?: UpsellVariant[];
}

export interface UpsellCartLine {
  menuItemId: string;
  qty: number;
  variantId?: string;
}

/** Uma linha do carrinho que pode subir de gama. */
export interface UpgradeOffer {
  index: number;
  item: UpsellItem;
  current: UpsellVariant;
  better: UpsellVariant;
  qty: number;
  /** Diferença por unidade, em centavos. Nunca negativa. */
  extraCents: number;
}

/**
 * Ofertas de subida de gama. Só conta a variante imediatamente acima da actual
 * (a mais barata das mais caras): oferecer o salto maior parece ganância e
 * converte pior.
 */
export function upgradeOffers(cart: UpsellCartLine[], items: UpsellItem[]): UpgradeOffer[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const offers: UpgradeOffer[] = [];

  cart.forEach((line, index) => {
    const item = byId.get(line.menuItemId);
    if (!item || !line.variantId) return;

    const variants = item.variants ?? [];
    const current = variants.find((v) => v.id === line.variantId);
    if (!current) return;

    const better = variants
      .filter((v) => v.price_cents > current.price_cents)
      .sort((a, b) => a.price_cents - b.price_cents)[0];
    if (!better) return;

    offers.push({
      index,
      item,
      current,
      better,
      qty: line.qty,
      extraCents: better.price_cents - current.price_cents,
    });
  });

  return offers;
}

/**
 * Itens para acompanhar: marcados no painel, disponíveis, e que ainda não estão
 * no carrinho (não se oferece o que a pessoa já pôs lá).
 */
export function companionOffers(
  cart: UpsellCartLine[],
  items: UpsellItem[],
  // Tecto generoso de propósito: com as bebidas à frente no cardápio, um limite
  // apertado deixava as natas de fora — e a sobremesa vende.
  limit = 12,
): UpsellItem[] {
  const inCart = new Set(cart.map((line) => line.menuItemId));
  return items
    .filter((item) => item.is_upsell && item.available !== false && !inCart.has(item.id))
    .slice(0, limit);
}

/** O cliente já tem algum dos itens de acompanhamento no carrinho? */
export function alreadyServed(cart: UpsellCartLine[], items: UpsellItem[]): boolean {
  const upsellIds = new Set(items.filter((item) => item.is_upsell).map((item) => item.id));
  return cart.some((line) => upsellIds.has(line.menuItemId));
}

export type UpsellDecision = 'wait' | 'store' | 'checkout' | 'show';

/**
 * O que fazer ao entrar no ecrã de upsell.
 *
 * - `wait`    — ainda não há dados suficientes (carrinho por hidratar, menu a carregar).
 *               Decidir aqui era o bug da SLICE: carrinho vazio no 1.º render mandava
 *               a pessoa de volta ao cardápio antes de ler o carrinho verdadeiro.
 * - `store`   — carrinho vazio: não há pedido nenhum para completar.
 * - `checkout`— nada a oferecer (ou upsell desligado): segue sem incomodar.
 * - `show`    — há oferta.
 */
export function upsellDecision(input: {
  ready: boolean;
  enabled: boolean;
  cartLength: number;
  upgrades: number;
  companions: number;
  served: boolean;
}): UpsellDecision {
  if (!input.ready) return 'wait';
  if (input.cartLength === 0) return 'store';
  if (!input.enabled) return 'checkout';
  if (input.upgrades > 0) return 'show';
  // Já tem bebida (ou outro acompanhamento) no carrinho: pergunta-se uma vez.
  if (input.served) return 'checkout';
  return input.companions > 0 ? 'show' : 'checkout';
}
