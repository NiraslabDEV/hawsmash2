import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createMockTransport } from "@delivery/whatsapp";
import { whatsappTransport } from "../config";
import { dispatchWhatsApp, dispatchWhatsAppIds, handleWhatsAppChallenge, handleWhatsAppWebhook } from "../dispatch";
import { renderWhatsAppEvent, WHATSAPP_EVENTS } from "../events";

const ORDER_ID = "0a1b2c3d-0000-4000-8000-000000000042";
const vars = { nome: "Ana", pedido: "MPT-0042", loja: "HAWSMASH Maputo", hora: "19:30", order_id: ORDER_ID };

describe("mapa evento → template (HAWSMASH)", () => {
  it("cada evento que a 1118 enfileira tem template", () => {
    for (const event of [
      "order.paid", "order.payment_failed", "order.scheduled_reminder", "order.ready",
      "order.on_the_way", "order.delivered", "order.cancelled",
    ]) {
      expect(WHATSAPP_EVENTS).toContain(event);
      expect(renderWhatsAppEvent(event, vars)).not.toBeNull();
    }
  });
  it("pago: só as variáveis do template, botão com o id do pedido", () => {
    expect(renderWhatsAppEvent("order.paid", vars)).toEqual({
      template: "hs_pedido_pago",
      language: "pt_PT",
      variables: { nome: "Ana", pedido: "MPT-0042", loja: "HAWSMASH Maputo" },
      components: [{ type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: ORDER_ID }] }],
    });
  });
  it("limpa o que a Meta recusa e corta a 60", () => {
    const out = renderWhatsAppEvent("order.cancelled", { ...vars, nome: "Ana\n\tMaria    Silva" });
    expect(out?.variables?.nome).toBe("Ana Maria Silva");
    expect(renderWhatsAppEvent("order.cancelled", { ...vars, nome: "x".repeat(80) })?.variables?.nome).toHaveLength(60);
  });
  it("evento desconhecido, variável em falta ou id inválido → null", () => {
    expect(renderWhatsAppEvent("membership.renewal", vars)).toBeNull();
    expect(renderWhatsAppEvent("order.paid", { ...vars, pedido: "" })).toBeNull();
    expect(renderWhatsAppEvent("order.paid", { ...vars, order_id: "../admin" })).toBeNull();
  });
});

describe("transporte pelo ambiente", () => {
  const env = (extra: Record<string, string>) => ({ NODE_ENV: "production", ...extra }) as unknown as NodeJS.ProcessEnv;
  it("desligado sem configuração completa", () => {
    expect(whatsappTransport(env({}))).toBeNull();
    expect(whatsappTransport(env({ WHATSAPP_PROVIDER: "tyxter", TYXTER_API_KEY: "tx_live_a" }))).toBeNull();
    expect(whatsappTransport(env({ WHATSAPP_PROVIDER: "tyxter", TYXTER_API_KEY: "sk_x", TYXTER_WEBHOOK_SECRET: "s" }))).toBeNull();
  });
  it("Tyxter com chave e segredo", () => {
    expect(whatsappTransport(env({ WHATSAPP_PROVIDER: "tyxter", TYXTER_API_KEY: "tx_live_a", TYXTER_WEBHOOK_SECRET: "s" }))?.name).toBe("tyxter");
  });
  it("Meta com token, segredo da app e verify token comprido", () => {
    const meta = { WHATSAPP_PROVIDER: "meta", META_WHATSAPP_TOKEN: "EAAG", META_APP_SECRET: "s" };
    expect(whatsappTransport(env({ ...meta, META_WEBHOOK_VERIFY_TOKEN: "curto" }))).toBeNull();
    expect(whatsappTransport(env({ ...meta }))).toBeNull();
    expect(whatsappTransport(env({ ...meta, META_WEBHOOK_VERIFY_TOKEN: "um-token-bem-comprido-123" }))?.name).toBe("meta");
  });
  it("mock nunca em produção", () => {
    expect(whatsappTransport(env({ WHATSAPP_PROVIDER: "mock" }))).toBeNull();
    expect(whatsappTransport(env({ WHATSAPP_PROVIDER: "mock", NODE_ENV: "development" }))?.name).toBe("mock");
  });
});

type Rpc = (name: string, args: Record<string, unknown>) => { data: unknown; error: unknown };
function fakeSvc(rpc: Rpc, stores = [{ id: "s-maputo", whatsapp_sender_id: "wpn_maputo" }]) {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const svc = {
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => { calls.push([name, args]); return rpc(name, args); }),
    from: vi.fn(() => ({ select: () => ({ in: async () => ({ data: stores, error: null }) }) })),
  };
  return { svc: svc as unknown as SupabaseClient, calls };
}
const job = (over: Record<string, unknown> = {}) => ({
  id: "job-1", store_id: "s-maputo", event: "order.paid", recipient: "+258841234567", vars, ...over,
});

describe("despacho da fila", () => {
  it("envia pelo número da loja com a chave = id da linha e marca aceite", async () => {
    const transport = createMockTransport();
    const { svc, calls } = fakeSvc((name) =>
      name === "whatsapp_claim" ? { data: [job()], error: null } : { data: "accepted", error: null });
    const summary = await dispatchWhatsApp({ svc, transport, render: renderWhatsAppEvent });
    expect(summary).toEqual({ claimed: 1, accepted: 1, retried: 0, failed: 0 });
    expect(transport.sent[0]).toMatchObject({ senderId: "wpn_maputo", to: "+258841234567", template: "hs_pedido_pago", idempotencyKey: "job-1" });
    expect(calls.find(([n]) => n === "whatsapp_finish")?.[1]).toEqual({ p_id: "job-1", p_ok: true, p_provider_message_id: "mock_msg_1" });
  });

  it("falha do fornecedor volta à fila com o tempo pedido; nada rebenta", async () => {
    const transport = createMockTransport();
    transport.failNext({ ok: false, retryable: true, code: "rate_limited", error: "devagar", retryAfterMs: 2500 });
    const { svc, calls } = fakeSvc((name) =>
      name === "whatsapp_claim" ? { data: [job()], error: null } : { data: "retry", error: null });
    const summary = await dispatchWhatsApp({ svc, transport, render: renderWhatsAppEvent });
    expect(summary.retried).toBe(1);
    expect(calls.find(([n]) => n === "whatsapp_finish")?.[1]).toMatchObject({ p_ok: false, p_retryable: true, p_retry_after_seconds: 3 });
  });

  it("evento sem template falha de vez; loja sem número espera", async () => {
    const transport = createMockTransport();
    const { svc, calls } = fakeSvc(
      (name) => name === "whatsapp_claim"
        ? { data: [job({ id: "a", event: "order.unknown" }), job({ id: "b", store_id: "s-matola" })], error: null }
        : { data: "failed", error: null },
    );
    await dispatchWhatsApp({ svc, transport, render: renderWhatsAppEvent });
    const finishes = Object.fromEntries(calls.filter(([n]) => n === "whatsapp_finish").map(([, a]) => [a.p_id, a]));
    expect(finishes.a).toMatchObject({ p_ok: false, p_retryable: false });
    expect(finishes.b).toMatchObject({ p_ok: false, p_retryable: true, p_error: "Loja sem número de WhatsApp." });
    expect(transport.sent).toHaveLength(0);
  });

  it("erro ao gravar o resultado deixa a linha em sending (volta sozinha) e conta como falha", async () => {
    const { svc } = fakeSvc((name) =>
      name === "whatsapp_claim" ? { data: [job()], error: null } : { data: null, error: { message: "x" } });
    const summary = await dispatchWhatsApp({ svc, transport: createMockTransport(), render: renderWhatsAppEvent });
    expect(summary.failed).toBe(1);
  });

  it("resposta da conversa sai do payload, pela ordem, uma conversa de cada vez", async () => {
    const transport = createMockTransport();
    const jobs = [
      job({ id: "r1", kind: "service", event: "chat.reply", vars: {}, payload: { type: "text", text: "Pedido registado" } }),
      job({ id: "r2", kind: "service", event: "chat.reply", vars: {}, payload: { type: "buttons", text: "E agora?", buttons: [{ id: "menu", title: "Ver cardápio" }] } }),
      job({ id: "r3", kind: "service", event: "chat.reply", vars: {}, payload: { type: "list", text: "sem linhas", button: "x", sections: [] } }),
    ];
    const { svc, calls } = fakeSvc((name) =>
      name === "whatsapp_claim_ids" ? { data: jobs, error: null } : { data: "accepted", error: null });
    await dispatchWhatsAppIds({ svc, transport, render: renderWhatsAppEvent, ids: ["r1", "r2", "r3"] });
    expect(calls[0]).toEqual(["whatsapp_claim_ids", { p_ids: ["r1", "r2", "r3"] }]);
    expect(transport.sent.map((m) => m.type)).toEqual(["text", "buttons"]);
    const finishes = Object.fromEntries(calls.filter(([n]) => n === "whatsapp_finish").map(([, a]) => [a.p_id, a]));
    expect(finishes.r3).toMatchObject({ p_ok: false, p_retryable: false });
  });

  it("fila ilegível → erro para o cron responder 503", async () => {
    const { svc } = fakeSvc(() => ({ data: null, error: { message: "down" } }));
    await expect(dispatchWhatsApp({ svc, transport: createMockTransport(), render: renderWhatsAppEvent })).rejects.toThrow();
  });
});

describe("webhook", () => {
  const transport = createMockTransport("seg");
  const signed = (body: unknown, id = "evt_1") => {
    const rawBody = JSON.stringify(body);
    const { timestamp, signature } = transport.sign(rawBody);
    const h: Record<string, string> = { "tyxter-webhook-id": id, "tyxter-webhook-timestamp": timestamp, "tyxter-webhook-signature": signature };
    return { rawBody, headers: { get: (n: string) => h[n.toLowerCase()] ?? null } };
  };

  it("assinatura errada → 401 sem tocar na BD", async () => {
    const { svc, calls } = fakeSvc(() => ({ data: null, error: null }));
    const { rawBody, headers } = signed({ type: "message.read", data: { message_id: "m" } });
    const res = await handleWhatsAppWebhook({ svc, transport, rawBody: rawBody + " ", headers });
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("estado de entrega segue para a BD com o id do evento", async () => {
    const { svc, calls } = fakeSvc(() => ({ data: true, error: null }));
    const res = await handleWhatsAppWebhook({ svc, transport, ...signed({ type: "message.read", data: { message_id: "m1" } }) });
    expect(res.status).toBe(200);
    expect(calls[0]).toEqual(["whatsapp_apply_status", { p_event_id: "evt_1", p_provider_message_id: "m1", p_status: "read", p_error: null }]);
  });

  const received = (body: string, content: Record<string, unknown> = { type: "text", text: { body } }) => ({
    type: "message.received",
    data: { message_id: "m2", sender: { type: "phone_e164", id: "+258841234567", profile_name: "Ana" }, recipient: { type: "whatsapp_phone_number", id: "wpn_maputo" }, content },
  });

  it("SAIR grava opt-out na loja do número que recebeu", async () => {
    const { svc, calls } = fakeSvc(() => ({ data: { store_id: "s-maputo", inbound_id: "in-1", is_new: true, chat_enabled: false }, error: null }));
    const res = await handleWhatsAppWebhook({ svc, transport, ...signed(received(" sair ")) });
    expect(res).toEqual({ status: 200, body: { ok: true, events: 1, ignored: 0 }, inbound: [] });
    expect(calls[0]).toEqual(["whatsapp_receive", expect.objectContaining({
      p_sender_id: "wpn_maputo", p_from: "+258841234567", p_opt_out: true, p_profile_name: "Ana", p_reply_id: null,
    })]);
  });

  it("botão chamado «Sair» não é opt-out; mensagem nova com conversa ligada fica para processar", async () => {
    const { svc, calls } = fakeSvc(() => ({ data: { store_id: "s-maputo", inbound_id: "in-2", is_new: true, chat_enabled: true }, error: null }));
    const res = await handleWhatsAppWebhook({ svc, transport, ...signed(received("", { type: "interactive", interactive: { button_reply: { id: "clear", title: "Sair" } } })) });
    expect(res.inbound).toEqual(["in-2"]);
    expect(calls[0][1]).toMatchObject({ p_opt_out: false, p_reply_id: "clear" });
  });

  it("entrega repetida não volta a processar a conversa", async () => {
    const { svc } = fakeSvc(() => ({ data: { store_id: "s-maputo", inbound_id: null, is_new: false, chat_enabled: true }, error: null }));
    expect((await handleWhatsAppWebhook({ svc, transport, ...signed(received("menu")) })).inbound).toEqual([]);
  });

  it("sem id do evento → 400", async () => {
    const { svc } = fakeSvc(() => ({ data: null, error: null }));
    const { rawBody, headers } = signed(received("menu"));
    const res = await handleWhatsAppWebhook({ svc, transport, rawBody, headers: { get: (n: string) => (n === "tyxter-webhook-id" ? null : headers.get(n)) } });
    expect(res.status).toBe(400);
  });

  it("número escondido: pede o número uma vez, fora da fila; falhar não trava o webhook", async () => {
    const mock = createMockTransport("seg");
    const hidden = { ...mock, parseWebhook: () => [{ eventId: "wa:msg:h1", event: { kind: "inbound_hidden" as const, providerMessageId: "h1", senderId: "111", userId: "MZ.1349", profileName: null } }] };
    const { svc, calls } = fakeSvc(() => ({ data: true, error: null }));
    const res = await handleWhatsAppWebhook({ svc, transport: hidden, ...signed({ type: "message.received", data: {} }) });
    expect(res.status).toBe(200);
    expect(calls[0]).toEqual(["whatsapp_receipt_once", { p_event_id: "wa:msg:h1", p_sender_id: "111" }]);
    expect(mock.sent[0]).toMatchObject({ type: "request_contact", to: "MZ.1349", senderId: "111" });

    const repeated = fakeSvc(() => ({ data: false, error: null }));
    await handleWhatsAppWebhook({ svc: repeated.svc, transport: hidden, ...signed({ type: "message.received", data: {} }) });
    expect(mock.sent).toHaveLength(1);

    const down = fakeSvc(() => ({ data: null, error: { message: "ainda sem 1126" } }));
    expect((await handleWhatsAppWebhook({ svc: down.svc, transport: hidden, ...signed({ type: "message.received", data: {} }) })).status).toBe(200);
    expect(mock.sent).toHaveLength(1);
  });

  it("aperto de mão GET só com o token certo", () => {
    expect(handleWhatsAppChallenge(transport, new URL("https://x.test/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=seg&hub.challenge=123"))).toEqual({ status: 200, body: "123" });
    expect(handleWhatsAppChallenge(transport, new URL("https://x.test/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=x&hub.challenge=123")).status).toBe(403);
  });

  it("BD em baixo → 503 para o fornecedor repetir", async () => {
    const { svc } = fakeSvc(() => ({ data: null, error: { message: "down" } }));
    const res = await handleWhatsAppWebhook({ svc, transport, ...signed({ type: "message.delivered", data: { message_id: "m" } }) });
    expect(res.status).toBe(503);
  });
});
