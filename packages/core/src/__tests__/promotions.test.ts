import { describe, it, expect } from 'vitest';
import {
  applyPromotions,
  businessWeekday,
  isPromotionLive,
  pickFreeUnit,
  type PromoLine,
  type PromoUnit,
  type WeeklyWindow,
} from '../promotions';

/**
 * Espelho do `private.apply_order_promotions` (migration 1113). O servidor é a
 * verdade; estes testes garantem que a pré-visualização do checkout diz o mesmo
 * que o papel e o M-Pesa vão dizer.
 */

const unit = (itemId: string, priceCents: number, name = itemId): PromoUnit => ({ itemId, name, priceCents });

const line = (itemId: string, unitPriceCents: number, qty = 1, extra: Partial<PromoLine> = {}): PromoLine => ({
  itemId,
  name: itemId,
  unitPriceCents,
  qty,
  bogoEligible: true,
  ...extra,
});

describe('pickFreeUnit — mesmo produto (regra por omissão)', () => {
  const same = { sameItemOnly: true };

  it('dois do mesmo produto dão promo', () => {
    expect(pickFreeUnit([unit('classic', 45000), unit('classic', 45000)], same)).toEqual(unit('classic', 45000));
  });

  it('dois produtos diferentes não formam par', () => {
    expect(pickFreeUnit([unit('classic', 45000), unit('bacon', 52000)], same)).toBeNull();
  });

  it('mesmo produto em tamanhos diferentes: sai grátis o mais barato', () => {
    const free = pickFreeUnit([unit('classic', 60000, 'Classic duplo'), unit('classic', 45000, 'Classic')], same);
    expect(free?.priceCents).toBe(45000);
  });

  it('três iguais: continua a sair só UMA grátis, a segunda mais cara', () => {
    const free = pickFreeUnit([unit('a', 60000), unit('a', 50000), unit('a', 45000)], same);
    expect(free?.priceCents).toBe(50000);
  });

  it('com dois pares, ganha o que dá mais desconto ao cliente', () => {
    const free = pickFreeUnit(
      [unit('classic', 45000), unit('classic', 45000), unit('bacon', 52000), unit('bacon', 52000)],
      same,
    );
    expect(free?.itemId).toBe('bacon');
  });

  it('um par e uma órfã mais cara: a órfã não conta', () => {
    const free = pickFreeUnit([unit('classic', 45000), unit('classic', 45000), unit('combo', 90000)], same);
    expect(free?.itemId).toBe('classic');
  });

  it('um só, ou nenhum, não dá promo', () => {
    expect(pickFreeUnit([unit('a', 45000)], same)).toBeNull();
    expect(pickFreeUnit([], same)).toBeNull();
  });

  it('a ordem no carrinho não muda nada', () => {
    const a = pickFreeUnit([unit('a', 45000), unit('a', 60000)], same);
    const b = pickFreeUnit([unit('a', 60000), unit('a', 45000)], same);
    expect(a).toEqual(b);
  });

  it('não altera o array recebido', () => {
    const units = [unit('a', 60000), unit('a', 45000)];
    const copia = [...units];
    pickFreeUnit(units, same);
    expect(units).toEqual(copia);
  });
});

describe('pickFreeUnit — quaisquer dois elegíveis', () => {
  const any = { sameItemOnly: false };

  it('dois produtos diferentes formam par; paga-se o mais caro', () => {
    const free = pickFreeUnit([unit('bacon', 52000), unit('classic', 45000)], any);
    expect(free).toEqual(unit('classic', 45000));
  });

  it('com quatro, sai grátis o segundo mais caro — nunca vale mais que o pago', () => {
    const free = pickFreeUnit([unit('a', 30000), unit('b', 60000), unit('c', 50000), unit('d', 40000)], any);
    expect(free?.priceCents).toBe(50000);
  });

  it('empate de preço: desempata pelo nome, para o papel e o ecrã dizerem o mesmo', () => {
    const free = pickFreeUnit([unit('z', 45000, 'Zeta'), unit('a', 45000, 'Alfa'), unit('m', 45000, 'Meio')], any);
    expect(free?.name).toBe('Meio');
  });
});

describe('businessWeekday — o dia do turno, não o do calendário', () => {
  // 2026-09-27 é domingo. Maputo = UTC+2 todo o ano.
  const maputo = (day: number, hour: number, minute = 0) =>
    new Date(Date.UTC(2026, 8, 27 + day, hour - 2, minute, 0));

  const semVirar: WeeklyWindow[] = [0, 1, 2, 3, 4, 5, 6].map((dow) => ({ dow, opens: '11:00', closes: '21:30', active: true }));

  it('usa o fuso de Maputo, não o do browser', () => {
    // Terça 00:30 em Maputo = segunda 22:30 UTC.
    expect(businessWeekday(semVirar, maputo(2, 0, 30))).toBe(2);
  });

  it('sem janela a virar a noite, a madrugada é o dia do calendário', () => {
    expect(businessWeekday(semVirar, maputo(6, 2))).toBe(6);
  });

  it('se a sexta vira a noite, as 02:00 de sábado ainda são sexta', () => {
    const sexta: WeeklyWindow[] = [...semVirar.filter((h) => h.dow !== 5), { dow: 5, opens: '12:00', closes: '03:00', active: true }];
    expect(businessWeekday(sexta, maputo(6, 2))).toBe(5);
    expect(businessWeekday(sexta, maputo(6, 4))).toBe(6); // depois do fecho, já é sábado
  });

  it('janela inactiva não arrasta a madrugada para o dia anterior', () => {
    const sexta: WeeklyWindow[] = [{ dow: 5, opens: '12:00', closes: '03:00', active: false }];
    expect(businessWeekday(sexta, maputo(6, 2))).toBe(6);
  });

  it('sem horário nenhum, vale o calendário', () => {
    expect(businessWeekday(null, maputo(3, 15))).toBe(3);
  });
});

describe('isPromotionLive', () => {
  const at = new Date(Date.UTC(2026, 8, 29, 13, 0, 0)); // terça 15:00 Maputo
  const base = { active: true, weekdays: [2], startsAt: null, endsAt: null };

  it('desligada é desligada, mesmo no dia certo', () => {
    expect(isPromotionLive({ ...base, active: false }, null, at)).toBe(false);
  });

  it('só corre nos dias escolhidos', () => {
    expect(isPromotionLive(base, null, at)).toBe(true);
    expect(isPromotionLive({ ...base, weekdays: [3] }, null, at)).toBe(false);
  });

  it('sem dias marcados não corre (uma promo nunca dá dinheiro por engano)', () => {
    expect(isPromotionLive({ ...base, weekdays: [] }, null, at)).toBe(false);
  });

  it('respeita o início e o fim (fim exclusivo)', () => {
    expect(isPromotionLive({ ...base, startsAt: '2026-09-30T00:00:00Z' }, null, at)).toBe(false);
    expect(isPromotionLive({ ...base, endsAt: at.toISOString() }, null, at)).toBe(false);
    expect(isPromotionLive({ ...base, startsAt: '2026-09-01T00:00:00Z', endsAt: '2026-10-01T00:00:00Z' }, null, at)).toBe(true);
  });
});

describe('applyPromotions — o total do pedido', () => {
  it('sem promoções, o total é subtotal + entrega', () => {
    const r = applyPromotions({ lines: [line('a', 45000, 2)], fulfillment: 'delivery', deliveryFeeCents: 10000 });
    expect(r).toMatchObject({ subtotalCents: 90000, discountCents: 0, deliveryFeeCents: 10000, totalCents: 100000 });
  });

  it('2x1 activo: desconta a unidade grátis e diz qual é', () => {
    const r = applyPromotions({
      lines: [line('classic', 45000, 2)],
      fulfillment: 'pickup',
      deliveryFeeCents: 0,
      bogo: { live: true, sameItemOnly: true },
    });
    expect(r.bogoDiscountCents).toBe(45000);
    expect(r.bogoFreeItem).toBe('classic');
    expect(r.discountCents).toBe(45000);
    expect(r.totalCents).toBe(45000);
  });

  it('2x1 ignora produtos não elegíveis e brindes', () => {
    const r = applyPromotions({
      lines: [
        line('classic', 45000, 1),
        line('cola', 8000, 2, { bogoEligible: false }),
        line('classic', 0, 1, { isGift: true }),
      ],
      fulfillment: 'pickup',
      deliveryFeeCents: 0,
      bogo: { live: true, sameItemOnly: true },
    });
    expect(r.bogoDiscountCents).toBe(0);
    expect(r.bogoOneAway).toBe(true);
  });

  it('quem chama decide se o 2x1 corre: sem promo passada (balcão sem "também no balcão"), nada', () => {
    const r = applyPromotions({ lines: [line('classic', 45000, 2)], fulfillment: 'counter', deliveryFeeCents: 0, bogo: null });
    expect(r.bogoDiscountCents).toBe(0);
    const noBalcao = applyPromotions({
      lines: [line('classic', 45000, 2)],
      fulfillment: 'counter',
      deliveryFeeCents: 0,
      bogo: { live: true, sameItemOnly: true },
    });
    expect(noBalcao.bogoDiscountCents).toBe(45000);
  });

  it('cupão do tipo 2x1 liberta a promo mesmo com ela desligada', () => {
    const r = applyPromotions({
      lines: [line('classic', 45000, 2)],
      fulfillment: 'pickup',
      deliveryFeeCents: 0,
      coupon: { type: 'bogo', value: 0 },
    });
    expect(r.bogoDiscountCents).toBe(45000);
    expect(r.couponDiscountCents).toBe(0);
  });

  it('cupão em % é calculado DEPOIS do 2x1 — não dá desconto sobre o que já saiu grátis', () => {
    const r = applyPromotions({
      lines: [line('classic', 45000, 2), line('batata', 15000, 1, { bogoEligible: false })],
      fulfillment: 'pickup',
      deliveryFeeCents: 0,
      coupon: { type: 'discount_pct', value: 10 },
      bogo: { live: true, sameItemOnly: true },
    });
    // subtotal 105000; 2x1 −45000 → 60000; 10% → 6000
    expect(r.couponDiscountCents).toBe(6000);
    expect(r.discountCents).toBe(51000);
    expect(r.totalCents).toBe(54000);
  });

  it('cupão em % arredonda para baixo, ao centavo (como o servidor)', () => {
    const r = applyPromotions({
      lines: [line('a', 33333, 1)],
      fulfillment: 'pickup',
      deliveryFeeCents: 0,
      coupon: { type: 'discount_pct', value: 10 },
    });
    expect(r.couponDiscountCents).toBe(3333);
  });

  it('cupão de valor nunca passa o que se paga pelos produtos', () => {
    const r = applyPromotions({
      lines: [line('a', 20000, 1)],
      fulfillment: 'delivery',
      deliveryFeeCents: 10000,
      coupon: { type: 'discount_cents', value: 50000 },
    });
    expect(r.couponDiscountCents).toBe(20000);
    expect(r.totalCents).toBe(10000); // a entrega continua a pagar-se
  });

  it('cupão de brinde não mexe no total (o brinde já entra a 0)', () => {
    const r = applyPromotions({
      lines: [line('a', 45000, 1), line('gift', 0, 1, { isGift: true })],
      fulfillment: 'pickup',
      deliveryFeeCents: 0,
      coupon: { type: 'free_item', value: 0 },
    });
    expect(r.discountCents).toBe(0);
    expect(r.totalCents).toBe(45000);
  });

  it('cupão de produto grátis no balcão: o produto está no carrinho a preço cheio e sai uma unidade', () => {
    const r = applyPromotions({
      lines: [line('batata', 15000, 2, { bogoEligible: false }), line('classic', 45000, 1)],
      fulfillment: 'counter',
      deliveryFeeCents: 0,
      coupon: { type: 'free_item', value: 0, giftItemId: 'batata' },
    });
    expect(r.couponDiscountCents).toBe(15000);
    expect(r.totalCents).toBe(60000); // 2 batatas + 1 classic − 1 batata
  });

  it('cupão de produto grátis sem o produto no carrinho não dá nada', () => {
    const r = applyPromotions({
      lines: [line('classic', 45000, 1)],
      fulfillment: 'counter',
      deliveryFeeCents: 0,
      coupon: { type: 'free_item', value: 0, giftItemId: 'batata' },
    });
    expect(r.couponDiscountCents).toBe(0);
  });

  it('desconto manual do gerente conta depois do 2x1 e do cupão', () => {
    const r = applyPromotions({
      lines: [line('classic', 45000, 2), line('batata', 15000, 1, { bogoEligible: false })],
      fulfillment: 'counter',
      deliveryFeeCents: 0,
      bogo: { live: true, sameItemOnly: true },
      coupon: { type: 'discount_cents', value: 5000 },
      manual: { type: 'pct', value: 10 },
    });
    // 105000 − 45000 (2x1) − 5000 (cupão) = 55000; 10% → 5500
    expect(r.manualDiscountCents).toBe(5500);
    expect(r.discountCents).toBe(55500);
    expect(r.totalCents).toBe(49500);
  });

  it('desconto manual em MT nunca passa o que falta pagar', () => {
    const r = applyPromotions({
      lines: [line('a', 20000, 1)],
      fulfillment: 'counter',
      deliveryFeeCents: 0,
      manual: { type: 'cents', value: 99999 },
    });
    expect(r.manualDiscountCents).toBe(20000);
    expect(r.totalCents).toBe(0);
  });

  it('entrega grátis a partir do mínimo, contado DEPOIS dos descontos', () => {
    const lines = [line('classic', 45000, 2)];
    const semPromo = applyPromotions({ lines, fulfillment: 'delivery', deliveryFeeCents: 10000, freeDeliveryMinCents: 80000 });
    expect(semPromo.deliveryFeeCents).toBe(0);
    expect(semPromo.deliveryDiscountCents).toBe(10000);
    expect(semPromo.totalCents).toBe(90000);

    // Com o 2x1 o cliente paga 45000 pelos produtos — já não chega aos 80000.
    const comPromo = applyPromotions({
      lines,
      fulfillment: 'delivery',
      deliveryFeeCents: 10000,
      freeDeliveryMinCents: 80000,
      bogo: { live: true, sameItemOnly: true },
    });
    expect(comPromo.deliveryFeeCents).toBe(10000);
    expect(comPromo.missingForFreeDeliveryCents).toBe(35000);
    expect(comPromo.totalCents).toBe(55000);
  });

  it('entrega grátis só existe em entregas', () => {
    const r = applyPromotions({ lines: [line('a', 90000, 1)], fulfillment: 'pickup', deliveryFeeCents: 0, freeDeliveryMinCents: 50000 });
    expect(r.deliveryDiscountCents).toBe(0);
    expect(r.missingForFreeDeliveryCents).toBe(0);
  });

  it('o total nunca é negativo e é sempre inteiro', () => {
    const r = applyPromotions({
      lines: [line('a', 45000, 2)],
      fulfillment: 'pickup',
      deliveryFeeCents: 0,
      coupon: { type: 'discount_cents', value: 999999 },
      bogo: { live: true, sameItemOnly: true },
    });
    expect(r.totalCents).toBe(0);
    expect(Number.isInteger(r.totalCents)).toBe(true);
  });
});
