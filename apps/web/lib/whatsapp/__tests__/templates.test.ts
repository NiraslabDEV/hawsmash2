import { describe, expect, it } from "vitest";
import { renderWhatsAppEvent, WHATSAPP_EVENTS } from "../events";
import { metaTemplatePayload, TEMPLATES, templateVariables } from "../templates";

const ORDER_ID = "0a1b2c3d-0000-4000-8000-000000000042";
const vars = { nome: "Ana", pedido: "MPT-0042", loja: "Loja", hora: "19:30", order_id: ORDER_ID };

describe("catálogo de templates ↔ envio", () => {
  it("cada evento enviado tem template no catálogo, com exactamente as mesmas variáveis", () => {
    for (const event of WHATSAPP_EVENTS) {
      const rendered = renderWhatsAppEvent(event, vars)!;
      const spec = TEMPLATES.find((t) => t.name === rendered.template);
      expect(spec, rendered.template).toBeDefined();
      expect(templateVariables(spec!.body).sort()).toEqual(Object.keys(rendered.variables ?? {}).sort());
      // Botão de URL no envio ⇔ botão "Acompanhar" no template; respostas rápidas ⇔ quick replies.
      const sendsUrl = rendered.components?.some((c) => c.sub_type === "url") ?? false;
      expect(spec!.buttons?.some((b) => b.type === "order_status") ?? false, rendered.template).toBe(sendsUrl);
      const payloads = rendered.components?.filter((c) => c.sub_type === "quick_reply").map((c) => (c.parameters as Array<{ payload: string }>)[0].payload) ?? [];
      expect(spec!.buttons?.flatMap((b) => (b.type === "quick_reply" ? [b.payload] : [])) ?? []).toEqual(payloads);
    }
  });

  it("nenhum template sem uso, nenhum exemplo em falta, sem marca no texto", () => {
    const used = new Set(WHATSAPP_EVENTS.map((e) => renderWhatsAppEvent(e, vars)!.template));
    for (const spec of TEMPLATES) {
      expect(used.has(spec.name), spec.name).toBe(true);
      for (const v of templateVariables(spec.body)) expect(spec.examples[v], `${spec.name}.${v}`).toBeTruthy();
      expect(spec.body).not.toMatch(/hawsmash/i);
    }
  });

  it("corpo para a Meta: parâmetros com nome, botão de URL com sufixo dinâmico", () => {
    const payload = metaTemplatePayload(TEMPLATES[0], "https://loja.test/");
    expect(payload).toMatchObject({ name: "hs_pedido_pago", language: "pt_PT", category: "UTILITY", parameter_format: "NAMED" });
    expect(JSON.stringify(payload)).toContain('"url":"https://loja.test/order-status/{{1}}"');
    expect(JSON.stringify(payload)).toContain('{"param_name":"nome","example":"Ana"}');
  });
});
