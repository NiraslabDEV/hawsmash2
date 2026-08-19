/**
 * Gate de integração da F6 — estoque por loja.
 * Cobre baixa atómica, movimentos auditáveis, corrida do último item,
 * reposição na anulação, isolamento entre lojas e alerta de rotura.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://localhost:54731";
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz";

let admin: SupabaseClient;
let anon: SupabaseClient;
let manager: SupabaseClient;
let cashier: SupabaseClient;
let matolaManager: SupabaseClient;

let maputoStoreId: string;
let matolaStoreId: string;
let itemId: string;
let posDeviceId: string;

const createdUserIds: string[] = [];
const createdDeviceIds: string[] = [];
const createdOrderIds: string[] = [];
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const PASSWORD = "Estoque-F6-Teste-2026!";

type StoreItemState = {
  available: boolean;
  track_stock: boolean;
  stock_qty: number;
  low_stock_qty: number;
};

let originalMaputoItem: StoreItemState;
let originalMatolaItem: StoreItemState;

async function createStaff(
  role: "owner" | "manager" | "cashier",
  storeId: string,
  label: string,
): Promise<SupabaseClient> {
  const email = `stock-${label}-${suffix}@delivery.test`;
  const { data: user, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !user.user) throw new Error(`Setup estoque: utilizador ${label} — ${error?.message}`);
  createdUserIds.push(user.user.id);

  const { error: profileError } = await admin.from("staff_profiles").insert({
    user_id: user.user.id,
    full_name: `Equipa Estoque ${label}`,
    role,
    active: true,
  });
  if (profileError) throw new Error(`Setup estoque: perfil ${label} — ${profileError.message}`);

  const { error: storeError } = await admin
    .from("staff_stores")
    .insert({ user_id: user.user.id, store_id: storeId });
  if (storeError) throw new Error(`Setup estoque: loja ${label} — ${storeError.message}`);

  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: loginError } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (loginError) throw new Error(`Setup estoque: login ${label} — ${loginError.message}`);
  return client;
}

async function setStock(
  storeId: string,
  values: { stock_qty: number; low_stock_qty?: number; track_stock?: boolean; available?: boolean },
): Promise<void> {
  const { error } = await admin
    .from("store_items")
    .update({
      available: values.available ?? true,
      track_stock: values.track_stock ?? true,
      stock_qty: values.stock_qty,
      low_stock_qty: values.low_stock_qty ?? 0,
    })
    .eq("store_id", storeId)
    .eq("menu_item_id", itemId);
  if (error) throw new Error(`Setup estoque: stock — ${error.message}`);
}

async function readStock(storeId: string): Promise<number> {
  const { data, error } = await admin
    .from("store_items")
    .select("stock_qty")
    .eq("store_id", storeId)
    .eq("menu_item_id", itemId)
    .single();
  if (error || !data) throw new Error(`Leitura de stock — ${error?.message}`);
  return data.stock_qty;
}

async function movementsFor(orderId: string) {
  const { data, error } = await admin
    .from("stock_movements")
    .select("store_id,menu_item_id,delta,reason,qty_after,created_by")
    .eq("order_id", orderId)
    .order("created_at");
  if (error) throw new Error(`Leitura de movimentos — ${error.message}`);
  return data ?? [];
}

async function sell(client: SupabaseClient, qty: number, clientSaleId = crypto.randomUUID()) {
  const result = await client.rpc("create_counter_sale", {
    p_payload: {
      clientSaleId,
      deviceId: posDeviceId,
      items: [{ menuItemId: itemId, qty }],
      payments: [{ method: "cash", amountCents: 30000 * qty }],
      cashReceivedCents: 30000 * qty,
    },
  });
  if (result.data?.order_id) createdOrderIds.push(result.data.order_id);
  return result;
}

beforeAll(async () => {
  admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  anon = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: stores, error: storesError } = await admin
    .from("stores")
    .select("id,slug")
    .in("slug", ["maputo", "matola"]);
  if (storesError || stores?.length !== 2) {
    throw new Error(`Setup estoque: lojas — ${storesError?.message}`);
  }
  maputoStoreId = stores.find((store) => store.slug === "maputo")!.id;
  matolaStoreId = stores.find((store) => store.slug === "matola")!.id;

  const { data: item, error: itemError } = await admin
    .from("menu_items")
    .select("id,price_cents")
    .eq("name", "Classic Smash")
    .single();
  if (itemError || !item || item.price_cents !== 30000) {
    throw new Error(`Setup estoque: Classic Smash — ${itemError?.message}`);
  }
  itemId = item.id;

  const { data: original, error: originalError } = await admin
    .from("store_items")
    .select("store_id,available,track_stock,stock_qty,low_stock_qty")
    .in("store_id", [maputoStoreId, matolaStoreId])
    .eq("menu_item_id", itemId);
  if (originalError || original?.length !== 2) {
    throw new Error(`Setup estoque: store_items — ${originalError?.message}`);
  }
  const pick = (storeId: string): StoreItemState => {
    const row = original.find((entry) => entry.store_id === storeId)!;
    return {
      available: row.available,
      track_stock: row.track_stock,
      stock_qty: row.stock_qty,
      low_stock_qty: row.low_stock_qty,
    };
  };
  originalMaputoItem = pick(maputoStoreId);
  originalMatolaItem = pick(matolaStoreId);

  manager = await createStaff("manager", maputoStoreId, "gerente");
  cashier = await createStaff("cashier", maputoStoreId, "caixa");
  matolaManager = await createStaff("manager", matolaStoreId, "matola");

  const { data: device, error: deviceError } = await admin
    .from("devices")
    .insert({
      store_id: maputoStoreId,
      kind: "pos",
      label: "POS estoque F6",
      device_key_hash: `teste-f6-${suffix}`,
    })
    .select("id")
    .single();
  if (deviceError || !device) throw new Error(`Setup estoque: dispositivo — ${deviceError?.message}`);
  posDeviceId = device.id;
  createdDeviceIds.push(device.id);
});

beforeEach(async () => {
  await setStock(maputoStoreId, { stock_qty: 5, low_stock_qty: 0 });
  await setStock(matolaStoreId, { stock_qty: 5, low_stock_qty: 0 });
});

afterAll(async () => {
  if (!admin) return;
  if (createdOrderIds.length > 0) {
    await admin.from("stock_movements").delete().in("order_id", createdOrderIds);
    await admin.from("orders").delete().in("id", createdOrderIds);
  }
  await admin.from("stock_movements").delete().eq("menu_item_id", itemId);
  if (createdDeviceIds.length > 0) {
    await admin.from("devices").delete().in("id", createdDeviceIds);
  }
  if (originalMaputoItem) {
    await admin
      .from("store_items")
      .update(originalMaputoItem)
      .eq("store_id", maputoStoreId)
      .eq("menu_item_id", itemId);
  }
  if (originalMatolaItem) {
    await admin
      .from("store_items")
      .update(originalMatolaItem)
      .eq("store_id", matolaStoreId)
      .eq("menu_item_id", itemId);
  }
  for (const userId of createdUserIds) {
    await admin.auth.admin.deleteUser(userId);
  }
});

describe("F6 — movimentos de estoque", () => {
  it("mantém o histórico isolado por loja e fechado à escrita directa", async () => {
    await admin.from("stock_movements").insert([
      {
        store_id: maputoStoreId,
        menu_item_id: itemId,
        delta: -1,
        reason: "manual",
        qty_after: 4,
      },
      {
        store_id: matolaStoreId,
        menu_item_id: itemId,
        delta: -1,
        reason: "manual",
        qty_after: 4,
      },
    ]);

    const { data: visible, error } = await manager
      .from("stock_movements")
      .select("store_id")
      .eq("menu_item_id", itemId);
    expect(error).toBeNull();
    expect(visible?.length).toBeGreaterThan(0);
    expect(visible?.every((row) => row.store_id === maputoStoreId)).toBe(true);

    const { error: writeError } = await manager.from("stock_movements").insert({
      store_id: maputoStoreId,
      menu_item_id: itemId,
      delta: 99,
      reason: "manual",
      qty_after: 99,
    });
    expect(writeError).not.toBeNull();

    const { data: anonRead } = await anon.from("stock_movements").select("id").limit(1);
    expect(anonRead ?? []).toEqual([]);

    await admin.from("stock_movements").delete().eq("menu_item_id", itemId);
  });

  it("desconta a venda de balcão e grava o movimento com autor e quantidade final", async () => {
    await setStock(maputoStoreId, { stock_qty: 5 });

    const sale = await sell(manager, 2);
    expect(sale.error).toBeNull();

    expect(await readStock(maputoStoreId)).toBe(3);
    expect(await readStock(matolaStoreId)).toBe(5);

    const movements = await movementsFor(sale.data.order_id);
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({
      store_id: maputoStoreId,
      menu_item_id: itemId,
      delta: -2,
      reason: "sale",
      qty_after: 3,
    });
    expect(movements[0].created_by).toBeTruthy();
  });

  it("deixa passar apenas uma de duas vendas simultâneas do último item", async () => {
    await setStock(maputoStoreId, { stock_qty: 1 });

    const results = await Promise.all([sell(manager, 1), sell(manager, 1)]);
    const ok = results.filter((result) => !result.error);
    const failed = results.filter((result) => result.error);

    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0].error?.message).toContain("out_of_stock");
    expect(await readStock(maputoStoreId)).toBe(0);

    const movements = await movementsFor(ok[0].data.order_id);
    expect(movements).toHaveLength(1);
    expect(movements[0].delta).toBe(-1);
  });

  it("repõe na anulação exactamente o que foi consumido, uma só vez", async () => {
    await setStock(maputoStoreId, { stock_qty: 3 });

    const sale = await sell(manager, 1);
    expect(sale.error).toBeNull();
    expect(await readStock(maputoStoreId)).toBe(2);

    const first = await manager.rpc("void_sale", {
      p_order_id: sale.data.order_id,
      p_reason: "Cliente desistiu no balcão",
    });
    const second = await manager.rpc("void_sale", {
      p_order_id: sale.data.order_id,
      p_reason: "Cliente desistiu no balcão",
    });

    expect(first.error).toBeNull();
    expect(first.data).toMatchObject({ status: "cancelled", restored_qty: 1 });
    expect(second.error).toBeNull();
    expect(await readStock(maputoStoreId)).toBe(3);

    const movements = await movementsFor(sale.data.order_id);
    expect(movements.map((movement) => [movement.reason, movement.delta])).toEqual([
      ["sale", -1],
      ["void", 1],
    ]);
  });

  it("desconta o pedido online na loja do pedido e nunca no catálogo global", async () => {
    await setStock(maputoStoreId, { stock_qty: 4 });

    const { data: catalogBefore } = await admin
      .from("menu_items")
      .select("stock_qty")
      .eq("id", itemId)
      .single();

    const { data: orderId, error: createError } = await anon.rpc("create_order", {
      p_store_slug: "maputo",
      p_payload: {
        items: [{ menuItemId: itemId, qty: 1 }],
        customerName: "Estoque F6 online",
        fulfillmentType: "pickup",
        paymentMethod: "mpesa",
      },
    });
    expect(createError).toBeNull();
    createdOrderIds.push(orderId);

    const approved = await manager.rpc("advance_order", {
      p_order_id: orderId,
      p_event: "APPROVE",
    });
    expect(approved.error).toBeNull();

    expect(await readStock(maputoStoreId)).toBe(3);
    expect(await readStock(matolaStoreId)).toBe(5);

    const { data: catalogAfter } = await admin
      .from("menu_items")
      .select("stock_qty")
      .eq("id", itemId)
      .single();
    expect(catalogAfter?.stock_qty).toBe(catalogBefore?.stock_qty);

    const movements = await movementsFor(orderId);
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({ reason: "sale", delta: -1, store_id: maputoStoreId });
  });
});

describe("F6 — esgotado por loja", () => {
  it("sai do cardápio da loja esgotada e permanece na outra", async () => {
    await setStock(maputoStoreId, { stock_qty: 0 });

    const [{ data: maputoMenu }, { data: matolaMenu }] = await Promise.all([
      anon.rpc("get_menu", { p_store_slug: "maputo" }),
      anon.rpc("get_menu", { p_store_slug: "matola" }),
    ]);

    const ids = (menu: { categories: Array<{ items: Array<{ id: string }> }> }) =>
      menu.categories.flatMap((category) => category.items.map((item) => item.id));

    expect(ids(maputoMenu)).not.toContain(itemId);
    expect(ids(matolaMenu)).toContain(itemId);
  });

  it("entrega ao POS o item esgotado marcado como indisponível", async () => {
    await setStock(maputoStoreId, { stock_qty: 0 });

    const { data: menu, error } = await manager.rpc("get_menu", {
      p_store_slug: "maputo",
      p_include_unavailable: true,
    });
    expect(error).toBeNull();

    const item = menu.categories
      .flatMap((category: { items: Array<{ id: string; available: boolean }> }) => category.items)
      .find((entry: { id: string }) => entry.id === itemId);

    expect(item).toBeTruthy();
    expect(item.available).toBe(false);
  });
});

describe("F6 — gestão de estoque no painel", () => {
  it("regista entrada, quebra e contagem com motivo, autor e auditoria", async () => {
    await setStock(maputoStoreId, { stock_qty: 5 });

    const receive = await manager.rpc("adjust_store_stock", {
      p_store_id: maputoStoreId,
      p_menu_item_id: itemId,
      p_reason: "receive",
      p_delta: 10,
      p_note: "Entrada do fornecedor",
    });
    expect(receive.error).toBeNull();
    expect(receive.data).toMatchObject({ previous_qty: 5, new_qty: 15, delta: 10 });

    const waste = await manager.rpc("adjust_store_stock", {
      p_store_id: maputoStoreId,
      p_menu_item_id: itemId,
      p_reason: "waste",
      p_delta: -2,
      p_note: "Pão queimado",
    });
    expect(waste.error).toBeNull();
    expect(waste.data).toMatchObject({ new_qty: 13, delta: -2 });

    const count = await manager.rpc("adjust_store_stock", {
      p_store_id: maputoStoreId,
      p_menu_item_id: itemId,
      p_reason: "count",
      p_new_qty: 9,
      p_note: "Contagem do turno",
    });
    expect(count.error).toBeNull();
    expect(count.data).toMatchObject({ previous_qty: 13, new_qty: 9, delta: -4 });
    expect(await readStock(maputoStoreId)).toBe(9);

    const { data: movements } = await admin
      .from("stock_movements")
      .select("reason,delta,qty_after,note,created_by")
      .eq("store_id", maputoStoreId)
      .eq("menu_item_id", itemId)
      .is("order_id", null)
      .order("created_at");

    expect(movements?.map((movement) => [movement.reason, movement.delta])).toEqual([
      ["receive", 10],
      ["waste", -2],
      ["count", -4],
    ]);
    expect(movements?.every((movement) => movement.created_by)).toBe(true);

    const { data: events } = await admin
      .from("event_log")
      .select("type,store_id,actor_user_id")
      .eq("store_id", maputoStoreId)
      .eq("type", "stock.adjusted")
      .order("created_at", { ascending: false })
      .limit(3);
    expect(events).toHaveLength(3);
    expect(events?.every((event) => event.actor_user_id)).toBe(true);

    await admin.from("stock_movements").delete().eq("menu_item_id", itemId).is("order_id", null);
    await admin.from("event_log").delete().eq("type", "stock.adjusted").eq("store_id", maputoStoreId);
  });

  it("recusa ajuste ao caixa e a loja fora do alcance do gerente", async () => {
    const denied = await cashier.rpc("adjust_store_stock", {
      p_store_id: maputoStoreId,
      p_menu_item_id: itemId,
      p_reason: "waste",
      p_delta: -1,
      p_note: "Tentativa do caixa",
    });
    expect(denied.error?.message).toContain("stock_access_denied");

    const crossStore = await manager.rpc("adjust_store_stock", {
      p_store_id: matolaStoreId,
      p_menu_item_id: itemId,
      p_reason: "waste",
      p_delta: -1,
      p_note: "Tentativa entre lojas",
    });
    expect(crossStore.error).not.toBeNull();

    expect(await readStock(matolaStoreId)).toBe(5);
  });

  it("lista o estoque e os movimentos apenas da loja do utilizador, paginados", async () => {
    await setStock(maputoStoreId, { stock_qty: 7, low_stock_qty: 2 });

    const listed = await manager.rpc("list_store_stock", {
      p_store_id: maputoStoreId,
      p_limit: 200,
      p_offset: 0,
    });
    expect(listed.error).toBeNull();
    const row = listed.data.items.find(
      (entry: { menu_item_id: string }) => entry.menu_item_id === itemId,
    );
    expect(row).toMatchObject({ stock_qty: 7, low_stock_qty: 2, track_stock: true });
    expect(typeof listed.data.total).toBe("number");

    const foreign = await matolaManager.rpc("list_store_stock", {
      p_store_id: maputoStoreId,
      p_limit: 10,
      p_offset: 0,
    });
    expect(foreign.error).not.toBeNull();

    const sale = await sell(manager, 1);
    expect(sale.error).toBeNull();

    const movements = await manager.rpc("list_stock_movements", {
      p_store_id: maputoStoreId,
      p_menu_item_id: itemId,
      p_limit: 10,
      p_offset: 0,
    });
    expect(movements.error).toBeNull();
    expect(movements.data.movements[0]).toMatchObject({ reason: "sale", delta: -1 });
    expect(movements.data.movements[0].item_name).toBe("Classic Smash");
  });

  it("liga e desliga o controlo de stock por loja", async () => {
    const enabled = await manager.rpc("set_stock_tracking", {
      p_store_id: maputoStoreId,
      p_menu_item_id: itemId,
      p_track_stock: true,
      p_low_stock_qty: 3,
    });
    expect(enabled.error).toBeNull();
    expect(enabled.data).toMatchObject({ track_stock: true, low_stock_qty: 3 });

    const disabled = await manager.rpc("set_stock_tracking", {
      p_store_id: maputoStoreId,
      p_menu_item_id: itemId,
      p_track_stock: false,
    });
    expect(disabled.error).toBeNull();
    expect(disabled.data).toMatchObject({ track_stock: false });

    const sale = await sell(manager, 1);
    expect(sale.error).toBeNull();
    expect(await movementsFor(sale.data.order_id)).toEqual([]);
  });
});

describe("F6 — alerta de rotura", () => {
  it("assinala o item crítico à loja e regista o evento", async () => {
    await setStock(maputoStoreId, { stock_qty: 3, low_stock_qty: 2 });

    const sale = await sell(manager, 1);
    expect(sale.error).toBeNull();

    const alerts = await manager.rpc("list_stock_alerts", { p_store_id: maputoStoreId });
    expect(alerts.error).toBeNull();
    const alert = alerts.data.find(
      (entry: { menu_item_id: string }) => entry.menu_item_id === itemId,
    );
    expect(alert).toMatchObject({ stock_qty: 2, low_stock_qty: 2, level: "low" });

    const { data: events } = await admin
      .from("event_log")
      .select("type,payload,store_id")
      .eq("store_id", maputoStoreId)
      .eq("type", "stock.low")
      .order("created_at", { ascending: false })
      .limit(5);
    expect(events?.length).toBeGreaterThan(0);
    expect(events?.[0].payload).toMatchObject({ menu_item_id: itemId, stock_qty: 2 });

    await admin.from("event_log").delete().eq("type", "stock.low").eq("store_id", maputoStoreId);
  });

  it("marca o item esgotado como nível crítico", async () => {
    await setStock(maputoStoreId, { stock_qty: 1, low_stock_qty: 2 });
    const sale = await sell(manager, 1);
    expect(sale.error).toBeNull();

    const alerts = await manager.rpc("list_stock_alerts", { p_store_id: maputoStoreId });
    const alert = alerts.data.find(
      (entry: { menu_item_id: string }) => entry.menu_item_id === itemId,
    );
    expect(alert).toMatchObject({ stock_qty: 0, level: "out" });

    await admin
      .from("event_log")
      .delete()
      .in("type", ["stock.low", "stock.out"])
      .eq("store_id", maputoStoreId);
  });
});
