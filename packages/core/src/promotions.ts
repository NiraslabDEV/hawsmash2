/**
 * Descontos e promoções — a conta de um pedido do site.
 *
 * Isto é o ESPELHO de `private.apply_order_promotions` (migration 1113). O
 * total que conta é sempre o que o servidor gravar (CLAUDE §1, regra 2); aqui
 * só se calcula a pré-visualização do checkout. Por isso as regras têm de ser
 * exactamente as mesmas — qualquer mudança faz-se nos dois sítios, com teste.
 *
 * Três mecanismos, herdados da instância SLICE e adaptados a várias lojas:
 *
 *   · **Promo 2x1** (por loja): compre um, leve o segundo grátis. Produtos
 *     elegíveis marcados um a um. UMA unidade grátis por pedido. A grátis nunca
 *     vale mais que a paga: paga-se a mais cara e sai grátis a SEGUNDA mais cara.
 *     Por omissão o par tem de ser do mesmo produto (o stock fecha); a loja pode
 *     aceitar quaisquer dois elegíveis.
 *   · **Cupões** (por código): % ou valor fixo, brinde (um produto a 0) ou 2x1.
 *     A % calcula-se DEPOIS do 2x1, para não dar desconto sobre o que já saiu
 *     grátis.
 *   · **Entrega grátis** (por loja) a partir de um mínimo, contado DEPOIS dos
 *     descontos — senão as promoções acumulavam umas sobre as outras.
 *
 * O preço de cada unidade é o EFECTIVO da linha (tamanho, extras, escolhas),
 * não o de tabela: um simples cheio de extras pode custar mais que um duplo.
 */

/** Uma unidade de um produto elegível (qty 3 = três unidades). */
export type PromoUnit = { itemId: string; name: string; priceCents: number };

/** Uma linha do carrinho/pedido, com o preço unitário já efectivo. */
export type PromoLine = {
  itemId: string;
  name: string;
  unitPriceCents: number;
  qty: number;
  bogoEligible: boolean;
  isGift?: boolean;
};

/** Janela de funcionamento de um dia (`store_hours`), em hora de Maputo. */
export type WeeklyWindow = { dow: number; opens: string; closes: string; active: boolean };

export type PromotionRule = {
  active: boolean;
  /** 0 = domingo. Vazio = nunca corre. */
  weekdays: number[];
  startsAt?: string | null;
  endsAt?: string | null;
};

export type CouponRewardType = 'discount_pct' | 'discount_cents' | 'free_item' | 'bogo';

export type PromotionInput = {
  lines: PromoLine[];
  fulfillment: 'delivery' | 'pickup' | 'dine_in' | 'counter';
  /** Taxa da zona, antes de qualquer promoção. */
  deliveryFeeCents: number;
  /**
   * `giftItemId` só no produto grátis: no balcão o produto está no carrinho a
   * preço cheio e o cupão tira uma unidade. No site o brinde já entra a 0.
   */
  coupon?: { type: CouponRewardType; value: number; giftItemId?: string | null } | null;
  /**
   * A promo 2x1 da loja, já avaliada para este instante E para este canal: o
   * site passa-a sempre; o balcão só se a loja a marcou "também no balcão".
   */
  bogo?: { live: boolean; sameItemOnly: boolean } | null;
  /** Desconto manual do gerente/dono (só balcão), sobre o que sobra. */
  manual?: { type: 'pct' | 'cents'; value: number } | null;
  /** Mínimo da entrega grátis activa neste instante. null/0 = desligada. */
  freeDeliveryMinCents?: number | null;
};

export type PromotionResult = {
  subtotalCents: number;
  bogoDiscountCents: number;
  /** Nome da unidade que saiu grátis pelo 2x1. */
  bogoFreeItem: string | null;
  couponDiscountCents: number;
  manualDiscountCents: number;
  /** Tudo o que se abateu aos produtos: 2x1 + cupão + manual (é o `orders.discount_cents`). */
  discountCents: number;
  /** Taxa de entrega cobrada, depois da promo. */
  deliveryFeeCents: number;
  /** Taxa de entrega perdoada pela promo. */
  deliveryDiscountCents: number;
  totalCents: number;
  /** O 2x1 está a correr e falta um produto para o par — para o ecrã avisar. */
  bogoOneAway: boolean;
  /** Quanto falta (em produtos) para a entrega ficar grátis. 0 = nada a dizer. */
  missingForFreeDeliveryCents: number;
};

const MAPUTO_OFFSET_MINUTES = 120; // CAT, sem horário de verão.

// Paga-se a mais cara; empate de preço desempata pelo nome, igual ao SQL.
function byPriceThenName(a: PromoUnit, b: PromoUnit): number {
  if (b.priceCents !== a.priceCents) return b.priceCents - a.priceCents;
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/**
 * A unidade que sai grátis pelo 2x1, ou null se não houver par.
 * Não altera o array recebido.
 */
export function pickFreeUnit(units: PromoUnit[], opts: { sameItemOnly: boolean }): PromoUnit | null {
  if (!units || units.length < 2) return null;

  const grupos = new Map<string, PromoUnit[]>();
  for (const u of units) {
    const chave = opts.sameItemOnly ? u.itemId : '*';
    const lista = grupos.get(chave);
    if (lista) lista.push(u);
    else grupos.set(chave, [u]);
  }

  let melhor: PromoUnit | null = null;
  for (const lista of grupos.values()) {
    if (lista.length < 2) continue;
    const candidata = [...lista].sort(byPriceThenName)[1];
    if (!melhor || byPriceThenName(candidata, melhor) < 0) melhor = candidata;
  }
  return melhor;
}

function toMinutes(time: string): number {
  const [h, m] = time.split(':');
  return Number(h) * 60 + Number(m);
}

/**
 * Dia da semana do TURNO que cobre este instante, em Maputo.
 *
 * Se a janela de ontem vira a meia-noite e ainda cobre esta hora, o turno é o
 * de ontem: quem viu o cartaz "sexta 2x1" e pede à 01:00 de sábado apanha-a.
 */
export function businessWeekday(hours: WeeklyWindow[] | null | undefined, at: Date = new Date()): number {
  const local = new Date(at.getTime() + MAPUTO_OFFSET_MINUTES * 60_000);
  const dow = local.getUTCDay();
  const minuto = local.getUTCHours() * 60 + local.getUTCMinutes();
  const ontem = (dow + 6) % 7;
  const janela = (hours ?? []).find((h) => h.dow === ontem && h.active);
  if (janela) {
    const abre = toMinutes(janela.opens);
    const fecha = toMinutes(janela.closes);
    if (fecha < abre && minuto < fecha) return ontem;
  }
  return dow;
}

/** A promoção está a correr neste instante? (interruptor + datas + dia do turno) */
export function isPromotionLive(
  rule: PromotionRule | null | undefined,
  hours: WeeklyWindow[] | null | undefined,
  at: Date = new Date(),
): boolean {
  if (!rule?.active) return false;
  if (!rule.weekdays || rule.weekdays.length === 0) return false;
  if (rule.startsAt && new Date(rule.startsAt).getTime() > at.getTime()) return false;
  if (rule.endsAt && new Date(rule.endsAt).getTime() <= at.getTime()) return false;
  return rule.weekdays.includes(businessWeekday(hours, at));
}

/** A conta completa de um pedido do site, com todas as promoções. */
export function applyPromotions(input: PromotionInput): PromotionResult {
  const subtotal = input.lines.reduce((s, l) => s + l.unitPriceCents * l.qty, 0);

  // 1. Promo 2x1 — pela loja, ou libertada por um cupão do tipo 2x1.
  const bogoOn = Boolean(input.bogo?.live) || input.coupon?.type === 'bogo';
  const units: PromoUnit[] = [];
  if (bogoOn) {
    for (const l of input.lines) {
      if (!l.bogoEligible || l.isGift || l.unitPriceCents <= 0) continue;
      for (let i = 0; i < l.qty; i += 1) units.push({ itemId: l.itemId, name: l.name, priceCents: l.unitPriceCents });
    }
  }
  const free = bogoOn ? pickFreeUnit(units, { sameItemOnly: input.bogo?.sameItemOnly ?? true }) : null;
  const bogoDiscount = free?.priceCents ?? 0;

  // 2. Cupão — sobre o que sobra depois do 2x1.
  const base = Math.max(0, subtotal - bogoDiscount);
  let coupon = 0;
  if (input.coupon?.type === 'discount_pct') coupon = Math.floor((base * input.coupon.value) / 100);
  else if (input.coupon?.type === 'discount_cents') coupon = Math.min(input.coupon.value, base);
  else if (input.coupon?.type === 'free_item' && input.coupon.giftItemId) {
    // Uma unidade, a mais cara desse produto no carrinho.
    const precos = input.lines
      .filter((l) => l.itemId === input.coupon?.giftItemId && !l.isGift && l.unitPriceCents > 0)
      .map((l) => l.unitPriceCents);
    coupon = Math.min(precos.length ? Math.max(...precos) : 0, base);
  }

  // 3. Desconto manual (balcão, gerente/dono) — sobre o que ainda falta.
  const base2 = base - coupon;
  let manual = 0;
  if (input.manual?.type === 'pct') manual = Math.floor((base2 * input.manual.value) / 100);
  else if (input.manual?.type === 'cents') manual = Math.min(input.manual.value, base2);
  const discount = bogoDiscount + coupon + manual;

  // 4. Entrega grátis — contada sobre o que se paga pelos produtos.
  const produtos = subtotal - discount;
  const minimo = input.freeDeliveryMinCents ?? 0;
  const zona = input.fulfillment === 'delivery' ? input.deliveryFeeCents : 0;
  const entregaGratis = input.fulfillment === 'delivery' && minimo > 0 && zona > 0 && produtos >= minimo;
  const fee = entregaGratis ? 0 : zona;

  return {
    subtotalCents: subtotal,
    bogoDiscountCents: bogoDiscount,
    bogoFreeItem: free?.name ?? null,
    couponDiscountCents: coupon,
    manualDiscountCents: manual,
    discountCents: discount,
    deliveryFeeCents: fee,
    deliveryDiscountCents: entregaGratis ? zona : 0,
    totalCents: Math.max(0, produtos + fee),
    bogoOneAway: bogoOn && bogoDiscount === 0 && units.length >= 1,
    missingForFreeDeliveryCents:
      input.fulfillment === 'delivery' && minimo > 0 && !entregaGratis ? Math.max(0, minimo - produtos) : 0,
  };
}
