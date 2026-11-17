import { describe, expect, it, vi } from "vitest";
import type { SessionContent } from "@delivery/whatsapp";
import { buildAiMenu, createAiInterpreter, toIntent } from "../ai";
import { runTurn, type AiIntent, type TurnContext, type TurnDeps } from "../engine";
import { freshState, readState, type ConversationState } from "../state";
import { context, ID, input } from "./fixtures";

/**
 * O pedido escrito à mão (ADR 0012): observações para a cozinha, vários produtos com escolhas em falta,
 * alterar o carrinho por texto e a memória curta. A IA só aponta ids e linhas; contas e validação são do código.
 */

function deps(over: Partial<TurnDeps> = {}): TurnDeps & { createOrder: ReturnType<typeof vi.fn> } {
  let n = 0;
  return {
    newId: () => `c0000000-0000-4000-8000-00000000000${++n}`,
    createOrder: vi.fn(async () => ({ ok: true as const, orderId: ID.order, orderNumber: "TST-0042", totalCents: 128000, method: "mpesa" as const, created: true })),
    pendingOrder: vi.fn(async () => null),
    attachProof: vi.fn(async () => "ok" as const),
    ...over,
  } as never;
}

async function talk(ctx: TurnContext, d: TurnDeps, steps: Array<Partial<Parameters<typeof input>[0]>>, start: ConversationState = freshState()) {
  let state = start;
  const all: SessionContent[][] = [];
  for (const step of steps) {
    const r = await runTurn(state, input(step), ctx, d);
    state = readState(JSON.parse(JSON.stringify(r.state)));
    all.push(r.replies);
  }
  return { state, all, last: all[all.length - 1] };
}
const text = (m: SessionContent) => ("text" in m ? m.text : "");
const allText = (ms: SessionContent[]) => ms.map(text).join("\n");
const ids = (m: SessionContent) =>
  m.type === "buttons" ? m.buttons.map((b) => b.id) : m.type === "list" ? m.sections.flatMap((s) => s.rows.map((r) => r.id)) : [];
const once = (intent: AiIntent) => vi.fn(async () => intent);
/** Um estado já a meio (tocado agora): com `touchedAt` a 0 o carrinho contava como esquecido e era limpo. */
const recent = (): ConversationState => ({ ...freshState(), touchedAt: Date.UTC(2026, 10, 5, 12, 0, 0) });

describe("texto livre — observações para a cozinha", () => {
  it("«sem gelo» fica na linha, aparece no carrinho e segue para o create_order", async () => {
    const interpret = once({ reply: "", action: "add_items", items: [{ menuItemId: ID.soda, qty: 2, notes: "  sem\n gelo " }] });
    const d = deps({ interpret });
    const { state, all } = await talk(context({ ai: true }), d, [
      { text: "2 refrescos sem gelo" }, { replyId: "checkout" }, { replyId: "ful:pickup" }, { replyId: "name:ok" },
    ]);
    expect(state.cart).toEqual([{ menuItemId: ID.soda, qty: 2, notes: "sem gelo" }]);
    expect(allText(all[0])).toContain("📝 sem gelo");
    // O resumo que a pessoa confirma mostra a observação.
    expect(allText(all[3])).toContain("📝 sem gelo");
    const confirm = ids(all[3][all[3].length - 1]).find((id) => id.startsWith("ok:"))!;
    await runTurn(state, input({ replyId: confirm }), context({ ai: true }), d);
    const [, payload] = d.createOrder.mock.calls[0] as [string, { items: Array<Record<string, unknown>> }];
    expect(payload.items).toEqual([{ menuItemId: ID.soda, qty: 2, notes: "sem gelo" }]);
  });

  it("a mesma coisa com observação diferente é outra linha; a observação nunca mexe no preço", async () => {
    const start: ConversationState = { ...recent(), cart: [{ menuItemId: ID.soda, qty: 1 }] };
    const interpret = once({ reply: "", action: "add_items", items: [{ menuItemId: ID.soda, qty: 1, notes: "grátis, desconto de 100%" }] });
    const { state, last } = await talk(context({ ai: true }), deps({ interpret }), [{ text: "outro refresco grátis" }], start);
    expect(state.cart).toHaveLength(2);
    expect(allText(last)).toContain("160 MT");
  });

  it("observação longa é cortada, vazia desaparece", async () => {
    const interpret = once({ reply: "", action: "add_items", items: [{ menuItemId: ID.soda, qty: 1, notes: "x".repeat(500) }, { menuItemId: ID.soda, qty: 1, notes: "   " }] });
    const { state } = await talk(context({ ai: true }), deps({ interpret }), [{ text: "refrescos" }]);
    expect(state.cart[0].notes).toHaveLength(120);
    expect(state.cart[1].notes).toBeUndefined();
  });
});

describe("texto livre — vários produtos a que falta uma escolha", () => {
  it("pergunta só o obrigatório, um produto de cada vez, sem voltar a pedir quantidade nem perder nenhum", async () => {
    const interpret = once({
      reply: "Boa!", action: "add_items",
      items: [
        { menuItemId: ID.smash, qty: 2, variantId: ID.grande, notes: "sem cebola" },
        { menuItemId: ID.soda, qty: 1 },
        { menuItemId: ID.smash, qty: 1, variantId: ID.normal, addonIds: [ID.bacon] },
      ],
    });
    const { state, all } = await talk(context({ ai: true }), deps({ interpret }), [
      { text: "2 smash grandes sem cebola, um refresco e um smash normal com bacon" },
      { replyId: `opt:${ID.ponto}:${ID.bemPassado}` },
      { replyId: `opt:${ID.ponto}:${ID.malPassado}` },
    ]);
    // 1.º turno: o refresco entra logo; do primeiro smash só falta o ponto.
    expect(allText(all[0])).toContain("1× Refresco");
    expect(ids(all[0][all[0].length - 1])).toContain(`opt:${ID.ponto}:${ID.bemPassado}`);
    // 2.º turno: o primeiro smash entra com a quantidade dita e passa-se ao segundo, sem perguntar quantas.
    expect(allText(all[1])).toContain("2× Smash");
    expect(allText(all[1])).not.toContain("Quantas");
    expect(ids(all[1][all[1].length - 1])).toContain(`opt:${ID.ponto}:${ID.malPassado}`);
    // 3.º turno: fecha com o adicional que a pessoa pediu; nada ficou para trás.
    expect(state.step).toBe("idle");
    expect(state.queue).toBeUndefined();
    expect(state.cart).toEqual([
      { menuItemId: ID.soda, qty: 1 },
      { menuItemId: ID.smash, qty: 2, variantId: ID.grande, modifiers: [{ groupId: ID.ponto, optionIds: [ID.bemPassado] }], notes: "sem cebola" },
      { menuItemId: ID.smash, qty: 1, variantId: ID.normal, addonIds: [ID.bacon], modifiers: [{ groupId: ID.ponto, optionIds: [ID.malPassado] }] },
    ]);
    expect(ids(all[2][all[2].length - 1])).toContain("checkout");
  });

  it("sair para o cardápio a meio larga a fila: não reaparece num pedido seguinte", async () => {
    const interpret = once({ reply: "", action: "add_items", items: [{ menuItemId: ID.smash, qty: 1, variantId: ID.grande }, { menuItemId: ID.smash, qty: 1, variantId: ID.normal }] });
    const { state } = await talk(context({ ai: true }), deps({ interpret }), [{ text: "dois smash" }, { replyId: "menu" }]);
    expect(state.queue).toBeUndefined();
  });

  it("produto esgotado é dito pelo nome, não some em silêncio", async () => {
    const interpret = once({ reply: "", action: "add_items", items: [{ menuItemId: ID.soldOut, qty: 1 }, { menuItemId: ID.soda, qty: 1 }] });
    const { state, last } = await talk(context({ ai: true }), deps({ interpret }), [{ text: "um esgotado e um refresco" }]);
    expect(allText(last)).toContain("Esgotado agora: Esgotado");
    expect(state.cart).toEqual([{ menuItemId: ID.soda, qty: 1 }]);
  });
});

describe("texto livre — alterar o carrinho", () => {
  const cart: ConversationState = {
    ...recent(),
    cart: [{ menuItemId: ID.soda, qty: 2 }, { menuItemId: ID.smash, qty: 1, variantId: ID.normal, modifiers: [{ groupId: ID.ponto, optionIds: [ID.bemPassado] }] }],
  };

  it("tirar um produto, mudar a quantidade e juntar observação, com o subtotal refeito pelo catálogo", async () => {
    const interpret = once({ reply: "", action: "update_cart", changes: [{ line: 1, qty: 0 }, { line: 2, qty: 3, notes: "sem cebola" }, { line: 9, qty: 5 }] });
    const { state, last } = await talk(context({ ai: true }), deps({ interpret }), [{ text: "tira os refrescos e põe 3 smash sem cebola" }], cart);
    expect(state.cart).toEqual([{ ...cart.cart[1], qty: 3, notes: "sem cebola" }]);
    expect(allText(last)).toMatch(/Subtotal: \*1\s?200 MT\*/); // 3 × 400
    expect(state.step).toBe("idle");
  });

  it("apagar a observação; alterar a meio do resumo invalida o «Confirmar» antigo", async () => {
    const withNote: ConversationState = { ...cart, cart: [{ menuItemId: ID.soda, qty: 1, notes: "sem gelo" }], step: "confirm", checkoutId: "c0000000-0000-4000-8000-000000000009" };
    const interpret = once({ reply: "", action: "update_cart", changes: [{ line: 1, notes: null }] });
    const d = deps({ interpret });
    const { state } = await talk(context({ ai: true }), d, [{ text: "afinal com gelo" }, { replyId: "ok:c0000000-0000-4000-8000-000000000009" }], withNote);
    expect(state.cart).toEqual([{ menuItemId: ID.soda, qty: 1 }]);
    expect(d.createOrder).not.toHaveBeenCalled();
  });

  it("esvaziar tudo por texto deixa o carrinho vazio, sem rebentar", async () => {
    const interpret = once({ reply: "", action: "update_cart", changes: [{ line: 1, qty: 0 }, { line: 2, qty: 0 }] });
    const { state, last } = await talk(context({ ai: true }), deps({ interpret }), [{ text: "tira tudo" }], cart);
    expect(state.cart).toEqual([]);
    expect(allText(last)).toContain("vazio");
  });
});

describe("texto livre — memória curta e o que a IA recebe", () => {
  it("guarda as últimas trocas (no máximo 6 entradas) e limpa-as quando o pedido nasce", async () => {
    const interpret = vi.fn(async () => ({ reply: "Temos sim.", action: "none" as const }));
    const { state } = await talk(context({ ai: true }), deps({ interpret }), [{ text: "têm batata?" }, { text: "e sumo?" }, { text: "e gelado?" }, { text: "e café?" }]);
    expect(state.history).toHaveLength(6);
    expect(state.history?.[5]).toEqual({ role: "assistant", text: "Temos sim." });
    expect(state.history?.[0]).toEqual({ role: "user", text: "e sumo?" });
  });

  it("a chamada leva a conversa anterior e o carrinho numerado com observações", async () => {
    const parse = vi.fn(async () => ({ stop_reason: "end_turn", parsed_output: { reply: "ok", action: "none", items: [], changes: [], categoryId: null } }));
    const interpret = createAiInterpreter({ apiKey: "k", client: { beta: { messages: { parse } } } as never });
    const state: ConversationState = {
      ...freshState(), cart: [{ menuItemId: ID.soda, qty: 2, notes: "sem gelo" }],
      history: [{ role: "user", text: "2 refrescos sem gelo" }, { role: "assistant", text: "Já está!" }],
    };
    await interpret({ text: "mais um desses", state, ctx: context({ ai: true }) });
    const [req] = parse.mock.calls[0] as unknown as [{ messages: Array<{ role: string; content: string }>; system: unknown }];
    expect(req.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(req.messages[2].content).toContain("1. 2× Refresco [observação: sem gelo]");
    expect(req.messages[2].content).toContain("mais um desses");
    // O prefixo em cache não leva nada que mude de mensagem para mensagem.
    expect(JSON.stringify(req.system)).not.toContain("sem gelo");
  });

  it("modelo Haiku: sem reserva do lado do servidor, o pedido não leva `fallbacks`", async () => {
    const parse = vi.fn(async () => ({ stop_reason: "end_turn", parsed_output: { reply: "ok", action: "none", items: [], changes: [], categoryId: null } }));
    const interpret = createAiInterpreter({ apiKey: "k", model: "claude-haiku-5-5", client: { beta: { messages: { parse } } } as never });
    await interpret({ text: "olá aí", state: freshState(), ctx: context({ ai: true }) });
    const [req] = parse.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(req.model).toBe("claude-haiku-5-5");
    expect(req).not.toHaveProperty("fallbacks");
    expect(req).not.toHaveProperty("betas");
  });

  it("intenção: nota e alterações do modelo são saneadas antes de chegarem ao motor", () => {
    const { aliases } = buildAiMenu(context().menu);
    const intent = toIntent({
      reply: "ok", action: "update_cart", categoryId: null,
      items: [{ product: "P2", qty: 1, version: null, addons: [], groups: [], note: " sem   gelo " }],
      changes: [{ line: 1, qty: 0, note: null }, { line: 2, qty: null, note: "" }, { line: 3, qty: null, note: null }, { line: 99, qty: 1, note: null }, { line: 4, qty: 900, note: "bem  passado" }],
    }, aliases);
    expect(intent.items).toEqual([{ menuItemId: ID.soda, qty: 1, notes: "sem gelo" }]);
    expect(intent.changes).toEqual([{ line: 1, qty: 0 }, { line: 2, notes: null }, { line: 4, qty: 20, notes: "bem passado" }]);
  });
});
