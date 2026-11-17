import { z } from "zod";
import { agentCartItemSchema } from "@/lib/agents/schemas";
import { sessionContentSchema } from "../dispatch";

/**
 * Estado da conversa de pedido (ADR 0012), guardado em `whatsapp_conversations.state`.
 * Só ids e escolhas — preços nunca: a cada passo recalculam-se com o catálogo actual.
 */

export const STEPS = [
  "idle",      // à espera: menu, carrinho, texto livre
  "item",      // a configurar um produto (variante → grupos → adicionais)
  "qty",       // quantas unidades
  "fulfillment",
  "zone",
  "address",
  "name",
  "payment",
  "confirm",   // resumo mostrado, à espera do "Confirmar"
  "proof",     // pedido criado, à espera do comprovativo
  "feedback",  // tocou em "correu mal": a mensagem seguinte é para a loja ler, não para o bot
] as const;
export type Step = (typeof STEPS)[number];

const uuid = z.string().uuid();
/**
 * Uma linha do carrinho: as escolhas públicas do site mais a observação para a cozinha («sem cebola»).
 * A observação nunca mexe no preço — vai para a comanda tal como o cliente a confirmou no resumo.
 */
export const NOTE_MAX = 120;
export const cartLineSchema = agentCartItemSchema.extend({ notes: z.string().max(NOTE_MAX).optional() });
export type CartLine = z.infer<typeof cartLineSchema>;

const draftSchema = z.object({
  menuItemId: uuid,
  variantId: uuid.optional(),
  addonIds: z.array(uuid).max(20).default([]),
  modifiers: z.array(z.object({ groupId: uuid, optionIds: z.array(uuid).max(20) })).max(10).default([]),
  /** Grupos já respondidos (incluindo os deixados vazios). */
  doneGroups: z.array(uuid).max(10).default([]),
  addonsDone: z.boolean().default(false),
  page: z.number().int().min(0).max(50).default(0),
  /** Quantidade e observação já ditas em texto livre: no fim não se volta a perguntar. */
  qty: z.number().int().min(1).max(20).optional(),
  notes: z.string().max(NOTE_MAX).optional(),
});
export type Draft = z.infer<typeof draftSchema>;

export const conversationStateSchema = z.object({
  v: z.literal(1).default(1),
  step: z.enum(STEPS).default("idle"),
  cart: z.array(cartLineSchema).max(20).default([]),
  draft: draftSchema.optional(),
  fulfillment: z.enum(["delivery", "pickup"]).optional(),
  zoneId: uuid.optional(),
  address: z.string().max(300).optional(),
  name: z.string().max(60).optional(),
  paymentMethod: z.enum(["mpesa", "emola"]).optional(),
  /** Gerado ao mostrar o resumo: o "Confirmar" desse resumo cria no máximo um pedido. */
  checkoutId: uuid.optional(),
  order: z.object({
    id: uuid, number: z.string().max(40), totalCents: z.number().int().nonnegative(),
    method: z.enum(["mpesa", "emola"]), at: z.number().int(),
  }).optional(),
  /** Para propor "a mesma morada" no pedido seguinte. */
  last: z.object({ zoneId: uuid.optional(), address: z.string().max(300).optional(), name: z.string().max(60).optional() }).optional(),
  ai: z.object({ windowStart: z.number().int(), count: z.number().int().min(0) }).optional(),
  /** Produtos pedidos em texto livre a que ainda falta uma escolha obrigatória: um de cada vez, pelos botões. */
  queue: z.array(cartLineSchema).max(8).optional().catch(undefined),
  /** As últimas trocas em texto livre, para a IA perceber «mais um desses». Só texto, nunca números a pagar. */
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(400) })).max(6).optional().catch(undefined),
  /** A última mensagem processada e o que se respondeu: reprocessar não avança o estado duas vezes. */
  lastInboundId: uuid.optional(),
  // Uma resposta gravada que deixou de validar não pode apagar o carrinho: perde-se só ela.
  lastReplies: z.array(sessionContentSchema).max(10).optional().catch(undefined),
  touchedAt: z.number().int().default(0),
});
export type ConversationState = z.infer<typeof conversationStateSchema>;

export function freshState(): ConversationState {
  return conversationStateSchema.parse({});
}

/** Estado gravado ilegível (versão antiga, edição à mão) → conversa nova. Nunca rebenta. */
export function readState(raw: unknown): ConversationState {
  const parsed = conversationStateSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : freshState();
}

const HOUR = 3_600_000;
/** Carrinho esquecido há 6 h já não é o jantar de hoje; à espera de comprovativo, 12 h (como o site). */
export function expireState(state: ConversationState, now: number): ConversationState {
  const idle = now - state.touchedAt;
  if (state.step === "proof" && idle > 12 * HOUR) return { ...freshState(), last: state.last, ai: state.ai };
  if (state.step !== "proof" && idle > 6 * HOUR && (state.cart.length || state.step !== "idle")) {
    return { ...freshState(), last: state.last, ai: state.ai, order: state.order };
  }
  return state;
}
