/**
 * Testes de integração — cash_sessions (F1.2)
 * Requer `supabase start` + `supabase db reset` antes de correr.
 *
 * Coberturas:
 *   (a) open_cash_session() cria sessão; segunda abertura falha
 *   (b) close_cash_session() calcula expected a partir dos pedidos confirmados
 *   (c) report é imutável: pedidos após o fecho não alteram o snapshot
 *   (d) get_cash_dashboard() devolve stats e histórico corretos
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL  = process.env.SUPABASE_URL  ?? "http://localhost:54531";
const ANON_KEY      = process.env.SUPABASE_ANON_KEY        ?? "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz";

const TEST_EMAIL    = "cash-staff@delivery.test";
const TEST_PASSWORD = "test-staff-pass-123!";

let admin: SupabaseClient; // service role — ignora RLS, mas auth.uid()=null
let staff: SupabaseClient; // utilizador autenticado — auth.uid() funciona
let menuItemId: string;
const ITEM_PRICE = 65000; // Caril de Camarao

beforeAll(async () => {
  admin = createClient(SUPABASE_URL, SERVICE_KEY);

  // Criar utilizador de staff para os testes (auth.uid() funciona em RPCs)
  await admin.auth.admin.createUser({
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
    email_confirm: true,
  });

  // Autenticar como esse utilizador
  staff = createClient(SUPABASE_URL, ANON_KEY);
  const { error: signInErr } = await staff.auth.signInWithPassword({
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  });
  if (signInErr) throw new Error(`Autenticação de teste falhou: ${signInErr.message}`);

  // Obter item do seed para criar pedidos de teste
  const { data: item, error } = await admin
    .from("menu_items")
    .select("id, price_cents")
    .eq("name", "Caril de Camarao")
    .single();

  if (error || !item) throw new Error(`Setup: item não encontrado — ${error?.message}`);
  menuItemId = item.id;
});

afterAll(async () => {
  // Limpar utilizador de teste
  const { data: { users } } = await admin.auth.admin.listUsers();
  const testUser = users?.find((u) => u.email === TEST_EMAIL);
  if (testUser) await admin.auth.admin.deleteUser(testUser.id);
});

// Limpar sessões de caixa após cada suite
afterEach(async () => {
  await admin.from("cash_sessions").delete().neq("id", "00000000-0000-0000-0000-000000000000");
});

// Helper: cria pedido via RPC e confirma via admin
async function createConfirmedOrder(qty = 1): Promise<string> {
  const anon = createClient(SUPABASE_URL, ANON_KEY);
  const { data: orderId, error } = await anon.rpc("create_order", {
    p_payload: {
      items: [{ menuItemId, qty }],
      customerName: "Teste Caixa",
      fulfillmentType: "pickup",
      paymentMethod: "mpesa",
    },
  });
  if (error || !orderId) throw new Error(`create_order falhou: ${error?.message}`);

  // Simular aprovação (advance_order direto via admin para bypassing RLS)
  await admin
    .from("orders")
    .update({ status: "approved", updated_at: new Date().toISOString() })
    .eq("id", orderId);

  return orderId as string;
}

// ─── (a) open + segunda abertura ────────────────────────────────────────────

describe("(a) open_cash_session()", () => {
  it("cria sessão com closed_at null e opened_at preenchido", async () => {
    const { data: sessionId, error } = await staff.rpc("open_cash_session");

    expect(error).toBeNull();
    expect(typeof sessionId).toBe("string");

    const { data: session } = await admin
      .from("cash_sessions")
      .select("*")
      .eq("id", sessionId)
      .single();

    expect(session!.closed_at).toBeNull();
    expect(session!.opened_at).not.toBeNull();
  });

  it("segunda abertura enquanto há sessão aberta → session_already_open", async () => {
    await staff.rpc("open_cash_session");

    const { error } = await staff.rpc("open_cash_session");

    expect(error).not.toBeNull();
    expect(error!.message).toContain("session_already_open");
  });
});

// ─── (b) close_cash_session calcula expected corretamente ───────────────────

describe("(b) close_cash_session()", () => {
  it("expected = soma dos pedidos confirmados no período da sessão", async () => {
    await staff.rpc("open_cash_session");

    // 2 pedidos: qty=2 + qty=1 → 2×65000 + 1×65000 = 195000
    await createConfirmedOrder(2);
    await createConfirmedOrder(1);

    const counted = 200000;

    const { data: report, error } = await staff.rpc("close_cash_session", {
      p_counted_cents: counted,
      p_notes: "Teste automatizado",
    });

    expect(error).toBeNull();
    expect(report.total_faturado_cents).toBe(ITEM_PRICE * 3); // 195000
    expect(report.counted_cash_cents).toBe(counted);
    expect(report.difference_cents).toBe(counted - ITEM_PRICE * 3); // +5000
    expect(report.total_pedidos).toBe(2);
  });

  it("pedidos cancelados NÃO entram no expected", async () => {
    await staff.rpc("open_cash_session");

    await createConfirmedOrder(1); // confirmado

    // Pedido cancelado
    const anon = createClient(SUPABASE_URL, ANON_KEY);
    const { data: cancelId } = await anon.rpc("create_order", {
      p_payload: {
        items: [{ menuItemId, qty: 1 }],
        customerName: "Cancelado",
        fulfillmentType: "pickup",
        paymentMethod: "mpesa",
      },
    });
    await admin
      .from("orders")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", cancelId);

    const { data: report } = await staff.rpc("close_cash_session", {
      p_counted_cents: 0,
    });

    // Só o pedido confirmado entra
    expect(report.total_faturado_cents).toBe(ITEM_PRICE);
    expect(report.total_pedidos).toBe(1);
  });

  it("close sem sessão aberta → auto-abre a sessão e fecha normalmente", async () => {
    // Comportamento intencional desde a migration 20260618000002_cash_auto_open:
    // o dono não precisa clicar "Abrir Sessão" antes — o fecho auto-abre
    // (opened_at = último fecho, ou epoch se nunca houve fecho).
    const { data: report, error } = await staff.rpc("close_cash_session", {
      p_counted_cents: 0,
    });

    expect(error).toBeNull();
    expect(report).toHaveProperty("session_id");
  });
});

// ─── (c) report é imutável ──────────────────────────────────────────────────

describe("(c) imutabilidade do report", () => {
  it("pedidos criados APÓS o fecho não alteram o report congelado", async () => {
    await staff.rpc("open_cash_session");
    await createConfirmedOrder(1);

    const { data: report } = await staff.rpc("close_cash_session", {
      p_counted_cents: 0,
    });

    const totalNoFecho = report.total_faturado_cents as number;
    expect(totalNoFecho).toBe(ITEM_PRICE);

    // Criar pedido APÓS o fecho
    await createConfirmedOrder(2);

    // Buscar a sessão fechada diretamente na BD
    const { data: sessions } = await admin
      .from("cash_sessions")
      .select("report, expected_cash_cents")
      .not("closed_at", "is", null)
      .order("closed_at", { ascending: false })
      .limit(1);

    const saved = sessions![0];
    // O report está congelado — não mudou com o novo pedido
    expect((saved.report as Record<string, unknown>).total_faturado_cents).toBe(totalNoFecho);
    expect(saved.expected_cash_cents).toBe(totalNoFecho);
  });
});

// ─── (d) get_cash_dashboard ─────────────────────────────────────────────────

describe("(d) get_cash_dashboard()", () => {
  it("sem sessão aberta: has_open_session=false, stats do dia", async () => {
    const { data, error } = await staff.rpc("get_cash_dashboard");

    expect(error).toBeNull();
    expect(data.has_open_session).toBe(false);
    expect(data.open_session).toBeNull();
    expect(Array.isArray(data.items_hoje)).toBe(true);
    expect(Array.isArray(data.historico)).toBe(true);
    expect(data.stats).toHaveProperty("total_pedidos");
    expect(data.stats).toHaveProperty("total_faturado_cents");
    expect(data.stats).toHaveProperty("total_entregues");
    expect(data.stats).toHaveProperty("em_aberto_cents");
  });

  it("com sessão aberta: has_open_session=true, open_session.id correto", async () => {
    const { data: sessionId } = await staff.rpc("open_cash_session");

    const { data } = await staff.rpc("get_cash_dashboard");

    expect(data.has_open_session).toBe(true);
    expect(data.open_session.id).toBe(sessionId);
  });

  it("histórico lista os fechos anteriores", async () => {
    await staff.rpc("open_cash_session");
    await staff.rpc("close_cash_session", { p_counted_cents: 99999 });

    const { data } = await staff.rpc("get_cash_dashboard");

    expect(data.historico.length).toBeGreaterThan(0);
    const lastClose = data.historico[0];
    expect(lastClose).toHaveProperty("id");
    expect(lastClose).toHaveProperty("closed_at");
    expect(lastClose.counted_cash_cents).toBe(99999);
  });
});
