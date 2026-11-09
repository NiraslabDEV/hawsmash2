import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { renderWhatsAppEvent } from "@/lib/whatsapp/events";
import type { SystemAlert } from "../digest";
import { alertJobs, alertPhones, digestJobs, enqueueOwnerMessages } from "../whatsapp";

const NOW = Date.UTC(2026, 10, 5, 18, 0, 0);
const alert: SystemAlert = { store_id: "s1", store_name: "Loja A", kind: "print_failed", severity: "critical", message: "A impressora da cozinha falhou" };
const phones = new Map([["s1", ["+258841111111", "+258842222222"]]]);

describe("alertas por WhatsApp", () => {
  it("um por telefone da loja do alerta; loja sem telefones não gera nada", () => {
    const jobs = alertJobs([alert, { ...alert, store_id: "s2", store_name: "Loja B" }], phones, NOW);
    expect(jobs.map((j) => j.recipient)).toEqual(["+258841111111", "+258842222222"]);
    expect(jobs[0]).toMatchObject({ storeId: "s1", event: "alert.system", subjectType: "alert" });
  });

  it("o que se enfileira é o que o template precisa", () => {
    const [job] = alertJobs([alert], phones, NOW);
    expect(renderWhatsAppEvent(job.event, job.vars)).toMatchObject({
      template: "hs_alerta_loja",
      variables: { loja: "Loja A", alerta: "Impressão falhada", detalhe: "A impressora da cozinha falhou" },
    });
  });

  it("dentro da mesma janela a chave repete (não duplica); na janela seguinte muda", () => {
    const key = (ms: number) => alertJobs([alert], phones, ms)[0].idempotencyKey;
    expect(key(NOW + 60_000)).toBe(key(NOW));
    expect(key(NOW + 31 * 60_000)).not.toBe(key(NOW));
    // Dois telemóveis nunca partilham a chave: o segundo não pode cair por "já existe".
    const [a, b] = alertJobs([alert], phones, NOW);
    expect(a.idempotencyKey).not.toBe(b.idempotencyKey);
    expect(a.idempotencyKey.length).toBeLessThanOrEqual(200);
  });
});

describe("resumo do dia por WhatsApp", () => {
  const line = { store_id: "s1", store_name: "Loja A", orders_count: 42, revenue_cents: 2845000 };
  it("um por telefone, um por dia, com o total do servidor", () => {
    const [job, second] = digestJobs("2026-11-05", [line], phones, NOW);
    expect(second.recipient).toBe("+258842222222");
    expect(job.idempotencyKey).toBe("digest:s1:2026-11-05:+258841111111");
    const rendered = renderWhatsAppEvent(job.event, job.vars);
    expect(rendered?.template).toBe("hs_resumo_diario");
    expect(rendered?.variables).toMatchObject({ dia: "2026-11-05", loja: "Loja A", pedidos: "42" });
    expect(rendered?.variables?.total).toMatch(/28.?450 MT/);
  });
  it("dia sem vendas também sai: zero é informação", () => {
    const [job] = digestJobs("2026-11-05", [{ ...line, orders_count: 0, revenue_cents: 0 }], phones, NOW);
    expect(renderWhatsAppEvent(job.event, job.vars)?.variables?.pedidos).toBe("0");
  });
});

describe("nunca atrapalha o email", () => {
  const svc = (rpc: unknown, stores: { data: unknown; error: unknown } = { data: [], error: null }) => ({
    rpc,
    from: () => ({ select: () => ({ in: async () => stores }) }),
  }) as unknown as SupabaseClient;

  it("BD sem a coluna da 1126: sem telefones e sem erro", async () => {
    const out = await alertPhones(svc(vi.fn(), { data: null, error: { message: "column does not exist" } }), ["s1"]);
    expect(out.size).toBe(0);
  });

  it("lê os telefones por loja, sem consulta quando não há lojas", async () => {
    const out = await alertPhones(svc(vi.fn(), { data: [{ id: "s1", whatsapp_alert_phones: ["+258841111111"] }, { id: "s2", whatsapp_alert_phones: [] }], error: null }), ["s1", "s2"]);
    expect([...out.keys()]).toEqual(["s1"]);
    expect((await alertPhones(svc(vi.fn()), [])).size).toBe(0);
  });

  it("conta só o que entrou; erro ou excepção numa linha não pára as outras", async () => {
    const jobs = alertJobs([alert], phones, NOW);
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: "id-1", error: null })
      .mockRejectedValueOnce(new Error("rede"));
    expect(await enqueueOwnerMessages(svc(rpc), jobs)).toBe(1);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[0][0]).toBe("whatsapp_enqueue");
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_kind: "utility", p_recipient: "+258841111111", p_subject_type: "alert" });
    // Loja sem WhatsApp ligado: a RPC devolve null, não conta.
    expect(await enqueueOwnerMessages(svc(vi.fn().mockResolvedValue({ data: null, error: null })), jobs.slice(0, 1))).toBe(0);
  });
});
