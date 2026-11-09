import { describe, expect, it, vi } from "vitest";
import { fitSession, type SessionContent } from "@delivery/whatsapp";
import { AI_CALLS_PER_HOUR, runTurn, type TurnContext, type TurnDeps } from "../engine";
import { freshState, readState, type ConversationState } from "../state";
import { context, ID, input } from "./fixtures";

function deps(over: Partial<TurnDeps> = {}): TurnDeps & { createOrder: ReturnType<typeof vi.fn>; attachProof: ReturnType<typeof vi.fn> } {
  let n = 0;
  return {
    newId: () => `c0000000-0000-4000-8000-00000000000${++n}`,
    createOrder: vi.fn(async () => ({ ok: true as const, orderId: ID.order, orderNumber: "TST-0042", totalCents: 128000, method: "mpesa" as const, created: true })),
    pendingOrder: vi.fn(async () => ({ orderId: ID.order, orderNumber: "TST-0042", totalCents: 128000, method: "mpesa" })),
    attachProof: vi.fn(async () => "ok" as const),
    ...over,
  } as never;
}

/** Corre uma sequência de mensagens; devolve o estado e as respostas de cada passo. */
async function talk(ctx: TurnContext, d: TurnDeps, steps: Array<Partial<Parameters<typeof input>[0]>>, start: ConversationState = freshState()) {
  let state = start;
  const all: SessionContent[][] = [];
  for (const step of steps) {
    const r = await runTurn(state, input(step), ctx, d);
    // O estado volta a passar pelo schema, como depois de gravado na BD.
    state = readState(JSON.parse(JSON.stringify(r.state)));
    all.push(r.replies);
  }
  return { state, all, last: all[all.length - 1] };
}
const text = (m: SessionContent) => ("text" in m ? m.text : "");
const ids = (m: SessionContent) =>
  m.type === "buttons" ? m.buttons.map((b) => b.id) : m.type === "list" ? m.sections.flatMap((s) => s.rows.map((r) => r.id)) : [];

describe("conversa de pedido — boas-vindas e cardápio", () => {
  it("«olá» apresenta a loja pelo nome do perfil e já traz o cardápio no botão", async () => {
    const { last } = await talk(context(), deps(), [{ text: "Olá" }]);
    expect(last).toHaveLength(1);
    expect(text(last[0])).toContain("Olá, Ana!");
    expect(text(last[0])).toContain("PLACEHOLDER Loja");
    expect(last[0].type === "list" && last[0].button).toBe("Ver cardápio");
    expect(ids(last[0])).toEqual([`cat:${ID.catBurger}`, `cat:${ID.catDrink}`, "human"]);
  });

  it("depois de partilhar o número escondido, segue como conversa normal", async () => {
    const { last } = await talk(context(), deps(), [{ replyId: "contact:shared", contentType: "contacts", text: null, profileName: null }]);
    expect(text(last[0])).toContain("Obrigado!");
    expect(ids(last[0])).toContain(`cat:${ID.catBurger}`);
  });

  it("cardápio só com categorias com produtos disponíveis; esgotado não aparece", async () => {
    const { all } = await talk(context(), deps(), [{ text: "menu" }, { replyId: `cat:${ID.catBurger}` }]);
    expect(ids(all[0][0])).toEqual([`cat:${ID.catBurger}`, `cat:${ID.catDrink}`]);
    expect(ids(all[1][0])).toEqual([`item:${ID.smash}`, "menu"]);
  });

  it("todas as mensagens cabem nos limites da Meta", async () => {
    const { all } = await talk(context(), deps(), [{ text: "olá" }, { text: "menu" }, { replyId: `cat:${ID.catBurger}` }, { replyId: `item:${ID.smash}` }]);
    for (const m of all.flat()) expect(fitSession(m)).toEqual(m.type === "list" ? fitSession(m) : m);
  });
});

describe("conversa de pedido — do produto ao pedido criado", () => {
  const flow = [
    { replyId: `item:${ID.smash}` },
    { replyId: `var:${ID.grande}` },
    { replyId: `opt:${ID.ponto}:${ID.malPassado}` },
    { replyId: `add:${ID.bacon}` },
    { replyId: "addok" },
    { replyId: "qty:2" },
  ];

  it("variante → grupo obrigatório → adicionais → quantidade → carrinho com o preço do catálogo", async () => {
    const { state, all } = await talk(context(), deps(), flow);
    expect(ids(all[0][0])).toEqual([`var:${ID.normal}`, `var:${ID.grande}`]);
    // Grupo obrigatório de escolha única: sem linha "Sem ponto".
    expect(ids(all[1][0])).toEqual([`opt:${ID.ponto}:${ID.bemPassado}`, `opt:${ID.ponto}:${ID.malPassado}`]);
    expect(ids(all[3][0])).toContain("addok");
    expect(state.cart).toEqual([{ menuItemId: ID.smash, qty: 2, variantId: ID.grande, addonIds: [ID.bacon], modifiers: [{ groupId: ID.ponto, optionIds: [ID.malPassado] }] }]);
    // (500 + 10 + 50) × 2 = 1120 MT
    expect(text(all[5][0])).toMatch(/— 1[ .]?120 MT/);
    expect(ids(all[5][0])).toEqual(["menu", "checkout", "cart"]);
  });

  it("entrega: zona, morada, nome do perfil, M-Pesa único → resumo → um só pedido", async () => {
    const d = deps();
    const ctx = context();
    const { state, all } = await talk(ctx, d, [
      ...flow,
      { replyId: "checkout" },
      { replyId: "ful:delivery" },
      { replyId: `zone:${ID.zone}` },
      { text: "Bairro Central, Rua 1, nº 5, perto da escola" },
      { replyId: "name:ok" },
    ]);
    const summary = all[all.length - 1][0];
    expect(text(summary)).toContain("Resumo do pedido");
    expect(text(summary)).toMatch(/Total: 1[ .]?220 MT/); // 1120 + 100 de entrega
    expect(text(summary)).toContain("M-Pesa");
    expect(state.step).toBe("confirm");
    const confirmId = ids(summary)[0];
    expect(confirmId).toBe(`ok:${state.checkoutId}`);

    const done = await talk(ctx, d, [{ replyId: confirmId }, { replyId: confirmId }], state);
    expect(d.createOrder).toHaveBeenCalledTimes(1);
    expect(d.createOrder).toHaveBeenCalledWith(state.checkoutId, expect.objectContaining({
      customerName: "Ana Maria", fulfillmentType: "delivery", deliveryZoneId: ID.zone,
      address: "Bairro Central, Rua 1, nº 5, perto da escola", paymentMethod: "mpesa",
      items: [expect.objectContaining({ menuItemId: ID.smash, qty: 2 })],
    }));
    expect(done.all[0]).toHaveLength(1); // "registado" e os dados de pagamento numa só mensagem
    const pay = done.all[0][0];
    expect(text(pay)).toContain("TST-0042");
    expect(pay.type).toBe("cta_url");
    expect(text(pay)).toContain("84 000 0000");
    expect(text(pay)).toContain("PLACEHOLDER Titular");
    // O total é o do pedido criado (servidor), com a promoção que o servidor aplicou.
    expect(text(pay)).toMatch(/1[ .]?280 MT/);
    expect(pay.type === "cta_url" && pay.url).toBe(`https://loja.test/order-status/${ID.order}`);
    // Segundo toque no mesmo "Confirmar": repete as instruções, não cria outro pedido.
    expect(done.all[1][0].type).toBe("cta_url");
    expect(done.state.step).toBe("proof");
    expect(done.state.cart).toEqual([]);
    expect(done.state.last).toMatchObject({ zoneId: ID.zone, name: "Ana Maria" });
  });

  it("carrinho grande: o total e a morada nunca se perdem no corte dos 1.024 caracteres", async () => {
    const ctx = context();
    ctx.menu.categories[0].items[0].name = "Smash de nome muito comprido para encher a linha do resumo do pedido";
    // Oito combinações diferentes do mesmo produto: oito linhas no carrinho.
    const cart = [ID.normal, ID.grande].flatMap((variantId) => [ID.bemPassado, ID.malPassado].flatMap((option) => [[], [ID.bacon]].map((addonIds) => ({
      menuItemId: ID.smash, qty: 1, variantId, addonIds, modifiers: [{ groupId: ID.ponto, optionIds: [option] }],
    }))));
    const address = "Bairro Central, Rua 1, nº 5, perto da escola";
    const r = await runTurn(
      { ...freshState(), cart, step: "name", fulfillment: "delivery", zoneId: ID.zone, address, name: "Ana", paymentMethod: "mpesa", touchedAt: input({}).now },
      input({ replyId: "checkout" }), ctx, deps(),
    );
    expect(r.replies).toHaveLength(2);
    expect(r.replies[0].type).toBe("text");
    expect(Array.from(text(r.replies[0])).length).toBeGreaterThan(1024);
    expect(text(r.replies[0])).toContain("Total:");
    expect(text(r.replies[0])).toContain(address);
    // Os botões seguem à parte, com o total à vista e o id deste resumo.
    expect(text(r.replies[1])).toMatch(/Confirmas o pedido de \*.+ MT\*/);
    expect(ids(r.replies[1])[0]).toBe(`ok:${r.state.checkoutId}`);
  });

  it("um pedido típico (variante, grupo, adicional, entrega) cabe em 15 mensagens pagas", async () => {
    const d = deps();
    const ctx = context();
    const { state, all } = await talk(ctx, d, [
      { text: "olá" }, { replyId: `cat:${ID.catBurger}` }, ...flow,
      { replyId: "checkout" }, { replyId: "ful:delivery" }, { replyId: `zone:${ID.zone}` },
      { text: "Bairro Central, Rua 1, nº 5" }, { replyId: "name:ok" },
    ]);
    const done = await talk(ctx, d, [
      { replyId: `ok:${state.checkoutId}` },
      { contentType: "image", media: { id: "m1", mimeType: "image/jpeg", caption: null } },
    ], state);
    const total = [...all, ...done.all].reduce((n, turn) => n + turn.length, 0);
    expect(total).toBeLessThanOrEqual(15);
  });

  it("«Confirmar» de um resumo antigo mostra o resumo actual em vez de criar", async () => {
    const d = deps();
    const ctx = context();
    const { state } = await talk(ctx, d, [...flow, { replyId: "checkout" }, { replyId: "ful:pickup" }, { replyId: "name:ok" }]);
    const r = await runTurn(state, input({ replyId: "ok:c0000000-0000-4000-8000-000000000999" }), ctx, d);
    expect(d.createOrder).not.toHaveBeenCalled();
    expect(text(r.replies[0])).toContain("Resumo do pedido");
  });

  it("dois meios de pagamento → pergunta; levantamento não pede morada", async () => {
    const { all, state } = await talk(context({ emola: true }), deps(), [...flow, { replyId: "checkout" }, { replyId: "ful:pickup" }, { replyId: "name:ok" }]);
    expect(ids(all[all.length - 1][0])).toEqual(["pay:mpesa", "pay:emola"]);
    expect(state.address).toBeUndefined();
  });

  it("loja fechada: não cria pedido, manda para o site com o carrinho preparado", async () => {
    const d = deps();
    const ctx = context({ open: false });
    const { state, last } = await talk(ctx, d, [...flow, { replyId: "checkout" }, { replyId: "ful:pickup" }, { replyId: "name:ok" }]);
    expect(text(last[0])).toContain("fechados");
    const { last: afterConfirm } = await talk(ctx, d, [{ replyId: `ok:${state.checkoutId}` }], state);
    expect(d.createOrder).not.toHaveBeenCalled();
    expect(afterConfirm[0].type).toBe("cta_url");
    expect(afterConfirm[0].type === "cta_url" && afterConfirm[0].url).toMatch(/^https:\/\/loja\.test\/pedido-assistido#cart=/);
  });

  it("pagamento automático na loja: a conversa não cobra, manda para o site", async () => {
    const { last } = await talk(context({ provider: "paysuite" }), deps(), [...flow, { replyId: "checkout" }, { replyId: "ful:pickup" }, { replyId: "name:ok" }]);
    expect(last[0].type).toBe("cta_url");
  });

  it("produto esgotou entre o resumo e o «Confirmar» → volta ao carrinho", async () => {
    const d = deps({ createOrder: vi.fn(async () => ({ ok: false as const, code: "out_of_stock:abc" })) });
    const ctx = context();
    const { state } = await talk(ctx, d, [...flow, { replyId: "checkout" }, { replyId: "ful:pickup" }, { replyId: "name:ok" }]);
    const r = await runTurn(state, input({ replyId: `ok:${state.checkoutId}` }), ctx, d);
    expect(text(r.replies[0])).toContain("esgotou");
    expect(r.state.step).not.toBe("proof");
  });
});

describe("conversa de pedido — comprovativo", () => {
  const proofState = (): ConversationState => ({
    ...freshState(), step: "proof", touchedAt: input({}).now,
    order: { id: ID.order, number: "TST-0042", totalCents: 128000, method: "mpesa", at: 0 },
  });

  it("foto com pedido à espera → anexada ao pedido, conversa volta ao início", async () => {
    const d = deps();
    const r = await runTurn(proofState(), input({ contentType: "image", media: { id: "m1", mimeType: "image/jpeg", caption: null } }), context(), d);
    expect(d.attachProof).toHaveBeenCalledWith(ID.order, { id: "m1", mimeType: "image/jpeg", caption: null });
    expect(text(r.replies[0])).toContain("Comprovativo recebido");
    expect(r.state.step).toBe("idle");
  });

  it("serve também o pedido feito no site com o mesmo telefone", async () => {
    const d = deps();
    const r = await runTurn(freshState(), input({ contentType: "document", media: { id: "m2", mimeType: "application/pdf", caption: null } }), context(), d);
    expect(d.attachProof).toHaveBeenCalledTimes(1);
    expect(text(r.replies[0])).toContain("TST-0042");
  });

  it("sem pedido à espera não anexa nada", async () => {
    const d = deps({ pendingOrder: vi.fn(async () => null) });
    const r = await runTurn(freshState(), input({ contentType: "image", media: { id: "m3", mimeType: "image/png", caption: null } }), context(), d);
    expect(d.attachProof).not.toHaveBeenCalled();
    expect(text(r.replies[0])).toContain("não encontrei nenhum pedido");
  });

  it("«já paguei» sem foto pede a foto; texto qualquer relembra os dados de pagamento", async () => {
    const r1 = await runTurn(proofState(), input({ text: "Já paguei" }), context(), deps());
    expect(text(r1.replies[0])).toContain("foto ou print");
    const r2 = await runTurn(proofState(), input({ text: "olá" }), context(), deps());
    expect(r2.replies.some((m) => text(m).includes("84 000 0000"))).toBe(true);
  });
});

describe("conversa de pedido — IA e limites", () => {
  it("texto livre: a IA propõe, o código valida e calcula", async () => {
    const interpret = vi.fn(async () => ({
      reply: "Boa escolha!", action: "add_items" as const,
      items: [{ menuItemId: ID.soda, qty: 2 }, { menuItemId: "99999999-0000-4000-8000-000000000000", qty: 1 }],
    }));
    const { state, last } = await talk(context({ ai: true }), deps({ interpret }), [{ text: "quero 2 refrescos e um unicórnio" }]);
    expect(state.cart).toEqual([{ menuItemId: ID.soda, qty: 2 }]);
    // A frase da IA e o resumo do sistema vão na mesma mensagem.
    expect(last).toHaveLength(1);
    expect(text(last[0])).toMatch(/^Boa escolha!/);
    expect(text(last[0])).toMatch(/2× Refresco — 160 MT/);
  });

  it("IA sem a escolha obrigatória → segue pelos botões desse produto", async () => {
    const interpret = vi.fn(async () => ({ reply: "", action: "add_items" as const, items: [{ menuItemId: ID.smash, qty: 1, variantId: ID.grande }] }));
    const { state, last } = await talk(context({ ai: true }), deps({ interpret }), [{ text: "um smash grande" }]);
    expect(state.step).toBe("item");
    expect(state.draft).toMatchObject({ menuItemId: ID.smash, variantId: ID.grande });
    expect(ids(last[0])).toContain(`opt:${ID.ponto}:${ID.bemPassado}`);
  });

  it(`no máximo ${AI_CALLS_PER_HOUR} chamadas à IA por hora; depois, botões`, async () => {
    const interpret = vi.fn(async () => ({ reply: "ok", action: "none" as const }));
    const ctx = context({ ai: true });
    const d = deps({ interpret });
    let state = freshState();
    for (let i = 0; i < AI_CALLS_PER_HOUR + 3; i++) state = (await runTurn(state, input({ text: `pergunta ${i}` }), ctx, d)).state;
    expect(interpret).toHaveBeenCalledTimes(AI_CALLS_PER_HOUR);
  });

  it("IA em baixo cai nos botões", async () => {
    const interpret = vi.fn(async () => { throw new Error("timeout"); });
    const { last } = await talk(context({ ai: true }), deps({ interpret }), [{ text: "quero comer algo" }]);
    expect(text(last[0])).toContain("Não percebi");
  });

  it("«correu mal»: a mensagem seguinte é para a loja, sem IA nem menu", async () => {
    const interpret = vi.fn(async () => ({ reply: "x", action: "none" as const }));
    const { state, last } = await talk(context({ ai: true }), deps({ interpret }), [{ replyId: "fb:down" }, { text: "o hambúrguer veio frio" }]);
    expect(interpret).not.toHaveBeenCalled();
    expect(text(last[0])).toContain("A loja vai ler");
    expect(state.step).toBe("idle");
  });

  it("SAIR confirma; reacção não responde; carrinho esquecido há 7 h recomeça", async () => {
    expect(text((await runTurn(freshState(), input({ text: "SAIR", optOut: true }), context(), deps())).replies[0])).toContain("Não te enviamos mais avisos");
    expect((await runTurn(freshState(), input({ contentType: "reaction" }), context(), deps())).replies).toEqual([]);
    const now = input({}).now;
    const old: ConversationState = { ...freshState(), cart: [{ menuItemId: ID.soda, qty: 1 }], touchedAt: now - 7 * 3_600_000 };
    expect((await runTurn(old, input({ text: "carrinho", now }), context(), deps())).state.cart).toEqual([]);
  });
});
