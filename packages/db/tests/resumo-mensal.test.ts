/**
 * Gate de integração do resumo mensal (1096) contra o Supabase de teste.
 *
 * O que isto tranca:
 *   (a) o mês conta no fuso de Maputo — 00h30 de dia 1 em Maputo ainda é o dia
 *       anterior em UTC, e é do mês novo;
 *   (b) só os estados que contam como venda entram no facturado; anulados à parte;
 *   (c) a porta do resumo é só do cron (chave de serviço) — nem anónimo nem equipa;
 *   (d) a fotografia do Google é da loja: a Matola não lê a de Maputo, e ninguém
 *       no painel a escreve;
 *   (e) o Place ID muda-se só pelo dono, validado e registado.
 *
 * Usa Março de 2020: nenhum outro teste nem o seed cria pedidos nesse mês.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://localhost:54731";
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz";

type MonthlyStore = {
  store_id: string;
  orders_count: number;
  revenue_cents: number;
  previous_orders_count: number;
  previous_revenue_cents: number;
  cancelled_count: number;
  channels: Record<string, { orders: number; revenue_cents: number }>;
  payments: Record<string, number>;
  top_items: Array<{ name: string; qty: number; total_cents: number }>;
  google_place_id: string | null;
  google_snapshot: { review_count: number | null } | null;
  google_previous: { review_count: number | null } | null;
};

let admin: SupabaseClient;
let anon: SupabaseClient;
let owner: SupabaseClient;
let maputoManager: SupabaseClient;
let matolaManager: SupabaseClient;
let maputoStoreId: string;
let matolaStoreId: string;
let originalPlaceId: string | null = null;
const userIds: string[] = [];
const orderIds: string[] = [];
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const password = "Resumo-Mensal-1096!";

async function createStaff(role: "owner" | "manager", storeIds: string[]) {
  const email = `resumo-${role}-${userIds.length}-${suffix}@delivery.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`Setup resumo: ${role} — ${error?.message}`);
  userIds.push(data.user.id);

  const { error: profileError } = await admin
    .from("staff_profiles")
    .insert({ user_id: data.user.id, full_name: `Resumo ${role}`, role, active: true });
  if (profileError) throw new Error(`Setup resumo: perfil — ${profileError.message}`);

  if (storeIds.length > 0) {
    const { error: accessError } = await admin
      .from("staff_stores")
      .insert(storeIds.map((store_id) => ({ user_id: data.user.id, store_id })));
    if (accessError) throw new Error(`Setup resumo: acesso — ${accessError.message}`);
  }

  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: loginError } = await client.auth.signInWithPassword({ email, password });
  if (loginError) throw new Error(`Setup resumo: login — ${loginError.message}`);
  return client;
}

async function createOrder(input: {
  createdAt: string;
  totalCents: number;
  status: "paid" | "delivered" | "cancelled";
  channel: "counter" | "pickup";
  item?: { name: string; qty: number; unitPriceCents: number };
}) {
  const { data: order, error } = await admin
    .from("orders")
    .insert({
      store_id: maputoStoreId,
      order_number: `MES-${suffix}-${orderIds.length + 1}`,
      status: input.status,
      flow: "manual",
      channel: input.channel,
      fulfillment_type: "pickup",
      customer_name: "Teste Resumo Mensal",
      subtotal_cents: input.totalCents,
      delivery_fee_cents: 0,
      discount_cents: 0,
      total_cents: input.totalCents,
      payment_method: "cash",
      created_at: input.createdAt,
    })
    .select("id")
    .single();
  if (error || !order) throw new Error(`Criar pedido — ${error?.message}`);
  orderIds.push(order.id);

  if (input.status !== "cancelled") {
    const { error: paymentError } = await admin.from("payments").insert({
      order_id: order.id,
      store_id: maputoStoreId,
      provider: "counter",
      method: "cash",
      amount_cents: input.totalCents,
      status: "confirmed",
      idempotency_key: `mes:${suffix}:${orderIds.length}`,
      created_at: input.createdAt,
    });
    if (paymentError) throw new Error(`Criar pagamento — ${paymentError.message}`);
  }

  if (input.item) {
    const { error: itemError } = await admin.from("order_items").insert({
      order_id: order.id,
      store_id: maputoStoreId,
      name_snapshot: input.item.name,
      qty: input.item.qty,
      unit_price_cents: input.item.unitPriceCents,
      station: "kitchen",
    });
    if (itemError) throw new Error(`Criar artigo — ${itemError.message}`);
  }
}

async function cleanSnapshots() {
  await admin
    .from("google_profile_snapshots")
    .delete()
    .in("month", ["2020-02-01", "2020-03-01"]);
}

beforeAll(async () => {
  admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  anon = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: stores, error } = await admin
    .from("stores")
    .select("id,slug,google_place_id")
    .in("slug", ["maputo", "matola"]);
  if (error || stores?.length !== 2) throw new Error(`Setup resumo: lojas — ${error?.message}`);
  const maputo = stores.find((store) => store.slug === "maputo")!;
  maputoStoreId = maputo.id;
  matolaStoreId = stores.find((store) => store.slug === "matola")!.id;
  originalPlaceId = maputo.google_place_id;

  owner = await createStaff("owner", []);
  maputoManager = await createStaff("manager", [maputoStoreId]);
  matolaManager = await createStaff("manager", [matolaStoreId]);

  await cleanSnapshots();

  // Março de 2020 em Maputo (UTC+2).
  await createOrder({
    createdAt: "2020-03-10T12:00:00Z",
    totalCents: 100_000,
    status: "paid",
    channel: "counter",
    item: { name: "Teste Mensal Burger", qty: 3, unitPriceCents: 30_000 },
  });
  // 22h30 UTC de 29 Fev = 00h30 de 1 Mar em Maputo: é de Março.
  await createOrder({ createdAt: "2020-02-29T22:30:00Z", totalCents: 50_000, status: "delivered", channel: "pickup" });
  // 22h30 UTC de 31 Mar = 00h30 de 1 Abr em Maputo: já não é de Março.
  await createOrder({ createdAt: "2020-03-31T22:30:00Z", totalCents: 70_000, status: "paid", channel: "counter" });
  // Anulado: conta como anulado, nunca como facturado.
  await createOrder({ createdAt: "2020-03-12T12:00:00Z", totalCents: 30_000, status: "cancelled", channel: "counter" });
  // Fevereiro: o mês anterior, para a comparação.
  await createOrder({ createdAt: "2020-02-10T12:00:00Z", totalCents: 40_000, status: "paid", channel: "counter" });
});

afterAll(async () => {
  if (!admin) return;
  await cleanSnapshots();
  await admin.from("stores").update({ google_place_id: originalPlaceId }).eq("id", maputoStoreId);
  if (orderIds.length > 0) {
    await admin.from("event_log").delete().in("order_id", orderIds);
    await admin.from("order_items").delete().in("order_id", orderIds);
    await admin.from("payments").delete().in("order_id", orderIds);
    await admin.from("orders").delete().in("id", orderIds);
  }
  if (userIds.length > 0) await admin.from("event_log").delete().in("actor_user_id", userIds);
  for (const userId of userIds) await admin.auth.admin.deleteUser(userId);
});

async function marchMaputo(): Promise<{ month: string; previous_month: string; store: MonthlyStore }> {
  const { data, error } = await admin.rpc("get_monthly_digest", { p_month: "2020-03-15" });
  expect(error).toBeNull();
  const payload = data as { month: string; previous_month: string; stores: MonthlyStore[] };
  return {
    month: payload.month,
    previous_month: payload.previous_month,
    store: payload.stores.find((store) => store.store_id === maputoStoreId)!,
  };
}

describe("get_monthly_digest — as vendas do mês", () => {
  it("qualquer dia serve para escolher o mês; o anterior vem ao lado", async () => {
    const { month, previous_month } = await marchMaputo();
    expect(month).toBe("2020-03-01");
    expect(previous_month).toBe("2020-02-01");
  });

  it("conta o mês no fuso de Maputo e só os estados que são venda", async () => {
    const { store } = await marchMaputo();
    expect(store.orders_count).toBe(2);
    expect(store.revenue_cents).toBe(150_000);
    expect(store.cancelled_count).toBe(1);
    expect(store.previous_orders_count).toBe(1);
    expect(store.previous_revenue_cents).toBe(40_000);
  });

  it("decompõe por canal e por forma de pagamento", async () => {
    const { store } = await marchMaputo();
    expect(store.channels.counter).toEqual({ orders: 1, revenue_cents: 100_000 });
    expect(store.channels.pickup).toEqual({ orders: 1, revenue_cents: 50_000 });
    expect(store.payments.cash).toBe(150_000);
  });

  it("traz os mais vendidos com as regras do fecho", async () => {
    const { store } = await marchMaputo();
    expect(store.top_items[0]).toMatchObject({ name: "Teste Mensal Burger", qty: 3, total_cents: 90_000 });
  });

  it("a Matola não herda as vendas de Maputo", async () => {
    const { data } = await admin.rpc("get_monthly_digest", { p_month: "2020-03-01" });
    const matola = (data as { stores: MonthlyStore[] }).stores.find(
      (store) => store.store_id === matolaStoreId,
    )!;
    expect(matola.orders_count).toBe(0);
    expect(matola.revenue_cents).toBe(0);
  });

  it("é porta do cron: fechada ao anónimo e a quem tem sessão de equipa", async () => {
    const fromAnon = await anon.rpc("get_monthly_digest", { p_month: "2020-03-01" });
    expect(fromAnon.error).not.toBeNull();
    const fromOwner = await owner.rpc("get_monthly_digest", { p_month: "2020-03-01" });
    expect(fromOwner.error).not.toBeNull();
  });
});

describe("fotografia do Google", () => {
  it("o resumo traz a fotografia do mês e a do mês anterior", async () => {
    const { error } = await admin.from("google_profile_snapshots").insert([
      { store_id: maputoStoreId, month: "2020-02-01", place_id: "ChIJ-teste-1096", rating: 4.6, review_count: 10 },
      { store_id: maputoStoreId, month: "2020-03-01", place_id: "ChIJ-teste-1096", rating: 4.7, review_count: 14 },
    ]);
    expect(error).toBeNull();

    const { store } = await marchMaputo();
    expect(store.google_snapshot?.review_count).toBe(14);
    expect(store.google_previous?.review_count).toBe(10);
  });

  it("o mês de uma fotografia é sempre o dia 1", async () => {
    const { error } = await admin.from("google_profile_snapshots").insert({
      store_id: matolaStoreId,
      month: "2020-03-15",
      place_id: "ChIJ-teste-1096",
    });
    expect(error).not.toBeNull();
  });

  it("é da loja: Maputo lê a sua, a Matola não", async () => {
    const mine = await maputoManager
      .from("google_profile_snapshots")
      .select("month")
      .eq("store_id", maputoStoreId)
      .eq("month", "2020-03-01");
    expect(mine.error).toBeNull();
    expect(mine.data).toHaveLength(1);

    const other = await matolaManager
      .from("google_profile_snapshots")
      .select("month")
      .eq("store_id", maputoStoreId);
    expect(other.error).toBeNull();
    expect(other.data).toHaveLength(0);
  });

  it("ninguém no painel escreve uma fotografia — o número vem do Google", async () => {
    const { error } = await owner.from("google_profile_snapshots").insert({
      store_id: maputoStoreId,
      month: "2020-01-01",
      place_id: "ChIJ-teste-1096",
      review_count: 999,
    });
    expect(error).not.toBeNull();
  });
});

describe("set_store_google_place — o perfil de cada loja", () => {
  it("o dono liga a loja ao perfil, e fica registado", async () => {
    const { data, error } = await owner.rpc("set_store_google_place", {
      p_store_id: maputoStoreId,
      p_place_id: "  ChIJ-teste-1096_maputo  ",
    });
    expect(error).toBeNull();
    expect(data).toMatchObject({ google_place_id: "ChIJ-teste-1096_maputo" });

    const read = await owner.from("stores").select("google_place_id").eq("id", maputoStoreId).single();
    expect(read.data?.google_place_id).toBe("ChIJ-teste-1096_maputo");

    const { data: log } = await admin
      .from("event_log")
      .select("type,payload")
      .eq("store_id", maputoStoreId)
      .eq("type", "store.updated")
      .eq("payload->>google_place_id", "ChIJ-teste-1096_maputo");
    expect(log?.length).toBeGreaterThan(0);

    const { store } = await marchMaputo();
    expect(store.google_place_id).toBe("ChIJ-teste-1096_maputo");
  });

  it("recusa o que não é um Place ID", async () => {
    const { error } = await owner.rpc("set_store_google_place", {
      p_store_id: maputoStoreId,
      p_place_id: "https://g.page/r/abc/review",
    });
    expect(error?.message).toContain("invalid_google_place_id");
  });

  it("o gerente não muda o perfil — é configuração, não operação", async () => {
    const { error } = await maputoManager.rpc("set_store_google_place", {
      p_store_id: maputoStoreId,
      p_place_id: "ChIJ-teste-1096_gerente",
    });
    expect(error?.message).toContain("staff_admin_denied");
  });

  it("vazio desliga", async () => {
    const { data, error } = await owner.rpc("set_store_google_place", {
      p_store_id: maputoStoreId,
      p_place_id: "",
    });
    expect(error).toBeNull();
    expect(data).toMatchObject({ google_place_id: null });
  });
});
