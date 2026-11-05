import type { OutboundTemplate } from "@delivery/whatsapp";

/**
 * O ÚNICO ficheiro do WhatsApp que é do HAWSMASH (ADR 0011): evento da fila → template aprovado na Meta.
 * No Gym OS escreve-se outro com os eventos do ginásio; o resto do bloco copia-se tal e qual.
 *
 * Os textos aprovados vivem na Meta, não aqui. Cada template recebe exactamente as variáveis da sua
 * lista — a Meta recusa parâmetros a mais ou a menos. Catálogo para submeter em docs/planos/whatsapp.md §3.1.
 */
export const WHATSAPP_LANGUAGE = "pt_PT";

type Spec = {
  template: string;
  vars: readonly string[];
  /** Botão de URL dinâmico: o template termina em `/order-status/{{1}}` e aqui vai o id do pedido. */
  orderStatusButton?: boolean;
  /** Respostas rápidas do template: o payload volta no webhook e a conversa reage (fb:up / fb:down). */
  quickReplies?: readonly string[];
  /** Variáveis com texto corrido: até 200 caracteres em vez de 60. */
  longVars?: readonly string[];
};

const EVENTS: Record<string, Spec> = {
  "order.paid": { template: "hs_pedido_pago", vars: ["nome", "pedido", "loja"], orderStatusButton: true },
  "order.payment_failed": { template: "hs_pagamento_recusado", vars: ["nome", "pedido"], orderStatusButton: true },
  "order.scheduled_reminder": { template: "hs_pedido_lembrete", vars: ["nome", "pedido", "hora"], orderStatusButton: true },
  "order.ready": { template: "hs_pedido_pronto", vars: ["nome", "pedido", "loja"] },
  "order.on_the_way": { template: "hs_pedido_a_caminho", vars: ["nome", "pedido"], orderStatusButton: true },
  "order.delivered": { template: "hs_pedido_entregue", vars: ["nome", "loja"], quickReplies: ["fb:up", "fb:down"] },
  "order.cancelled": { template: "hs_pedido_cancelado", vars: ["nome", "pedido"] },
  // F4 — para o dono e o gerente. A mensagem do alerta é mais comprida do que um nome.
  "alert.system": { template: "hs_alerta_loja", vars: ["loja", "alerta", "detalhe"], longVars: ["detalhe"] },
  "digest.daily": { template: "hs_resumo_diario", vars: ["dia", "loja", "pedidos", "total"] },
};

export const WHATSAPP_EVENTS = Object.keys(EVENTS);

/** A Meta recusa parâmetros com quebras de linha, tabulações ou 4+ espaços seguidos. */
function param(value: unknown, max = 60): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").trim();
  return text ? text.slice(0, max) : null;
}

export type RenderedTemplate = Pick<OutboundTemplate, "template" | "language" | "variables" | "components">;

/** `null` = evento sem template ou dados em falta: a linha falha sem tentar de novo. */
export function renderWhatsAppEvent(event: string, vars: Record<string, unknown>): RenderedTemplate | null {
  const spec = EVENTS[event];
  if (!spec) return null;
  const variables: Record<string, string> = {};
  for (const key of spec.vars) {
    const value = param(vars[key], spec.longVars?.includes(key) ? 200 : 60);
    if (!value) return null;
    variables[key] = value;
  }
  const rendered: RenderedTemplate = { template: spec.template, language: WHATSAPP_LANGUAGE, variables };
  if (spec.orderStatusButton) {
    const orderId = typeof vars.order_id === "string" ? vars.order_id : "";
    if (!/^[0-9a-f-]{36}$/i.test(orderId)) return null;
    rendered.components = [
      { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: orderId }] },
    ];
  }
  if (spec.quickReplies?.length) {
    rendered.components = spec.quickReplies.map((payload, index) => ({
      type: "button", sub_type: "quick_reply", index: String(index), parameters: [{ type: "payload", payload }],
    }));
  }
  return rendered;
}
