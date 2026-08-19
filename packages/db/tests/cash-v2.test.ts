/**
 * Gate de integração da F5 contra o Supabase de teste/staging.
 * Cobre caixa por loja, movimentos, auditoria e período desde o último fecho.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://localhost:54731";
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz";

let admin: SupabaseClient;
let manager: SupabaseClient;
let owner: SupabaseClient;
let managerUserId: string;
let ownerUserId: string;
let maputoStoreId: string;
let matolaStoreId: string;
const createdOrderIds: string[] = [];
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

beforeAll(async () => {
  admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: stores, error: storesError } = await admin
    .from("stores")
    .select("id,slug")
    .in("slug", ["maputo", "matola"]);
  if (storesError || stores?.length !== 2) {
    throw new Error(`Setup caixa: lojas — ${storesError?.message}`);
  }
  maputoStoreId = stores.find((store) => store.slug === "maputo")!.id;
  matolaStoreId = stores.find((store) => store.slug === "matola")!.id;

  const email = `cash-manager-${suffix}@delivery.test`;
  const password = "Caixa-F5-Teste-2026!";
  const { data: user, error: userError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (userError || !user.user) throw new Error(`Setup caixa: utilizador — ${userError?.message}`);
  managerUserId = user.user.id;

  const { error: profileError } = await admin.from("staff_profiles").insert({
    user_id: managerUserId,
    full_name: "Gerente Caixa F5",
    role: "manager",
    active: true,
  });
  if (profileError) throw new Error(`Setup caixa: perfil — ${profileError.message}`);

  const { error: accessError } = await admin.from("staff_stores").insert({
    user_id: managerUserId,
    store_id: maputoStoreId,
  });
  if (accessError) throw new Error(`Setup caixa: acesso — ${accessError.message}`);

  manager = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: loginError } = await manager.auth.signInWithPassword({ email, password });
  if (loginError) throw new Error(`Setup caixa: login — ${loginError.message}`);

  const ownerEmail = `cash-owner-${suffix}@delivery.test`;
  const { data: ownerUser, error: ownerError } = await admin.auth.admin.createUser({
    email: ownerEmail,
    password,
    email_confirm: true,
  });
  if (ownerError || !ownerUser.user) throw new Error(`Setup caixa: dono — ${ownerError?.message}`);
  ownerUserId = ownerUser.user.id;
  const { error: ownerProfileError } = await admin.from("staff_profiles").insert({
    user_id: ownerUserId,
    full_name: "Dono Caixa F5",
    role: "owner",
    active: true,
  });
  if (ownerProfileError) throw new Error(`Setup caixa: perfil dono — ${ownerProfileError.message}`);
  owner = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: ownerLoginError } = await owner.auth.signInWithPassword({
    email: ownerEmail,
    password,
  });
  if (ownerLoginError) throw new Error(`Setup caixa: login dono — ${ownerLoginError.message}`);
});

beforeEach(async () => {
  await admin.from("cash_movements").delete().in("store_id", [maputoStoreId, matolaStoreId]);
  await admin.from("cash_sessions").delete().in("store_id", [maputoStoreId, matolaStoreId]);
  await admin.from("settings").update({ cash_diff_tolerance_cents: 1000 }).eq("id", 1);
});

afterEach(async () => {
  if (createdOrderIds.length > 0) {
    await admin.from("event_log").delete().in("order_id", createdOrderIds);
    await admin.from("orders").delete().in("id", createdOrderIds);
    createdOrderIds.length = 0;
  }
  await admin.from("event_log").delete().eq("actor_user_id", managerUserId);
});

afterAll(async () => {
  if (!admin) return;
  await admin.from("cash_movements").delete().in("store_id", [maputoStoreId, matolaStoreId]);
  await admin.from("cash_sessions").delete().in("store_id", [maputoStoreId, matolaStoreId]);
  if (managerUserId) await admin.auth.admin.deleteUser(managerUserId);
  if (ownerUserId) await admin.auth.admin.deleteUser(ownerUserId);
});

async function createPaidOrder(input: {
  amountCents: number;
  method: "cash" | "mpesa" | "emola" | "credit_card";
  createdAt?: string;
  storeId?: string;
}) {
  const storeId = input.storeId ?? maputoStoreId;
  const orderNumber = `F5-${suffix}-${createdOrderIds.length + 1}`;
  const { data: order, error: orderError } = await admin
    .from("orders")
    .insert({
      store_id: storeId,
      order_number: orderNumber,
      status: "paid",
      flow: "manual",
      channel: "counter",
      fulfillment_type: "pickup",
      customer_name: "Teste Caixa F5",
      subtotal_cents: input.amountCents,
      delivery_fee_cents: 0,
      discount_cents: 0,
      total_cents: input.amountCents,
      payment_method: input.method,
      ...(input.createdAt ? { created_at: input.createdAt, updated_at: input.createdAt } : {}),
    })
    .select("id")
    .single();
  if (orderError || !order) throw new Error(`Criar venda caixa — ${orderError?.message}`);
  createdOrderIds.push(order.id);

  const { error: paymentError } = await admin.from("payments").insert({
    order_id: order.id,
    store_id: storeId,
    provider: "counter",
    method: input.method,
    amount_cents: input.amountCents,
    status: "confirmed",
    idempotency_key: `f5:${suffix}:${createdOrderIds.length}`,
    ...(input.createdAt ? { created_at: input.createdAt } : {}),
  });
  if (paymentError) throw new Error(`Criar pagamento caixa — ${paymentError.message}`);
  return order.id;
}

describe("F5 — caixa por loja e turno", () => {
  it("abre uma sessão por loja com fundo, turno e auditoria", async () => {
    const { data: sessionId, error } = await manager.rpc("open_cash_session", {
      p_store: maputoStoreId,
      p_float: 5000,
    });
    expect(error).toBeNull();

    const { data: session } = await admin
      .from("cash_sessions")
      .select("store_id,shift_label,opening_float_cents,opened_by,closed_at")
      .eq("id", sessionId)
      .single();
    expect(session).toMatchObject({
      store_id: maputoStoreId,
      opening_float_cents: 5000,
      opened_by: managerUserId,
      closed_at: null,
    });
    expect(session?.shift_label).toMatch(/turno/i);

    const { data: audit } = await admin
      .from("event_log")
      .select("store_id,actor_user_id,payload")
      .eq("type", "cash.session_opened")
      .eq("actor_user_id", managerUserId)
      .single();
    expect(audit).toMatchObject({ store_id: maputoStoreId, actor_user_id: managerUserId });
    expect(audit?.payload).toMatchObject({ session_id: sessionId, opening_float_cents: 5000 });

    const { error: duplicateError } = await manager.rpc("open_cash_session", {
      p_store: maputoStoreId,
      p_float: 0,
    });
    expect(duplicateError?.message).toContain("session_already_open");
  });

  it("recusa operações numa loja sem acesso", async () => {
    const { error } = await manager.rpc("open_cash_session", {
      p_store: matolaStoreId,
      p_float: 0,
    });
    expect(error?.message).toContain("store_access_denied");
  });

  it("calcula fundo + dinheiro − sangria + reforço − despesa e separa pagamentos digitais", async () => {
    await manager.rpc("open_cash_session", { p_store: maputoStoreId, p_float: 5000 });
    await createPaidOrder({ amountCents: 30000, method: "cash" });
    await createPaidOrder({ amountCents: 20000, method: "mpesa" });

    for (const movement of [
      { type: "sangria", amount: 5000, reason: "Depósito no cofre" },
      { type: "reforco", amount: 2000, reason: "Trocos adicionais" },
      { type: "despesa", amount: 1000, reason: "Compra urgente" },
    ]) {
      const { error } = await manager.rpc("add_cash_movement", {
        p_store: maputoStoreId,
        p_type: movement.type,
        p_amount_cents: movement.amount,
        p_reason: movement.reason,
      });
      expect(error).toBeNull();
    }

    const { data: report, error } = await manager.rpc("close_cash_session", {
      p_store: maputoStoreId,
      p_counted: 31000,
      p_reason: null,
    });
    expect(error).toBeNull();
    expect(report).toMatchObject({
      opening_float_cents: 5000,
      cash_sales_cents: 30000,
      sangria_cents: 5000,
      reforco_cents: 2000,
      despesa_cents: 1000,
      expected_cash_cents: 31000,
      counted_cash_cents: 31000,
      difference_cents: 0,
    });
    expect(report.payments).toMatchObject({ cash: 30000, mpesa: 20000 });

    const { data: printJob } = await admin
      .from("print_jobs")
      .select("store_id,order_id,request_id,station,kind,status,payload")
      .eq("store_id", maputoStoreId)
      .eq("request_id", report.session_id)
      .eq("kind", "cash_close")
      .single();
    expect(printJob).toMatchObject({
      store_id: maputoStoreId,
      order_id: null,
      request_id: report.session_id,
      station: "counter",
      kind: "cash_close",
      status: "queued",
    });
    expect(printJob?.payload).toMatchObject({
      template: "cash_close",
      shift_label: report.shift_label,
      expected_cash_cents: 31000,
      difference_cents: 0,
    });

    const { count: movementAudits } = await admin
      .from("event_log")
      .select("id", { count: "exact", head: true })
      .eq("type", "cash.movement_added")
      .eq("actor_user_id", managerUserId)
      .eq("store_id", maputoStoreId);
    expect(movementAudits).toBe(3);
  });

  it("exige motivo quando a diferença supera a tolerância", async () => {
    await manager.rpc("open_cash_session", { p_store: maputoStoreId, p_float: 10000 });

    const { error } = await manager.rpc("close_cash_session", {
      p_store: maputoStoreId,
      p_counted: 11001,
      p_reason: null,
    });
    expect(error?.message).toContain("difference_reason_required");

    const { data: report, error: justifiedError } = await manager.rpc("close_cash_session", {
      p_store: maputoStoreId,
      p_counted: 11001,
      p_reason: "Sobra confirmada na contagem",
    });
    expect(justifiedError).toBeNull();
    expect(report).toMatchObject({
      difference_cents: 1001,
      difference_reason: "Sobra confirmada na contagem",
    });
  });

  it("inclui vendas feitas depois do último fecho e antes da abertura seguinte", async () => {
    const lastClose = new Date(Date.now() - 120_000).toISOString();
    const saleTime = new Date(Date.now() - 60_000).toISOString();
    await admin.from("cash_sessions").insert({
      store_id: maputoStoreId,
      shift_label: "Turno anterior",
      opening_float_cents: 0,
      opened_at: new Date(Date.now() - 180_000).toISOString(),
      closed_at: lastClose,
      expected_cash_cents: 0,
      counted_cash_cents: 0,
      difference_cents: 0,
      report: {},
    });
    await createPaidOrder({ amountCents: 15000, method: "cash", createdAt: saleTime });

    await manager.rpc("open_cash_session", { p_store: maputoStoreId, p_float: 0 });
    const { data: report, error } = await manager.rpc("close_cash_session", {
      p_store: maputoStoreId,
      p_counted: 15000,
      p_reason: null,
    });

    expect(error).toBeNull();
    expect(new Date(report.period_start).toISOString()).toBe(lastClose);
    expect(report).toMatchObject({ cash_sales_cents: 15000, expected_cash_cents: 15000 });
  });

  it("painel limita o gerente à sua loja e recusa a Matola", async () => {
    await manager.rpc("open_cash_session", { p_store: maputoStoreId, p_float: 5000 });
    await createPaidOrder({ amountCents: 30000, method: "cash" });

    const { data: dashboard, error } = await manager.rpc("get_cash_dashboard", {
      p_store: maputoStoreId,
    });
    expect(error).toBeNull();
    expect(dashboard.stores).toHaveLength(1);
    expect(dashboard.stores[0]).toMatchObject({
      store_id: maputoStoreId,
      cash_sales_cents: 30000,
      expected_cash_cents: 35000,
    });

    const { error: denied } = await manager.rpc("get_cash_dashboard", {
      p_store: matolaStoreId,
    });
    expect(denied?.message).toContain("store_access_denied");
  });

  it("painel do dono consolida Maputo e Matola sem misturar as linhas", async () => {
    await owner.rpc("open_cash_session", { p_store: maputoStoreId, p_float: 5000 });
    await owner.rpc("open_cash_session", { p_store: matolaStoreId, p_float: 10000 });
    await createPaidOrder({ amountCents: 30000, method: "cash", storeId: maputoStoreId });
    await createPaidOrder({ amountCents: 20000, method: "mpesa", storeId: matolaStoreId });

    const { data: dashboard, error } = await owner.rpc("get_cash_dashboard");
    expect(error).toBeNull();
    expect(dashboard.stores).toHaveLength(2);
    expect(dashboard.stores.map((store: { store_id: string }) => store.store_id).sort()).toEqual(
      [maputoStoreId, matolaStoreId].sort(),
    );
    expect(dashboard.consolidated).toMatchObject({
      total_faturado_cents: 50000,
      cash_sales_cents: 30000,
      mpesa_cents: 20000,
      expected_cash_cents: 45000,
    });
  });
});
