/**
 * Gate de integração do fecho do dia (1091) contra o Supabase de teste.
 *
 * Turno fecha → a pessoa seguinte abre o seu → fecha → no fim, o fecho do dia
 * junta os turnos fechados desde o último fecho do dia: soma o que cada turno
 * congelou, diz quem abriu e fechou cada um, imprime e fica auditado.
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
let cashier: SupabaseClient;
let kitchen: SupabaseClient;
let managerUserId: string;
let cashierUserId: string;
let kitchenUserId: string;
let maputoStoreId: string;
let matolaStoreId: string;
const createdOrderIds: string[] = [];
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const password = "Fecho-Dia-Teste-2026!";

async function createStaff(role: "manager" | "cashier" | "kitchen", fullName: string) {
  const email = `cash-day-${role}-${suffix}@delivery.test`;
  const { data: user, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !user.user) throw new Error(`Setup fecho do dia: ${role} — ${error?.message}`);
  const userId = user.user.id;

  const { error: profileError } = await admin.from("staff_profiles").insert({
    user_id: userId,
    full_name: fullName,
    role,
    active: true,
  });
  if (profileError) throw new Error(`Setup fecho do dia: perfil ${role} — ${profileError.message}`);

  const { error: accessError } = await admin.from("staff_stores").insert({
    user_id: userId,
    store_id: maputoStoreId,
  });
  if (accessError) throw new Error(`Setup fecho do dia: acesso ${role} — ${accessError.message}`);

  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: loginError } = await client.auth.signInWithPassword({ email, password });
  if (loginError) throw new Error(`Setup fecho do dia: login ${role} — ${loginError.message}`);
  return { client, userId };
}

async function cleanCash() {
  await admin.from("print_jobs").delete().eq("kind", "cash_close").in("store_id", [maputoStoreId, matolaStoreId]);
  await admin.from("cash_movements").delete().in("store_id", [maputoStoreId, matolaStoreId]);
  await admin.from("cash_sessions").delete().in("store_id", [maputoStoreId, matolaStoreId]);
  await admin.from("cash_day_closes").delete().in("store_id", [maputoStoreId, matolaStoreId]);
}

beforeAll(async () => {
  admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: stores, error: storesError } = await admin
    .from("stores")
    .select("id,slug")
    .in("slug", ["maputo", "matola"]);
  if (storesError || stores?.length !== 2) {
    throw new Error(`Setup fecho do dia: lojas — ${storesError?.message}`);
  }
  maputoStoreId = stores.find((store) => store.slug === "maputo")!.id;
  matolaStoreId = stores.find((store) => store.slug === "matola")!.id;

  ({ client: manager, userId: managerUserId } = await createStaff("manager", "Gerente Dia"));
  ({ client: cashier, userId: cashierUserId } = await createStaff("cashier", "Caixa Dia"));
  ({ client: kitchen, userId: kitchenUserId } = await createStaff("kitchen", "Cozinha Dia"));
});

beforeEach(async () => {
  await cleanCash();
  await admin.from("settings").update({ cash_diff_tolerance_cents: 1000 }).eq("id", 1);
});

afterEach(async () => {
  if (createdOrderIds.length > 0) {
    await admin.from("event_log").delete().in("order_id", createdOrderIds);
    await admin.from("payments").delete().in("order_id", createdOrderIds);
    await admin.from("orders").delete().in("id", createdOrderIds);
    createdOrderIds.length = 0;
  }
  await admin
    .from("event_log")
    .delete()
    .in("actor_user_id", [managerUserId, cashierUserId, kitchenUserId]);
});

afterAll(async () => {
  if (!admin) return;
  await cleanCash();
  for (const userId of [managerUserId, cashierUserId, kitchenUserId]) {
    if (userId) await admin.auth.admin.deleteUser(userId);
  }
});

async function createPaidOrder(amountCents: number, method: "cash" | "mpesa" | "emola" | "credit_card") {
  const orderNumber = `DIA-${suffix}-${createdOrderIds.length + 1}`;
  const { data: order, error: orderError } = await admin
    .from("orders")
    .insert({
      store_id: maputoStoreId,
      order_number: orderNumber,
      status: "paid",
      flow: "manual",
      channel: "counter",
      fulfillment_type: "pickup",
      customer_name: "Teste Fecho do Dia",
      subtotal_cents: amountCents,
      delivery_fee_cents: 0,
      discount_cents: 0,
      total_cents: amountCents,
      payment_method: method,
    })
    .select("id")
    .single();
  if (orderError || !order) throw new Error(`Criar venda — ${orderError?.message}`);
  createdOrderIds.push(order.id);

  const { error: paymentError } = await admin.from("payments").insert({
    order_id: order.id,
    store_id: maputoStoreId,
    provider: "counter",
    method,
    amount_cents: amountCents,
    status: "confirmed",
    idempotency_key: `dia:${suffix}:${createdOrderIds.length}`,
  });
  if (paymentError) throw new Error(`Criar pagamento — ${paymentError.message}`);
}

async function openShift(client: SupabaseClient, floatCents: number) {
  const { error } = await client.rpc("open_cash_session", { p_store: maputoStoreId, p_float: floatCents });
  expect(error).toBeNull();
}

async function closeShift(client: SupabaseClient, countedCents: number, reason: string | null = null) {
  const { data, error } = await client.rpc("close_cash_session", {
    p_store: maputoStoreId,
    p_counted: countedCents,
    p_reason: reason,
  });
  expect(error).toBeNull();
  return data as { session_id: string; difference_cents: number };
}

async function closeDay(client: SupabaseClient, requestId: string = crypto.randomUUID()) {
  return client.rpc("close_cash_day", { p_store: maputoStoreId, p_request_id: requestId });
}

type DayReport = {
  day_close_id: string;
  business_date: string;
  shifts_count: number;
  total_pedidos: number;
  total_faturado_cents: number;
  payments: { cash: number; mpesa: number; emola: number; credit_card: number };
  cash_sales_cents: number;
  despesa_cents: number;
  difference_cents: number;
  opening_float_cents: number;
  closing_cash_cents: number;
  closed_by_name: string | null;
  duplicate?: boolean;
  shifts: Array<{
    session_id: string;
    opened_by_name: string | null;
    closed_by_name: string | null;
    difference_cents: number;
    total_pedidos: number;
  }>;
};

const maputoToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Maputo" });

describe("1091 — fecho do dia", () => {
  it("junta os turnos de duas pessoas, soma o dia, imprime e audita", async () => {
    // Turno 1: o gerente abre com 50 MT, vende 300 MT em dinheiro e 200 MT em M-Pesa.
    await openShift(manager, 5000);
    await createPaidOrder(30000, "cash");
    await createPaidOrder(20000, "mpesa");
    const turno1 = await closeShift(manager, 35000);
    expect(turno1.difference_cents).toBe(0);

    // Troca de turno: a caixa abre o seu, vende 100 MT, paga 20 MT de despesa
    // e conta 5 MT a menos (dentro da tolerância).
    await openShift(cashier, 5000);
    await createPaidOrder(10000, "cash");
    const { error: despesaError } = await cashier.rpc("add_cash_movement", {
      p_store: maputoStoreId,
      p_type: "despesa",
      p_amount_cents: 2000,
      p_reason: "Gelo",
    });
    expect(despesaError).toBeNull();
    const turno2 = await closeShift(cashier, 12500);
    expect(turno2.difference_cents).toBe(-500);

    const { data: preview, error: previewError } = await cashier.rpc("get_cash_day", { p_store: maputoStoreId });
    expect(previewError).toBeNull();
    expect(preview.open_session).toBeNull();
    expect(preview.pending).toMatchObject({ shifts_count: 2, total_faturado_cents: 60000, difference_cents: -500 });

    const requestId = crypto.randomUUID();
    const { data, error } = await closeDay(cashier, requestId);
    expect(error).toBeNull();
    const report = data as DayReport;
    expect(report).toMatchObject({
      business_date: maputoToday(),
      shifts_count: 2,
      total_pedidos: 3,
      total_faturado_cents: 60000,
      payments: { cash: 40000, mpesa: 20000, emola: 0, credit_card: 0 },
      cash_sales_cents: 40000,
      despesa_cents: 2000,
      difference_cents: -500,
      opening_float_cents: 5000,
      closing_cash_cents: 12500,
      closed_by_name: "Caixa Dia",
    });
    expect(report.shifts.map((shift) => [shift.opened_by_name, shift.closed_by_name])).toEqual([
      ["Gerente Dia", "Gerente Dia"],
      ["Caixa Dia", "Caixa Dia"],
    ]);
    expect(report.shifts.map((shift) => shift.session_id)).toEqual([turno1.session_id, turno2.session_id]);

    const { data: row } = await admin
      .from("cash_day_closes")
      .select("id,store_id,closed_by,request_id")
      .eq("id", report.day_close_id)
      .single();
    expect(row).toMatchObject({ store_id: maputoStoreId, closed_by: cashierUserId, request_id: requestId });

    const { data: sessions } = await admin
      .from("cash_sessions")
      .select("id,day_close_id")
      .in("id", [turno1.session_id, turno2.session_id]);
    expect(sessions?.every((session) => session.day_close_id === report.day_close_id)).toBe(true);

    const { data: audit } = await admin
      .from("event_log")
      .select("store_id,actor_user_id,payload")
      .eq("type", "cash.day_closed")
      .eq("actor_user_id", cashierUserId)
      .single();
    expect(audit).toMatchObject({ store_id: maputoStoreId });
    expect(audit?.payload).toMatchObject({ day_close_id: report.day_close_id, shifts_count: 2 });

    // O papel: um fecho de caixa com o dia dentro, legível pelo bridge antigo.
    const { data: job } = await admin
      .from("print_jobs")
      .select("station,kind,payload")
      .eq("store_id", maputoStoreId)
      .eq("request_id", report.day_close_id)
      .single();
    expect(job).toMatchObject({ station: "counter", kind: "cash_close" });
    expect(job?.payload).toMatchObject({
      template: "cash_close",
      day: true,
      counted_cash_cents: 12500,
      expected_cash_cents: 13000,
      difference_cents: -500,
    });
    expect(job?.payload.shift_label).toMatch(/^FECHO DO DIA .* - 2 turnos$/);
    expect(job?.payload.shifts).toHaveLength(2);
  });

  it("um turno aberto trava o fecho do dia", async () => {
    await openShift(manager, 0);
    const { error } = await closeDay(manager);
    expect(error?.message).toContain("session_open");
  });

  it("sem turnos fechados não há fecho do dia", async () => {
    const { error } = await closeDay(manager);
    expect(error?.message).toContain("no_shifts_to_close");
  });

  it("repetir o pedido devolve o mesmo fecho, sem segundo papel", async () => {
    await openShift(manager, 0);
    await closeShift(manager, 0);
    const requestId = crypto.randomUUID();

    const first = await closeDay(manager, requestId);
    const second = await closeDay(manager, requestId);
    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    expect((second.data as DayReport).day_close_id).toBe((first.data as DayReport).day_close_id);
    expect((second.data as DayReport).duplicate).toBe(true);

    const { count: days } = await admin
      .from("cash_day_closes")
      .select("id", { count: "exact", head: true })
      .eq("store_id", maputoStoreId);
    expect(days).toBe(1);
    const { count: jobs } = await admin
      .from("print_jobs")
      .select("id", { count: "exact", head: true })
      .eq("store_id", maputoStoreId)
      .eq("request_id", (first.data as DayReport).day_close_id);
    expect(jobs).toBe(1);

    // Um pedido novo, sem turnos novos, não fecha o mesmo dia duas vezes.
    const again = await closeDay(manager);
    expect(again.error?.message).toContain("no_shifts_to_close");
  });

  it("o fecho seguinte só leva os turnos novos", async () => {
    await openShift(manager, 0);
    await closeShift(manager, 0);
    const first = await closeDay(manager);
    expect(first.error).toBeNull();

    await openShift(cashier, 0);
    const turnoNovo = await closeShift(cashier, 0);
    const second = await closeDay(cashier);
    expect(second.error).toBeNull();
    const report = second.data as DayReport;
    expect(report.shifts_count).toBe(1);
    expect(report.shifts[0]?.session_id).toBe(turnoNovo.session_id);
  });

  it("isola a loja e deixa a cozinha de fora", async () => {
    const { error: closeMatola } = await manager.rpc("close_cash_day", {
      p_store: matolaStoreId,
      p_request_id: crypto.randomUUID(),
    });
    expect(closeMatola?.message).toContain("store_access_denied");
    const { error: previewMatola } = await manager.rpc("get_cash_day", { p_store: matolaStoreId });
    expect(previewMatola?.message).toContain("store_access_denied");

    const { error: kitchenClose } = await closeDay(kitchen);
    expect(kitchenClose?.message).toContain("cash_access_denied");
    const { error: kitchenPreview } = await kitchen.rpc("get_cash_day", { p_store: maputoStoreId });
    expect(kitchenPreview?.message).toContain("cash_access_denied");

    await openShift(manager, 0);
    await closeShift(manager, 0);
    expect((await closeDay(manager)).error).toBeNull();
    const { error: matolaInsertError } = await admin.from("cash_day_closes").insert({
      store_id: matolaStoreId,
      business_date: maputoToday(),
      request_id: crypto.randomUUID(),
      report: {},
    });
    expect(matolaInsertError).toBeNull();

    const { data: visible } = await manager.from("cash_day_closes").select("store_id");
    expect(visible?.length).toBeGreaterThan(0);
    expect(visible?.every((row) => row.store_id === maputoStoreId)).toBe(true);

    const { data: kitchenRows } = await kitchen.from("cash_day_closes").select("id");
    expect(kitchenRows).toEqual([]);
  });
});
