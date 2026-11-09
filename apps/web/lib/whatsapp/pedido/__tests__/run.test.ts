import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createMockTransport } from "@delivery/whatsapp";
import { processInbound } from "../run";
import { catalogue, ID } from "./fixtures";

const CONV = "a0000000-0000-4000-8000-000000000001";

/** BD de faz-de-conta só com o que o orquestrador usa. */
function fakeDb(inbound: Record<string, unknown>) {
  const db = { state: {} as unknown, version: 0, outbox: new Map<string, { id: string; payload: unknown; status: string }>(), finished: [] as Array<string | null>, claims: 0 };
  const rpc = vi.fn(async (name: string, args: Record<string, any>) => {
    switch (name) {
      case "whatsapp_inbound_claim": db.claims++; return { data: [inbound], error: null };
      case "whatsapp_inbound_finish": db.finished.push(args.p_error); return { data: null, error: null };
      case "whatsapp_conversation_get": return { data: { id: CONV, state: db.state, version: db.version }, error: null };
      case "whatsapp_conversation_save":
        if (args.p_version !== db.version) return { data: false, error: null };
        db.state = JSON.parse(JSON.stringify(args.p_state)); db.version++; return { data: true, error: null };
      case "whatsapp_enqueue_session": {
        const ids = (args.p_messages as unknown[]).map((payload, i) => {
          const key = `${args.p_key_prefix}:${i + 1}`;
          if (!db.outbox.has(key)) db.outbox.set(key, { id: `out-${db.outbox.size + 1}`, payload, status: "queued" });
          return db.outbox.get(key)!.id;
        });
        return { data: ids, error: null };
      }
      case "whatsapp_claim_ids": {
        const rows = [...db.outbox.values()].filter((r) => (args.p_ids as string[]).includes(r.id) && r.status === "queued");
        rows.forEach((r) => { r.status = "sending"; });
        return { data: rows.map((r) => ({ id: r.id, store_id: "s1", event: "chat.reply", recipient: "+258841234567", vars: {}, kind: "service", payload: r.payload })), error: null };
      }
      case "whatsapp_finish": {
        const row = [...db.outbox.values()].find((r) => r.id === args.p_id);
        if (row) row.status = args.p_ok ? "accepted" : "queued";
        return { data: args.p_ok ? "accepted" : "retry", error: null };
      }
      default: return { data: null, error: { message: `rpc ${name} inesperado` } };
    }
  });
  const from = vi.fn((table: string) => ({
    select: () => ({
      eq: () => ({ single: async () => ({ data: { id: "s1", slug: "loja-teste", whatsapp_chat_enabled: true, whatsapp_handoff_phone: null }, error: null }) }),
      in: async () => ({ data: [{ id: "s1", whatsapp_sender_id: "wpn_1" }], error: null }),
    }),
    table,
  }));
  return { db, svc: { rpc, from } as unknown as SupabaseClient };
}

describe("processar uma mensagem recebida", () => {
  const inbound = { id: ID.inbound, store_id: "s1", from_phone: "+258841234567", content_type: "text", body: "olá", reply_id: null, media_id: null, media_mime: null, profile_name: "Ana" };

  it("responde pelo número da loja, grava o estado e marca a mensagem processada", async () => {
    const { db, svc } = fakeDb(inbound);
    const transport = createMockTransport();
    const outcome = await processInbound({ svc, transport, baseUrl: "https://loja.test", loadCatalogue: async () => catalogue() }, ID.inbound);
    expect(outcome).toBe("done");
    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]).toMatchObject({ senderId: "wpn_1", to: "+258841234567", type: "list" });
    expect(db.version).toBe(1);
    expect(db.state).toMatchObject({ lastInboundId: ID.inbound });
    expect(db.finished).toEqual([null]);
  });

  it("reprocessar a mesma mensagem não avança o estado nem duplica respostas", async () => {
    const { db, svc } = fakeDb(inbound);
    const transport = createMockTransport();
    const deps = { svc, transport, baseUrl: "https://loja.test", loadCatalogue: async () => catalogue() };
    await processInbound(deps, ID.inbound);
    await processInbound(deps, ID.inbound);
    expect(db.version).toBe(1);
    expect(db.outbox.size).toBe(1);
    expect(transport.sent).toHaveLength(1);
  });

  it("catálogo indisponível → mensagem marcada com erro para o cron tentar de novo, sem rebentar", async () => {
    const { db, svc } = fakeDb(inbound);
    const outcome = await processInbound({ svc, transport: createMockTransport(), baseUrl: "https://loja.test", loadCatalogue: async () => { throw new Error("menu_down"); } }, ID.inbound);
    expect(outcome).toBe("failed");
    expect(db.finished).toEqual(["menu_down"]);
  });
});
