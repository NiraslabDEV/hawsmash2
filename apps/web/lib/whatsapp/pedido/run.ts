import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isOptOut, type InboundMedia, type SessionContent, type WhatsAppTransport } from "@delivery/whatsapp";
import { publicAgentDependencies } from "@/lib/agents/runtime";
import { readCatalogue } from "@/lib/agents/service";
import { ownerProofEmail } from "@/lib/email/order-emails";
import { sendMail } from "@/lib/email/transport";
import { dispatchWhatsAppIds } from "../dispatch";
import { renderWhatsAppEvent } from "../events";
import { runTurn, type AiIntent, type ProofResult, type TurnContext, type TurnDeps } from "./engine";
import { readState, type ConversationState } from "./state";

/**
 * Processa UMA mensagem recebida (ADR 0012): claim → conversa → respostas na fila → envio imediato.
 * Chamado pelo webhook na hora e pelo cron para o que ficou a meio. Nunca rebenta para fora:
 * o pior caso é a mensagem ficar marcada com erro e a pessoa escrever outra vez.
 */

type InboundRow = {
  id: string;
  store_id: string;
  from_phone: string;
  content_type: string;
  body: string | null;
  reply_id: string | null;
  media_id: string | null;
  media_mime: string | null;
  profile_name: string | null;
};

type Interpret = (request: { text: string; state: ConversationState; ctx: TurnContext }) => Promise<AiIntent | null>;

export interface ProcessDeps {
  svc: SupabaseClient;
  transport: WhatsAppTransport;
  /** Origem pública do site, https. */
  baseUrl: string;
  interpret?: Interpret | null;
  /** Para testes: o catálogo sem passar pelo RPC público. */
  loadCatalogue?: (slug: string) => Promise<Pick<TurnContext, "menu" | "store">>;
  now?: () => number;
}

const PROOF_TYPES: Record<string, string> = {
  "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf",
};

export async function processInbound(deps: ProcessDeps, inboundId: string): Promise<"done" | "skipped" | "failed"> {
  const { svc, transport } = deps;
  const { data: claimed, error: claimError } = await svc.rpc("whatsapp_inbound_claim", { p_id: inboundId });
  const row = (Array.isArray(claimed) ? claimed[0] : claimed) as InboundRow | undefined;
  if (claimError || !row) return "skipped";
  const finish = (error: string | null) => svc.rpc("whatsapp_inbound_finish", { p_id: row.id, p_error: error });

  try {
    const { data: store, error: storeError } = await svc
      .from("stores").select("id,slug,whatsapp_chat_enabled,whatsapp_handoff_phone").eq("id", row.store_id).single();
    if (storeError || !store) throw new Error("store_unavailable");
    if (!store.whatsapp_chat_enabled) { await finish(null); return "skipped"; }

    const catalogue = deps.loadCatalogue
      ? await deps.loadCatalogue(store.slug)
      : await readCatalogue(store.slug, publicAgentDependencies(deps.baseUrl));
    const ctx: TurnContext = {
      ...catalogue,
      baseUrl: deps.baseUrl,
      handoffPhone: store.whatsapp_handoff_phone ?? null,
      aiEnabled: Boolean(deps.interpret),
    };
    const phone = row.from_phone;
    const media: InboundMedia | null = row.media_id ? { id: row.media_id, mimeType: row.media_mime, caption: null } : null;

    const turnDeps: TurnDeps = {
      newId: randomUUID,
      async createOrder(checkoutId, payload) {
        const { data, error } = await svc.rpc("whatsapp_create_order", {
          p_store_id: store.id, p_phone: phone, p_checkout_id: checkoutId, p_payload: payload,
        });
        if (error || !data) return { ok: false, code: error?.message ?? "create_order_failed" };
        const r = data as { order_id: string; order_number: string; total_cents: number; payment_method: "mpesa" | "emola"; created: boolean };
        return { ok: true, orderId: r.order_id, orderNumber: r.order_number, totalCents: r.total_cents, method: r.payment_method, created: r.created };
      },
      async pendingOrder() {
        const { data, error } = await svc.rpc("whatsapp_pending_order", { p_store_id: store.id, p_phone: phone });
        if (error || !data) return null;
        const r = data as { order_id: string; order_number: string; total_cents: number; payment_method: string };
        return { orderId: r.order_id, orderNumber: r.order_number, totalCents: r.total_cents, method: r.payment_method };
      },
      attachProof: (orderId, file) => attachProof(deps, { storeId: store.id, phone, orderId, media: file, inboundId: row.id }),
      ...(deps.interpret ? { interpret: deps.interpret } : {}),
    };

    let replies: SessionContent[] = [];
    let conversationId = "";
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data: conv, error: convError } = await svc.rpc("whatsapp_conversation_get", { p_store_id: store.id, p_phone: phone });
      if (convError || !conv) throw new Error("conversation_unavailable");
      const c = conv as { id: string; state: unknown; version: number };
      conversationId = c.id;
      const state = readState(c.state);
      // Já processada (o processo morreu depois de gravar): reenviar as mesmas respostas, sem avançar o estado.
      if (state.lastInboundId === row.id) { replies = state.lastReplies ?? []; break; }
      const result = await runTurn(state, {
        inboundId: row.id,
        now: (deps.now ?? Date.now)(),
        text: row.body,
        replyId: row.reply_id,
        media,
        contentType: row.content_type,
        profileName: row.profile_name,
        optOut: !row.reply_id && isOptOut(row.body),
      }, ctx, turnDeps);
      const next: ConversationState = { ...result.state, lastInboundId: row.id, lastReplies: result.replies };
      const { data: saved, error: saveError } = await svc.rpc("whatsapp_conversation_save", { p_id: c.id, p_version: c.version, p_state: next });
      if (saveError) throw new Error("conversation_save_failed");
      if (saved) { replies = result.replies; break; }
      // Outra mensagem da mesma pessoa gravou primeiro: voltar a ler e decidir outra vez.
      if (attempt === 2) throw new Error("conversation_busy");
    }

    if (replies.length) {
      const { data: ids, error: enqueueError } = await svc.rpc("whatsapp_enqueue_session", {
        p_store_id: store.id, p_subject_type: "conversation", p_subject_id: conversationId,
        p_recipient: phone, p_messages: replies, p_key_prefix: `in:${row.id}`,
      });
      if (enqueueError) throw new Error("enqueue_failed");
      const outIds = ((ids ?? []) as Array<string | { whatsapp_enqueue_session: string }>)
        .map((x) => (typeof x === "string" ? x : x.whatsapp_enqueue_session));
      // O que não sair agora o cron repete (validade de 15 min por resposta).
      await dispatchWhatsAppIds({ svc, transport, render: renderWhatsAppEvent, ids: outIds }).catch(() => undefined);
    }
    await finish(null);
    return "done";
  } catch (error) {
    await finish(error instanceof Error ? error.message : "process_failed");
    return "failed";
  }
}

async function attachProof(
  deps: ProcessDeps,
  input: { storeId: string; phone: string; orderId: string; media: InboundMedia; inboundId: string },
): Promise<ProofResult> {
  const { svc, transport } = deps;
  if (!transport.downloadMedia) return "error";
  const file = await transport.downloadMedia(input.media.id);
  if (!file.ok) return file.error === "media_grande_demais" ? "invalid_type" : "error";
  const mime = (file.mimeType || input.media.mimeType || "").toLowerCase();
  const ext = PROOF_TYPES[mime];
  if (!ext) return "invalid_type";
  // O nome é o id da mensagem recebida: repetir o processamento escreve o mesmo ficheiro.
  const path = `${input.orderId}/whatsapp-${input.inboundId}.${ext}`;
  const { error: uploadError } = await svc.storage.from("payment-proofs")
    .upload(path, Buffer.from(file.bytes), { contentType: mime, upsert: true });
  if (uploadError) return "error";
  const { data, error } = await svc.rpc("whatsapp_attach_proof", {
    p_store_id: input.storeId, p_phone: input.phone, p_order_id: input.orderId, p_path: path,
  });
  if (error) {
    if (!/order_not_attachable/.test(error.message)) return "error";
    const { data: order } = await svc.from("orders").select("payment_proof_path").eq("id", input.orderId).single();
    return order?.payment_proof_path === path ? "ok" : "already";
  }
  // Email ao dono, como o comprovativo do site — best-effort, não espera.
  const r = (data ?? {}) as { owner_email?: string; order_number?: string; customer_name?: string | null; total_cents?: number; payment_method?: string | null; fulfillment_type?: string | null };
  const ownerEmail = r.owner_email || process.env.OWNER_EMAIL;
  if (ownerEmail) {
    const { subject, html } = ownerProofEmail({
      orderNumber: String(r.order_number ?? ""), customerName: r.customer_name ?? null, totalCents: r.total_cents ?? 0,
      paymentMethod: r.payment_method ?? null, fulfillmentType: r.fulfillment_type ?? null,
    });
    void sendMail({ to: ownerEmail, subject, html, event: "proof", storeId: input.storeId })
      .then((res) => { if (!res.ok) console.error("[whatsapp] owner proof email failed:", res.error); })
      .catch((e) => console.error("[whatsapp] owner proof email failed:", e));
  }
  return "ok";
}

/** Cron: o que o webhook não acabou (processo reiniciado, timeout), pela ordem de chegada. */
export async function processPendingInbound(deps: ProcessDeps, limit = 20): Promise<{ processed: number; failed: number }> {
  const { data, error } = await deps.svc.rpc("whatsapp_inbound_pending", { p_limit: limit });
  if (error) throw new Error("whatsapp_inbound_pending_failed");
  const ids = ((data ?? []) as Array<string | { whatsapp_inbound_pending: string }>)
    .map((x) => (typeof x === "string" ? x : x.whatsapp_inbound_pending));
  let processed = 0;
  let failed = 0;
  for (const id of ids) {
    const outcome = await processInbound(deps, id);
    if (outcome === "done") processed++;
    else if (outcome === "failed") failed++;
  }
  return { processed, failed };
}

/** Origem pública para links: APP_BASE_URL, senão o host do proxy. Sempre https fora de localhost. */
export function publicBaseUrl(request: Request): string {
  const env = process.env.APP_BASE_URL?.trim();
  if (env && !env.includes("localhost")) {
    const clean = env.replace(/\/+$/, "");
    return /^https?:\/\//i.test(clean) ? clean : `https://${clean}`;
  }
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  return host ? `https://${host}` : new URL(request.url).origin;
}
