/**
 * Catálogo dos templates a submeter na Meta (plano §3.1) — a mesma lista que `events.ts` usa para enviar.
 * Um teste garante que cada template tem exactamente as variáveis que o envio manda; mudar um texto aqui
 * obriga a submetê-lo outra vez (`npx tsx scripts/whatsapp-templates.ts`).
 *
 * Utility, pt_PT, parâmetros com nome. Os textos não levam o nome da marca: a loja entra por {{loja}}.
 * A Meta recusa corpos que comecem ou acabem numa variável e os que tenham variáveis a mais para o texto.
 */

export type TemplateButton =
  | { type: "order_status"; text: string }
  | { type: "quick_reply"; text: string; payload: string };

export interface TemplateSpec {
  name: string;
  body: string;
  /** Exemplo de cada variável, pela ordem em que aparecem — a Meta exige um por parâmetro. */
  examples: Record<string, string>;
  buttons?: TemplateButton[];
}

export const TEMPLATE_LANGUAGE = "pt_PT";
export const TEMPLATE_CATEGORY = "UTILITY";

const EX = {
  nome: "Ana", pedido: "MPT-0042", loja: "Loja Centro", hora: "19:30",
  alerta: "Impressão falhada", detalhe: "A impressora da cozinha não responde há 5 minutos",
  dia: "05/11/2026", pedidos: "42", total: "28 450 MT",
};
const pick = (...keys: Array<keyof typeof EX>) => Object.fromEntries(keys.map((k) => [k, EX[k]]));
const ACOMPANHAR: TemplateButton = { type: "order_status", text: "Acompanhar" };

export const TEMPLATES: TemplateSpec[] = [
  {
    name: "hs_pedido_pago",
    body: "Olá {{nome}}! O teu pedido {{pedido}} na {{loja}} está pago e já entrou na cozinha. Avisamos quando estiver pronto.",
    examples: pick("nome", "pedido", "loja"),
    buttons: [ACOMPANHAR],
  },
  {
    name: "hs_pagamento_recusado",
    body: "Olá {{nome}}, não conseguimos confirmar o pagamento do pedido {{pedido}}. Abre o pedido para tentar outra vez.",
    examples: pick("nome", "pedido"),
    buttons: [ACOMPANHAR],
  },
  {
    name: "hs_pedido_lembrete",
    body: "Olá {{nome}}, o teu pedido {{pedido}} está marcado para as {{hora}}. Já estamos a tratar dele.",
    examples: pick("nome", "pedido", "hora"),
    buttons: [ACOMPANHAR],
  },
  {
    name: "hs_pedido_pronto",
    body: "Olá {{nome}}, o teu pedido {{pedido}} está pronto para levantar na {{loja}}.",
    examples: pick("nome", "pedido", "loja"),
  },
  {
    name: "hs_pedido_a_caminho",
    body: "Olá {{nome}}, o teu pedido {{pedido}} já saiu com o estafeta.",
    examples: pick("nome", "pedido"),
    buttons: [ACOMPANHAR],
  },
  {
    name: "hs_pedido_entregue",
    body: "Bom apetite, {{nome}}! Obrigado por pedires na {{loja}}. Como correu?",
    examples: pick("nome", "loja"),
    // O payload volta no webhook e a conversa responde (engine: "fb:up" / "fb:down").
    buttons: [
      { type: "quick_reply", text: "👍 Correu bem", payload: "fb:up" },
      { type: "quick_reply", text: "👎 Correu mal", payload: "fb:down" },
    ],
  },
  {
    name: "hs_pedido_cancelado",
    body: "Olá {{nome}}, o pedido {{pedido}} foi cancelado. Se tiveres dúvidas, responde a esta mensagem.",
    examples: pick("nome", "pedido"),
  },
  // Para o dono e o gerente (F4), não para clientes.
  {
    name: "hs_alerta_loja",
    body: "Alerta do sistema na loja {{loja}}: {{alerta}}. Detalhe: {{detalhe}}. Abre o painel para veres o que fazer.",
    examples: pick("loja", "alerta", "detalhe"),
  },
  {
    name: "hs_resumo_diario",
    body: "Resumo de {{dia}} na loja {{loja}}: {{pedidos}} pedidos, no total de {{total}}. O detalhe segue por email.",
    examples: pick("dia", "loja", "pedidos", "total"),
  },
];

/** Variáveis de um texto, pela ordem em que aparecem. */
export function templateVariables(body: string): string[] {
  return [...body.matchAll(/\{\{([a-z_]+)\}\}/g)].map((m) => m[1]);
}

/**
 * Corpo do `POST /{waba_id}/message_templates`. `baseUrl` é a origem pública (https) — o botão "Acompanhar"
 * abre `/order-status/{id do pedido}`.
 */
export function metaTemplatePayload(spec: TemplateSpec, baseUrl: string): Record<string, unknown> {
  const origin = baseUrl.replace(/\/+$/, "");
  const components: Array<Record<string, unknown>> = [{
    type: "BODY",
    text: spec.body,
    example: {
      body_text_named_params: templateVariables(spec.body).map((name) => ({ param_name: name, example: spec.examples[name] })),
    },
  }];
  if (spec.buttons?.length) {
    components.push({
      type: "BUTTONS",
      buttons: spec.buttons.map((b) => b.type === "order_status"
        ? { type: "URL", text: b.text, url: `${origin}/order-status/{{1}}`, example: [`${origin}/order-status/0a1b2c3d-0000-4000-8000-000000000042`] }
        : { type: "QUICK_REPLY", text: b.text }),
    });
  }
  return { name: spec.name, language: TEMPLATE_LANGUAGE, category: TEMPLATE_CATEGORY, parameter_format: "NAMED", components };
}
