import { describe, expect, it, vi } from "vitest";
import { buildAiMenu, createAiInterpreter, toIntent } from "../ai";
import { freshState } from "../state";
import { context, ID } from "./fixtures";

describe("cardápio para a IA", () => {
  it("ids curtos, sem esgotados, com versões, grupos e adicionais", () => {
    const { text, aliases } = buildAiMenu(context().menu);
    expect(text).toContain("## Hambúrgueres [C1]");
    expect(text).toContain("- Smash [P1]");
    expect(text).toMatch(/Grande \[V2\]/);
    expect(text).toMatch(/Grupo "Ponto" \[G1\] \(escolher 1, obrigatório\)/);
    expect(text).toMatch(/Bacon \[A1\]/);
    expect(text).not.toContain("Esgotado");
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/); // nenhum UUID no prompt
    expect(aliases.get("P1")).toBe(ID.smash);
    expect(aliases.get("P2")).toBe(ID.soda);
  });

  it("intenção: ids curtos voltam a UUID; desconhecidos e de outro tipo caem fora", () => {
    const { aliases } = buildAiMenu(context().menu);
    const intent = toIntent({
      reply: " Já está! ", action: "add_items", categoryId: "C2",
      items: [
        { product: "p1", qty: 2, version: "V2", addons: ["A1", "A9", "P2"], groups: [{ group: "G1", options: ["O2", "O99"] }] },
        { product: "P77", qty: 1, version: null, addons: [], groups: [] },
        { product: "P2", qty: 500, version: "A1", addons: [], groups: [] },
      ],
    }, aliases);
    expect(intent).toEqual({
      reply: "Já está!", action: "add_items", categoryId: ID.catDrink,
      items: [
        { menuItemId: ID.smash, qty: 2, variantId: ID.grande, addonIds: [ID.bacon], modifiers: [{ groupId: ID.ponto, optionIds: [ID.malPassado] }] },
        { menuItemId: ID.soda, qty: 20 },
      ],
    });
  });
});

describe("chamada à IA", () => {
  const ctx = context({ ai: true });
  const parsed = { reply: "Ok", action: "add_items", items: [{ product: "P2", qty: 1, version: null, addons: [], groups: [] }], categoryId: null };

  it("cardápio em cache no system, recusa com fallback do servidor, esforço baixo", async () => {
    const parse = vi.fn(async () => ({ stop_reason: "end_turn", parsed_output: parsed }));
    const interpret = createAiInterpreter({ apiKey: "k", client: { beta: { messages: { parse } } } as never });
    const intent = await interpret({ text: "um refresco", state: freshState(), ctx });
    expect(intent).toMatchObject({ action: "add_items", items: [{ menuItemId: ID.soda, qty: 1 }] });
    const [req] = parse.mock.calls[0] as unknown as [Record<string, any>];
    expect(req.model).toBe("claude-opus-5-5");
    expect(req.fallbacks).toBe("default");
    expect(req.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(req.output_config.effort).toBe("low");
    expect(req.system[1].cache_control).toEqual({ type: "ephemeral" });
    expect(req.system[1].text).toContain("CARDÁPIO");
    // O que muda a cada mensagem vai depois do prefixo em cache.
    expect(req.messages[0].content).toContain("um refresco");
    expect(JSON.stringify(req.system)).not.toContain("um refresco");
  });

  it("recusa, resposta truncada ou erro da API → null (a conversa segue pelos botões)", async () => {
    for (const result of [
      { stop_reason: "refusal", parsed_output: parsed },
      { stop_reason: "max_tokens", parsed_output: null },
    ]) {
      const interpret = createAiInterpreter({ apiKey: "k", client: { beta: { messages: { parse: vi.fn(async () => result) } } } as never });
      expect(await interpret({ text: "x", state: freshState(), ctx })).toBeNull();
    }
    const failing = createAiInterpreter({ apiKey: "k", client: { beta: { messages: { parse: vi.fn(async () => { throw new Error("timeout"); }) } } } as never });
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await failing({ text: "x", state: freshState(), ctx })).toBeNull();
    spy.mockRestore();
  });
});
