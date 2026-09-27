import { z } from "zod";
import { renderMessage, stepSchema } from "./studio";

export const SYSTEM_EMAILS = [
  {
    key: "paid",
    name: "Pagamento confirmado",
    audience: "Cliente",
    when: "Após confirmação do pagamento",
    scope: "store",
    description:
      "O email de aprovação que o sistema já envia, com pedido, loja, total e pagamento.",
  },
  {
    key: "cancelled",
    name: "Pagamento não confirmado",
    audience: "Cliente",
    when: "Ao comunicar a recusa/cancelamento",
    scope: "store",
    description:
      "A mensagem existente de recusa, incluindo o motivo registado pela equipa.",
  },
  {
    key: "proof",
    name: "Comprovativo recebido",
    audience: "Dono",
    when: "Quando o cliente envia o comprovativo",
    scope: "store",
    description: "Alerta existente para conferir o pagamento do pedido.",
  },
  {
    key: "account_code",
    name: "Código de acesso",
    audience: "Cliente",
    when: "Ao recuperar a conta noutro dispositivo",
    scope: "global",
    description:
      "Código temporário de entrada. O código e a validade são sempre preservados.",
  },
  {
    key: "cash_close",
    name: "Fecho de turno",
    audience: "Dono",
    when: "Quando a equipa envia o fecho de caixa",
    scope: "store",
    description:
      "Relatório existente com valores, diferenças e artigos vendidos.",
  },
  {
    key: "cash_day",
    name: "Fecho do dia",
    audience: "Dono",
    when: "Quando a equipa envia o fecho do dia",
    scope: "store",
    description: "Consolidação existente dos turnos da loja.",
  },
  {
    key: "digest",
    name: "Resumo diário",
    audience: "Dono",
    when: "Todos os dias às 08h de Maputo",
    scope: "global",
    description: "Vendas do dia anterior, caixa e incidentes das lojas.",
  },
  {
    key: "monthly",
    name: "Resumo mensal e Google",
    audience: "Dono",
    when: "Dia 1 às 08h de Maputo",
    scope: "global",
    description:
      "Resumo do mês anterior com comparação e métricas Google disponíveis.",
  },
  {
    key: "alerts",
    name: "Alertas operacionais",
    audience: "Dono",
    when: "Quando o monitor encontra incidentes novos",
    scope: "global",
    description: "Avisos de operação emitidos pelo monitor do sistema.",
  },
] as const;
export type SystemEmailKey = (typeof SYSTEM_EMAILS)[number]["key"];
export const systemEmailKeySchema = z.enum([
  "paid",
  "cancelled",
  "proof",
  "account_code",
  "cash_close",
  "cash_day",
  "digest",
  "monthly",
  "alerts",
]);
export const systemTemplateSchema = z
  .object({
    key: systemEmailKeySchema,
    mode: z.enum(["current", "custom"]),
    enabled: z.boolean(),
    template_id: z.string().max(100),
    step: stepSchema,
  })
  .refine(
    (v) => v.step.delay_minutes === 0,
    "Emails operacionais são enviados no momento do evento.",
  )
  .refine(
    (v) => v.step.blocks.filter((b) => b.type === "system").length === 1,
    "Mantém exactamente um bloco com os dados do sistema.",
  )
  .refine(
    (v) => v.key !== "account_code" || v.enabled,
    "O código de acesso não pode ser desligado.",
  );
export type SystemTemplate = z.infer<typeof systemTemplateSchema>;
export function defaultSystemTemplate(key: SystemEmailKey): SystemTemplate {
  return {
    key,
    mode: "current",
    enabled: true,
    template_id: "current",
    step: {
      subject: "{{assunto_original}}",
      preheader: "",
      delay_minutes: 0,
      theme: "classic",
      blocks: [{ type: "system" }],
    },
  };
}
export function applySystemTemplate(
  config: SystemTemplate,
  original: { subject: string; html: string },
  variables: Record<string, string>,
) {
  const valid = systemTemplateSchema.parse(config);
  if (valid.mode === "current") return original;
  // Relatórios antigos são documentos completos. Preservar os estilos do body
  // num contentor evita documentos HTML aninhados dentro do novo modelo.
  const body = original.html.match(/<body([^>]*)>([\s\S]*?)<\/body>/i);
  const content = body ? `<div${body[1]}>${body[2]}</div>` : original.html;
  return renderMessage(
    valid.step,
    { ...variables, assunto_original: original.subject },
    undefined,
    content,
  );
}
