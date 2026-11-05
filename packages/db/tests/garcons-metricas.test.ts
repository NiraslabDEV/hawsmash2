/**
 * Gate de integração da 1123 — as métricas dos garçons.
 *
 * Contra um Supabase a sério: os números têm de bater com os pedidos, a venda
 * cancelada não conta, o período e a loja cortam, e só o gerente da loja e o
 * dono os lêem (é dinheiro: nem o caixa, nem outra loja, nem a anon).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://localhost:54731";
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz";

const sufixo = `${Date.now()}`;
const PASSWORD = "Metricas-1123-Teste-2026!";
const PIN = "6240";
const MESA = 95;

type Linha = {
  id: string;
  full_name: string;
  orders: number;
  revenue_cents: number;
  avg_ticket_cents: number;
  items: number;
  tables: number;
  extras_cents: number;
  served: number;
  median_minutes_to_serve: number | null;
  cancelled_orders: number;
  removed_events: number;
  removed_cents: number;
  paid_cents: number;
  open_cents: number;
  active_days: number;
};

let admin: SupabaseClient;
let anon: SupabaseClient;
let gerente: SupabaseClient;
let gerenteMaputo: SupabaseClient;
let caixa: SupabaseClient;
let dono: SupabaseClient;
let matola: string;
let maputo: string;
let deviceId: string;
let mesaId: string;
let itemId: string;
let varianteId: string;
let preco: number;
let extraId: string | null = null;
let precoExtra = 0;
let inicio: string;
let fim: string;
let ana: { id: string; token: string };
let beto: { id: string; token: string };
let semPedidos: { id: string };
let stockAntes: { available: boolean; track_stock: boolean; stock_qty: number } | null = null;
let ingredientesAntes: Array<{ ingredient_id: string; qty: number }> = [];
let pedidoAna1: string;
let pedidoAna2: string;

const users: string[] = [];
const pedidos: string[] = [];
const garcons: string[] = [];
const contas: string[] = [];

const telefone = (n: number) => `81${sufixo.slice(-5)}${String(n).padStart(2, "0")}`;

async function conta(role: string, loja: string | null, nome: string) {
  const email = `metricas-${role}-${nome}-${sufixo}@delivery.test`;
  const { data: user, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error || !user.user) throw new Error(`Setup 1123: ${error?.message}`);
  users.push(user.user.id);
  await admin.from("staff_profiles").insert({ user_id: user.user.id, full_name: `Teste ${nome}`, role, active: true });
  if (loja) await admin.from("staff_stores").insert({ user_id: user.user.id, store_id: loja });
  const cliente = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  await cliente.auth.signInWithPassword({ email, password: PASSWORD });
  return cliente;
}

async function garcom(n: number, nome: string) {
  const { data: id, error } = await gerente.rpc("save_waiter", {
    p_waiter_id: null, p_store_id: matola, p_full_name: nome, p_phone: telefone(n), p_active: true,
  });
  if (error) throw new Error(`Setup 1123: ${error.message}`);
  garcons.push(id as string);
  await gerente.rpc("set_waiter_pin", { p_waiter_id: id, p_pin: PIN });
  const { data } = await admin.rpc("waiter_login", { p_phone: telefone(n), p_pin: PIN });
  return { id: id as string, token: data.token as string };
}

async function lancar(token: string, items: unknown[]) {
  const { data, error } = await admin.rpc("waiter_launch_order", {
    p_token: token,
    p_payload: { clientSaleId: crypto.randomUUID(), tableId: mesaId, items },
  });
  if (error) throw new Error(`lançar: ${error.message}`);
  pedidos.push(data.order_id as string);
  return data.order_id as string;
}

function metricas(cliente: SupabaseClient, extra: Record<string, unknown> = {}, loja: string | null = matola) {
  return cliente.rpc("get_waiter_metrics", { p_store_id: loja, p_from: inicio, p_to: fim, ...extra });
}

beforeAll(async () => {
  inicio = new Date(Date.now() - 60 * 60_000).toISOString();
  fim = new Date(Date.now() + 60 * 60_000).toISOString();
  admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: lojas } = await admin.from("stores").select("id,slug").in("slug", ["matola", "maputo"]);
  matola = lojas!.find((l) => l.slug === "matola")!.id as string;
  maputo = lojas!.find((l) => l.slug === "maputo")!.id as string;

  const { data: classic } = await admin.from("menu_items").select("id").eq("name", "Classic Smash").single();
  itemId = classic!.id as string;
  const { data: haw } = await admin
    .from("menu_item_variants").select("id,price_cents").eq("menu_item_id", itemId).eq("name", "HAW").single();
  varianteId = haw!.id as string;
  preco = haw!.price_cents as number;

  const { data: extra, error: extraError } = await admin
    .from("menu_addons")
    .insert({ menu_item_id: itemId, name: `Extra teste ${sufixo}`, price_cents: 5000, active: true })
    .select("id,price_cents")
    .single();
  if (extraError) throw new Error(`Setup 1123: extra — ${extraError.message}`);
  extraId = extra.id as string;
  precoExtra = extra.price_cents as number;

  const { data: stock } = await admin
    .from("store_items").select("available,track_stock,stock_qty").eq("store_id", matola).eq("menu_item_id", itemId).single();
  stockAntes = stock;
  await admin.from("store_items")
    .update({ available: true, track_stock: true, stock_qty: 500 }).eq("store_id", matola).eq("menu_item_id", itemId);
  const { data: ingredientes } = await admin.from("store_ingredients").select("ingredient_id,qty").eq("store_id", matola);
  ingredientesAntes = (ingredientes ?? []) as Array<{ ingredient_id: string; qty: number }>;
  await admin.from("store_ingredients").update({ qty: 100000 }).eq("store_id", matola);

  const { data: mesa, error: mesaError } = await admin.from("tables").insert({ store_id: matola, number: MESA }).select("id").single();
  if (mesaError) throw new Error(`Setup 1123: mesa — ${mesaError.message}`);
  mesaId = mesa.id as string;

  gerente = await conta("manager", matola, "mtl");
  gerenteMaputo = await conta("manager", maputo, "mpt");
  caixa = await conta("cashier", matola, "mtl");
  dono = await conta("owner", null, "dono");

  const { data: device } = await admin.from("devices")
    .insert({ store_id: matola, kind: "pos", label: `POS métricas ${sufixo}`, device_key_hash: `metricas-${sufixo}` })
    .select("id").single();
  deviceId = device!.id as string;

  ana = await garcom(1, "Ana Métricas");
  beto = await garcom(2, "Beto Métricas");
  semPedidos = await garcom(3, "Carla Sem Pedidos");

  // Ana: 2 pedidos válidos (3 artigos, um com extra) e 1 cancelado. Beto: 1 pedido.
  pedidoAna1 = await lancar(ana.token, [{ menuItemId: itemId, variantId: varianteId, qty: 2 }]);
  pedidoAna2 = await lancar(ana.token, [{ menuItemId: itemId, variantId: varianteId, qty: 1, addonIds: [extraId] }]);
  const cancelado = await lancar(ana.token, [{ menuItemId: itemId, variantId: varianteId, qty: 7 }]);
  const { error: cancelError } = await admin.rpc("advance_order", { p_order_id: cancelado, p_event: "CANCEL", p_reason: "Teste" });
  if (cancelError) throw new Error(`Setup 1123: cancelar — ${cancelError.message}`);
  await lancar(beto.token, [{ menuItemId: itemId, variantId: varianteId, qty: 1 }]);

  // A Ana serve o primeiro; o Beto serve o segundo da Ana (a sala ajuda-se).
  await admin.rpc("waiter_serve_order", { p_token: ana.token, p_order_id: pedidoAna1 });
  await admin.rpc("waiter_serve_order", { p_token: beto.token, p_order_id: pedidoAna2 });
}, 120_000);

afterAll(async () => {
  if (!admin) return;
  for (const l of ingredientesAntes) {
    await admin.from("store_ingredients").update({ qty: l.qty }).eq("store_id", matola).eq("ingredient_id", l.ingredient_id);
  }
  if (stockAntes) await admin.from("store_items").update(stockAntes).eq("store_id", matola).eq("menu_item_id", itemId);
  await admin.from("print_jobs").delete().in("order_id", pedidos);
  if (contas.length) await admin.from("print_jobs").delete().in("request_id", contas);
  await admin.from("stock_movements").delete().in("order_id", pedidos);
  await admin.from("event_log").delete().in("order_id", pedidos);
  await admin.from("orders").delete().in("id", pedidos);
  if (contas.length) await admin.from("table_bills").delete().in("id", contas);
  const { data: caixas } = await admin.from("cash_sessions").select("id").eq("store_id", matola).gte("opened_at", inicio);
  const ids = (caixas ?? []).map((c) => c.id as string);
  if (ids.length) {
    await admin.from("cash_movements").delete().in("session_id", ids);
    await admin.from("cash_sessions").delete().in("id", ids);
  }
  if (extraId) await admin.from("menu_addons").delete().eq("id", extraId);
  await admin.from("waiters").delete().in("id", garcons);
  await admin.from("event_log").delete().in("actor_user_id", users);
  await admin.from("event_log").delete().like("type", "waiter.%").gte("created_at", inicio);
  await admin.from("tables").delete().eq("id", mesaId);
  await admin.from("devices").delete().eq("id", deviceId);
  for (const id of users) {
    await admin.from("staff_stores").delete().eq("user_id", id);
    await admin.from("staff_profiles").delete().eq("user_id", id);
    await admin.auth.admin.deleteUser(id);
  }
});

describe("1123 · quem lê as métricas", () => {
  it("nem a anon, nem o caixa, nem o gerente de outra loja", async () => {
    expect((await metricas(anon)).error).not.toBeNull();
    expect((await metricas(caixa)).error?.message).toContain("waiter_access_denied");
    expect((await metricas(gerenteMaputo)).error?.message).toContain("waiter_access_denied");
  });

  it("todas as lojas juntas é só para o dono", async () => {
    expect((await metricas(gerente, {}, null)).error?.message).toContain("waiter_access_denied");
    const { data, error } = await metricas(dono, {}, null);
    expect(error).toBeNull();
    expect((data.waiters as Linha[]).some((w) => w.id === ana.id)).toBe(true);
  });

  it("o gerente de Maputo, na loja dele, não vê os garçons da Matola", async () => {
    const { data } = await metricas(gerenteMaputo, {}, maputo);
    expect((data.waiters as Linha[]).some((w) => w.id === ana.id)).toBe(false);
  });

  it("pedir um garçom de outra loja não abre nada", async () => {
    const { data } = await metricas(gerenteMaputo, { p_waiter_id: ana.id }, maputo);
    expect(data.waiters).toEqual([]);
    expect(data.top_items).toEqual([]);
  });
});

describe("1123 · os números", () => {
  const linha = (data: { waiters: Linha[] }, id: string) => data.waiters.find((w) => w.id === id)!;

  it("o cancelado não conta como venda, mas conta como cancelado", async () => {
    const { data, error } = await metricas(gerente);
    expect(error).toBeNull();
    const a = linha(data, ana.id);
    expect(a.orders).toBe(2);
    expect(a.items).toBe(3);
    expect(a.revenue_cents).toBe(3 * preco + precoExtra);
    expect(a.avg_ticket_cents).toBe(Math.round((3 * preco + precoExtra) / 2));
    expect(a.cancelled_orders).toBe(1);
    expect(a.tables).toBe(1);
    expect(a.active_days).toBe(1);
  });

  it("os extras vendidos aparecem à parte: é o que o garçom sugeriu", async () => {
    const { data } = await metricas(gerente);
    expect(linha(data, ana.id).extras_cents).toBe(precoExtra);
    expect(linha(data, beto.id).extras_cents).toBe(0);
  });

  it("servido conta para quem levou à mesa, mesmo que outro o tenha lançado", async () => {
    const { data } = await metricas(gerente);
    expect(linha(data, ana.id).served).toBe(1);
    expect(linha(data, beto.id).served).toBe(1);
    expect(linha(data, ana.id).median_minutes_to_serve).not.toBeNull();
    expect(linha(data, beto.id).median_minutes_to_serve).toBeNull();
  });

  it("o garçom sem pedidos no período aparece a zero", async () => {
    const { data } = await metricas(gerente);
    expect(linha(data, semPedidos.id)).toMatchObject({ orders: 0, revenue_cents: 0, avg_ticket_cents: 0, items: 0 });
  });

  it("o total da equipa é a soma, e a origem separa garçom, balcão e QR", async () => {
    const { data } = await metricas(gerente);
    expect(data.totals.orders).toBe(3);
    expect(data.totals.revenue_cents).toBe(4 * preco + precoExtra);
    const { data: balcao, error } = await caixa.rpc("launch_table_order", {
      p_payload: {
        clientSaleId: crypto.randomUUID(), deviceId, tableId: mesaId,
        items: [{ menuItemId: itemId, variantId: varianteId, qty: 1 }],
      },
    });
    expect(error).toBeNull();
    pedidos.push(balcao.order_id as string);
    const { data: depois } = await metricas(gerente);
    expect(depois.table_origin.waiter.orders).toBe(3);
    expect(depois.table_origin.counter.orders).toBe(1);
    expect(depois.table_origin.counter.revenue_cents).toBe(preco);
    expect(depois.table_origin.qr.orders).toBe(0);
    // O do balcão não entra nos totais dos garçons.
    expect(depois.totals.orders).toBe(3);
  });

  it("artigo retirado desce a venda e fica registado contra quem lançou", async () => {
    const { data: itens } = await admin.from("order_items").select("id").eq("order_id", pedidoAna1).single();
    const { error } = await caixa.rpc("remove_table_item", {
      p_payload: { requestId: crypto.randomUUID(), deviceId, orderItemId: itens!.id, qty: 1, reason: "Lançado por engano" },
    });
    expect(error).toBeNull();
    const { data } = await metricas(gerente);
    const a = linha(data, ana.id);
    expect(a.removed_events).toBe(1);
    expect(a.removed_cents).toBe(preco);
    expect(a.revenue_cents).toBe(2 * preco + precoExtra);
    expect(a.items).toBe(2);
  });

  it("separa o que já foi pago do que está por cobrar", async () => {
    const { data: antes } = await metricas(gerente);
    expect(linha(antes, ana.id).paid_cents).toBe(0);
    expect(linha(antes, ana.id).open_cents).toBe(linha(antes, ana.id).revenue_cents);

    const { data: visao } = await caixa.rpc("pos_table_overview", { p_device_id: deviceId });
    const mesa = (visao.tables as Array<{ id: string; orders: Array<{ total_cents: number }> }>).find((t) => t.id === mesaId)!;
    const total = mesa.orders.reduce((s, o) => s + o.total_cents, 0);
    const { data: fecho, error } = await caixa.rpc("close_table_bill", {
      p_payload: {
        clientCloseId: crypto.randomUUID(), deviceId, tableId: mesaId, expectedTotalCents: total,
        payments: [{ method: "mpesa", amountCents: total }],
      },
    });
    expect(error).toBeNull();
    contas.push((fecho.bill_id ?? fecho.id) as string);

    const { data: depois } = await metricas(gerente);
    const a = linha(depois, ana.id);
    expect(a.open_cents).toBe(0);
    expect(a.paid_cents).toBe(a.revenue_cents);
  });

  it("o período corta, e os dias e as horas contam no fuso de Maputo", async () => {
    const { data: fora } = await metricas(gerente, { p_from: "2020-01-01T00:00:00Z", p_to: "2020-01-02T00:00:00Z" });
    expect(fora.totals.orders).toBe(0);
    expect(fora.by_day).toEqual([]);

    // 23:30 UTC é 01:30 do dia seguinte em Maputo.
    await admin.from("orders").update({ created_at: "2026-03-10T23:30:00Z" }).eq("id", pedidoAna2);
    const { data } = await metricas(gerente, {
      p_from: "2026-03-10T00:00:00Z", p_to: "2026-03-12T00:00:00Z", p_waiter_id: ana.id,
    });
    expect(data.by_day).toEqual([{ day: "2026-03-11", orders: 1, revenue_cents: preco + precoExtra }]);
    expect(data.by_hour).toEqual([{ hour: 1, orders: 1 }]);
    expect(data.top_items[0]).toMatchObject({ qty: 1 });
  });
});
