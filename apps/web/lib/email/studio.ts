import { z } from "zod";

const url = z
  .string()
  .url()
  .max(2048)
  .refine((value) => /^https:\/\//i.test(value), "Usa um endereço https://");
export const blockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("heading"), text: z.string().max(500) }),
  z.object({ type: z.literal("text"), text: z.string().max(10000) }),
  z.object({ type: z.literal("image"), url, text: z.string().max(500) }),
  z.object({
    type: z.literal("button"),
    url: z.union([url, z.literal("{{menu_url}}"), z.literal("{{review_url}}")]),
    text: z.string().min(1).max(200),
  }),
  z.object({ type: z.literal("divider") }),
  z.object({ type: z.literal("system") }),
]);
export const stepSchema = z.object({
  theme: z.enum(["classic", "gold", "dark", "editorial"]).optional(),
  subject: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .refine((v) => !/[\r\n]/.test(v)),
  preheader: z.string().max(300),
  delay_minutes: z.number().int().min(0).max(525600),
  blocks: z.array(blockSchema).min(1).max(40),
});
export const flowSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    kind: z.enum(["transactional", "marketing"]),
    trigger: z.enum([
      "paid",
      "cancelled",
      "ready",
      "delivered",
      "manual",
      "subscribed",
    ]),
    status: z.enum(["draft", "active", "paused", "archived"]),
    steps: z.array(stepSchema).min(1).max(12),
  })
  .refine(
    (v) =>
      v.kind === "transactional"
        ? ["paid", "cancelled", "ready", "delivered"].includes(v.trigger)
        : ["manual", "subscribed"].includes(v.trigger),
    "Gatilho incompatível com o tipo de email.",
  )
  .refine(
    (v) => v.steps.every((s) => s.blocks.every((b) => b.type !== "system")),
    "O bloco operacional só pertence aos emails do sistema.",
  );
export type EmailBlock = z.infer<typeof blockSchema>;
export type EmailStep = z.infer<typeof stepSchema>;
export type EmailFlow = z.infer<typeof flowSchema> & {
  id?: string;
  store_id?: string;
  updated_at?: string;
};
export const triggerLabels: Record<EmailFlow["trigger"], string> = {
  paid: "Pagamento confirmado",
  cancelled: "Pedido cancelado",
  ready: "Pedido pronto",
  delivered: "Pedido entregue",
  manual: "Inscrição manual na campanha",
  subscribed: "Novo contacto com consentimento",
};
export function defaultStep(): EmailStep {
  return {
    subject: "Uma mensagem de {{loja}}",
    preheader: "",
    delay_minutes: 0,
    blocks: [
      { type: "heading", text: "Olá, {{nome}}!" },
      { type: "text", text: "Escreve aqui a tua mensagem." },
    ],
  };
}
export function nextDelivery(
  previousSentAt: string,
  delayMinutes: number,
): string {
  if (
    !Number.isInteger(delayMinutes) ||
    delayMinutes < 0 ||
    delayMinutes > 525600
  )
    throw new Error("Intervalo inválido");
  return new Date(
    new Date(previousSentAt).getTime() + delayMinutes * 60000,
  ).toISOString();
}
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function renderMessage(
  step: EmailStep,
  variables: Record<string, string>,
  unsubscribeUrl?: string,
  systemHtml?: string,
) {
  const replace = (text: string) =>
    text.replace(
      /\{\{(nome|loja|pedido|total|assunto_original)\}\}/g,
      (_, key: string) => variables[key] ?? "",
    );
  const body = step.blocks
    .map((block) => {
      if (block.type === "system")
        return (
          systemHtml ??
          '<div style="border:1px dashed #999;padding:20px">Os dados reais deste email entram aqui automaticamente.</div>'
        );
      if (block.type === "divider")
        return '<hr style="border:0;border-top:1px solid #e5e7eb;margin:28px 0">';
      const text = escape(replace(block.text));
      if (block.type === "heading")
        return `<h1 style="font-size:28px;line-height:1.25;color:#171717">${text}</h1>`;
      if (block.type === "text")
        return `<p style="line-height:1.7;white-space:pre-line">${text}</p>`;
      // As URLs não interpolam variáveis. Validação também no renderer para snapshots antigos.
      const href =
        block.url === "{{menu_url}}"
          ? variables.menu_url
          : block.url === "{{review_url}}"
            ? variables.review_url
            : block.url;
      if (!href || !url.safeParse(href).success) return "";
      if (block.type === "image")
        return `<img src="${escape(block.url)}" alt="${text}" style="max-width:100%;height:auto;border-radius:12px">`;
      return `<p style="margin:28px 0"><a href="${escape(href)}" style="display:inline-block;background:#e5a93c;color:#171717;padding:14px 24px;border-radius:8px;text-decoration:none;font-weight:bold">${text}</a></p>`;
    })
    .join("");
  const themes = {
    classic: { bg: "#f5f4f1", border: "none", font: "Arial,sans-serif" },
    gold: {
      bg: "#f7eddc",
      border: "6px solid #e5a93c",
      font: "Arial,sans-serif",
    },
    dark: {
      bg: "#171411",
      border: "6px solid #e5a93c",
      font: "Arial,sans-serif",
    },
    editorial: {
      bg: "#edecea",
      border: "2px solid #171717",
      font: "Georgia,serif",
    },
  };
  const theme = themes[step.theme ?? "classic"];
  return {
    subject: replace(step.subject).replace(/[\r\n]/g, " "),
    html: `<!doctype html><html lang="pt"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:${theme.bg};color:#333;font-family:${theme.font}"><div style="display:none;max-height:0;overflow:hidden">${escape(replace(step.preheader))}</div><div style="max-width:560px;margin:24px auto;background:white;padding:32px;border-radius:16px;border-top:${theme.border}">${body}${unsubscribeUrl ? `<hr style="border:0;border-top:1px solid #eee;margin-top:32px"><p style="font-size:12px;color:#666">Recebes esta mensagem porque aceitaste comunicações desta loja. <a href="${escape(unsubscribeUrl)}">Cancelar subscrição</a></p>` : ""}</div></body></html>`,
  };
}
