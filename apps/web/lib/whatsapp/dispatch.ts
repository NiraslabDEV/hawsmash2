import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { isOptOut, type HeaderReader, type MessageContent, type SessionContent, type WhatsAppTransport } from "@delivery/whatsapp";
import type { RenderedTemplate } from "./events";

/**
 * Despacho e recepção do WhatsApp (ADR 0011, 0012). Portátil: o que é de cada projecto entra por `render`
 * (avisos por template) e pelo processador de conversas (respostas de sessão, já guardadas em `payload`).
 */

type Job = {
  id: string;
  store_id: string;
  event: string;
  recipient: string;
  vars: Record<string, unknown> | null;
  kind?: string;
  payload?: unknown;
};

export type DispatchSummary = { claimed: number; accepted: number; retried: number; failed: number };
type Render = (event: string, vars: Record<string, unknown>) => RenderedTemplate | null;

const id = z.string().min(1).max(256);
const title = z.string().min(1).max(80);
const frame = { text: z.string().min(1).max(4096), header: z.string().max(200).optional(), footer: z.string().max(200).optional() };
/** O que sai da fila como mensagem de sessão. O transporte ainda ajusta aos limites da Meta (`fitSession`). */
export const sessionContentSchema: z.ZodType<SessionContent> = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string().min(1).max(4096), previewUrl: z.boolean().optional() }),
  z.object({ type: z.literal("buttons"), ...frame, buttons: z.array(z.object({ id, title })).min(1).max(3) }),
  z.object({
    type: z.literal("list"), ...frame, button: title,
    sections: z.array(z.object({
      title: z.string().max(80).optional(),
      rows: z.array(z.object({ id, title, description: z.string().max(200).optional() })).min(1).max(10),
    })).min(1).max(10),
  }),
  z.object({ type: z.literal("cta_url"), ...frame, displayText: title, url: z.string().url().max(2000).refine((u) => /^https:\/\//.test(u)) }),
  z.object({ type: z.literal("request_contact"), text: z.string().min(1).max(4096) }),
]);

function contentFor(job: Job, render: Render): MessageContent | null {
  if (job.kind === "service") {
    const parsed = sessionContentSchema.safeParse(job.payload);
    return parsed.success ? parsed.data : null;
  }
  return render(job.event, job.vars ?? {});
}

async function sendJobs(svc: SupabaseClient, transport: WhatsAppTransport, render: Render, jobs: Job[]): Promise<DispatchSummary> {
  const summary: DispatchSummary = { claimed: jobs.length, accepted: 0, retried: 0, failed: 0 };
  if (!jobs.length) return summary;

  const storeIds = [...new Set(jobs.map((job) => job.store_id))];
  const { data: stores } = await svc.from("stores").select("id,whatsapp_sender_id").in("id", storeIds);
  const senders = new Map((stores ?? []).map((s: { id: string; whatsapp_sender_id: string | null }) => [s.id, s.whatsapp_sender_id]));

  const finish = async (jobId: string, args: Record<string, unknown>) => {
    const { data: outcome, error: finishError } = await svc.rpc("whatsapp_finish", { p_id: jobId, ...args });
    if (finishError) throw new Error("whatsapp_finish_failed");
    if (outcome === "accepted") summary.accepted++;
    else if (outcome === "retry") summary.retried++;
    else if (outcome === "failed") summary.failed++;
  };

  const sendOne = async (job: Job) => {
    try {
      const senderId = senders.get(job.store_id);
      if (!senderId) {
        await finish(job.id, { p_ok: false, p_retryable: true, p_error: "Loja sem número de WhatsApp." });
        return;
      }
      const content = contentFor(job, render);
      if (!content) {
        await finish(job.id, { p_ok: false, p_retryable: false, p_error: `Sem conteúdo válido para ${job.event}.` });
        return;
      }
      // A chave é o id da linha: repetir depois de um timeout não duplica onde o fornecedor deduplica.
      const result = await transport.send({ ...content, senderId, to: job.recipient, idempotencyKey: job.id });
      await finish(
        job.id,
        result.ok
          ? { p_ok: true, p_provider_message_id: result.providerMessageId }
          : {
              p_ok: false,
              p_retryable: result.retryable,
              p_error: `${result.code}: ${result.error}`,
              p_retry_after_seconds: result.retryAfterMs ? Math.ceil(result.retryAfterMs / 1000) : null,
            },
      );
    } catch {
      // Fica em "sending": o claim seguinte devolve-a à fila ao fim de 10 min, com a mesma chave.
      summary.failed++;
    }
  };

  // Em paralelo entre conversas; em fila dentro da mesma conversa — "pedido criado" antes de "paga aqui".
  const byRecipient = new Map<string, Job[]>();
  for (const job of jobs) {
    const key = `${job.store_id}:${job.recipient}`;
    byRecipient.set(key, [...(byRecipient.get(key) ?? []), job]);
  }
  await Promise.all([...byRecipient.values()].map(async (group) => {
    for (const job of group) await sendOne(job);
  }));
  return summary;
}

/** Cron: a fila toda, por ordem de vencimento. */
export async function dispatchWhatsApp(deps: {
  svc: SupabaseClient;
  transport: WhatsAppTransport;
  render: Render;
  limit?: number;
}): Promise<DispatchSummary> {
  const { data, error } = await deps.svc.rpc("whatsapp_claim", { p_limit: deps.limit ?? 20 });
  if (error) throw new Error("whatsapp_claim_failed");
  return sendJobs(deps.svc, deps.transport, deps.render, (data ?? []) as Job[]);
}

/** Respostas acabadas de enfileirar: saem já, sem esperar pelo cron. O que falhar o cron repete. */
export async function dispatchWhatsAppIds(deps: {
  svc: SupabaseClient;
  transport: WhatsAppTransport;
  render: Render;
  ids: string[];
}): Promise<DispatchSummary> {
  if (!deps.ids.length) return { claimed: 0, accepted: 0, retried: 0, failed: 0 };
  const { data, error } = await deps.svc.rpc("whatsapp_claim_ids", { p_ids: deps.ids });
  if (error) throw new Error("whatsapp_claim_failed");
  return sendJobs(deps.svc, deps.transport, deps.render, (data ?? []) as Job[]);
}

export type WebhookResult = {
  status: number;
  body: Record<string, unknown>;
  /** Mensagens novas, de lojas com conversa ligada, por processar — pela ordem em que chegaram. */
  inbound: string[];
};

export async function handleWhatsAppWebhook(deps: {
  svc: SupabaseClient;
  transport: WhatsAppTransport;
  rawBody: string;
  headers: HeaderReader;
  nowMs?: number;
}): Promise<WebhookResult> {
  const { svc, transport, rawBody, headers } = deps;
  const reject = (status: number, error: string): WebhookResult => ({ status, body: { error }, inbound: [] });
  if (Buffer.byteLength(rawBody) > 1_048_576) return reject(413, "payload_too_large");
  // Assinatura sobre o corpo cru, antes de qualquer parse ou escrita.
  if (!transport.verifyWebhook(rawBody, headers, deps.nowMs)) return reject(401, "invalid_signature");
  let payload: unknown;
  try { payload = JSON.parse(rawBody); } catch { return reject(400, "invalid_payload"); }
  const deliveries = transport.parseWebhook(payload, headers);
  if (!deliveries) return reject(400, "missing_event_id");

  const inbound: string[] = [];
  let ignored = 0;
  for (const { eventId, event } of deliveries) {
    if (event.kind === "status") {
      const { error } = await svc.rpc("whatsapp_apply_status", {
        p_event_id: eventId,
        p_provider_message_id: event.providerMessageId,
        p_status: event.status,
        p_error: event.error ?? null,
      });
      // 503 → o fornecedor volta a tentar a entrega toda; a deduplicação por evento torna isso seguro.
      if (error) return { ...reject(503, "temporarily_unavailable"), inbound };
    } else if (event.kind === "inbound") {
      const { data, error } = await svc.rpc("whatsapp_receive", {
        p_event_id: eventId,
        p_sender_id: event.senderId,
        p_from: event.from,
        p_provider_message_id: event.providerMessageId,
        p_content_type: event.contentType,
        p_body: event.text,
        p_reply_id: event.replyId,
        p_media_id: event.media?.id ?? null,
        p_media_mime: event.media?.mimeType ?? null,
        p_profile_name: event.profileName,
        p_opt_out: !event.replyId && isOptOut(event.text),
      });
      if (error) return { ...reject(503, "temporarily_unavailable"), inbound };
      const received = data as { inbound_id: string | null; is_new: boolean; chat_enabled: boolean } | null;
      if (received?.is_new && received.chat_enabled && received.inbound_id) inbound.push(received.inbound_id);
    } else if (event.kind === "inbound_hidden") {
      await askForPhone(svc, transport, eventId, event.senderId, event.userId);
    } else {
      ignored++;
    }
  }
  return { status: 200, body: { ok: true, events: deliveries.length, ignored }, inbound };
}

export const ASK_PHONE_TEXT = "Olá! 👋 Para continuarmos por aqui precisamos do teu número de telemóvel. Toca no botão para o partilhares connosco.";

/**
 * Username com número escondido: a Meta só dá o BSUID, e sem telefone não há pedido nem aviso. Pede-se o número
 * uma vez por mensagem. Fica fora da fila porque ela só aceita E.164. Best-effort: nada aqui trava o webhook.
 */
async function askForPhone(svc: SupabaseClient, transport: WhatsAppTransport, eventId: string, senderId: string, userId: string) {
  try {
    const { data: first, error } = await svc.rpc("whatsapp_receipt_once", { p_event_id: eventId, p_sender_id: senderId });
    if (error || !first) return;
    await transport.send({ type: "request_contact", text: ASK_PHONE_TEXT, senderId, to: userId, idempotencyKey: eventId });
  } catch {
    // A pessoa volta a escrever e pede-se outra vez.
  }
}

/** `GET` do webhook: a Meta confirma que o endereço é nosso antes de mandar eventos. */
export function handleWhatsAppChallenge(transport: WhatsAppTransport, url: URL): { status: number; body: string } {
  const challenge = transport.verifyChallenge?.(url.searchParams) ?? null;
  return challenge ? { status: 200, body: challenge } : { status: 403, body: "forbidden" };
}
