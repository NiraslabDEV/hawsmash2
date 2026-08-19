/**
 * Gate de integração da F2 contra o Supabase de teste/staging.
 * Nunca apontar estas credenciais ao projecto de produção.
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

let admin: SupabaseClient;
let manager: SupabaseClient;
let cashier: SupabaseClient;
let maputoStoreId: string;
let classicSmashId: string;
let posDeviceId: string;
let originalStoreItem: {
  available: boolean;
  track_stock: boolean;
  stock_qty: number;
};
const createdDeviceIds: string[] = [];
const createdOrderIds: string[] = [];
const createdUserIds: string[] = [];

beforeAll(async () => {
  admin = createClient(SUPABASE_URL, SERVICE_KEY);

  const { data: store, error } = await admin
    .from("stores")
    .select("id")
    .eq("slug", "maputo")
    .single();

  if (error || !store) {
    throw new Error(`Setup POS: loja Maputo não encontrada — ${error?.message}`);
  }

  maputoStoreId = store.id;

  const { data: item, error: itemError } = await admin
    .from("menu_items")
    .select("id,price_cents")
    .eq("name", "Classic Smash")
    .single();
  if (itemError || !item || item.price_cents !== 30000) {
    throw new Error(`Setup POS: Classic Smash inválido — ${itemError?.message}`);
  }
  classicSmashId = item.id;

  const { data: storeItem, error: storeItemError } = await admin
    .from("store_items")
    .select("available,track_stock,stock_qty")
    .eq("store_id", maputoStoreId)
    .eq("menu_item_id", classicSmashId)
    .single();
  if (storeItemError || !storeItem) {
    throw new Error(`Setup POS: stock da loja — ${storeItemError?.message}`);
  }
  originalStoreItem = storeItem;

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const password = "Pos-F2-Teste-2026!";
  const { data: created, error: createUserError } = await admin.auth.admin.createUser({
    email: `pos-manager-${suffix}@delivery.test`,
    password,
    email_confirm: true,
  });
  if (createUserError || !created.user) {
    throw new Error(`Setup POS: utilizador — ${createUserError?.message}`);
  }
  createdUserIds.push(created.user.id);

  const { error: profileError } = await admin.from("staff_profiles").insert({
    user_id: created.user.id,
    full_name: "Gerente POS F2",
    role: "manager",
    active: true,
  });
  if (profileError) throw new Error(`Setup POS: perfil — ${profileError.message}`);

  const { error: staffStoreError } = await admin.from("staff_stores").insert({
    user_id: created.user.id,
    store_id: maputoStoreId,
  });
  if (staffStoreError) throw new Error(`Setup POS: loja — ${staffStoreError.message}`);

  manager = createClient(SUPABASE_URL, ANON_KEY);
  const { error: loginError } = await manager.auth.signInWithPassword({
    email: `pos-manager-${suffix}@delivery.test`,
    password,
  });
  if (loginError) throw new Error(`Setup POS: login — ${loginError.message}`);

  const cashierPassword = "Pos-Caixa-F2-Teste-2026!";
  const { data: cashierUser, error: cashierUserError } =
    await admin.auth.admin.createUser({
      email: `pos-cashier-${suffix}@delivery.test`,
      password: cashierPassword,
      email_confirm: true,
    });
  if (cashierUserError || !cashierUser.user) {
    throw new Error(`Setup POS: caixa — ${cashierUserError?.message}`);
  }
  createdUserIds.push(cashierUser.user.id);

  const { error: cashierProfileError } = await admin.from("staff_profiles").insert({
    user_id: cashierUser.user.id,
    full_name: "Caixa POS F2",
    role: "cashier",
    active: true,
  });
  if (cashierProfileError) {
    throw new Error(`Setup POS: perfil caixa — ${cashierProfileError.message}`);
  }
  const { error: cashierStoreError } = await admin.from("staff_stores").insert({
    user_id: cashierUser.user.id,
    store_id: maputoStoreId,
  });
  if (cashierStoreError) {
    throw new Error(`Setup POS: loja caixa — ${cashierStoreError.message}`);
  }

  cashier = createClient(SUPABASE_URL, ANON_KEY);
  const { error: cashierLoginError } = await cashier.auth.signInWithPassword({
    email: `pos-cashier-${suffix}@delivery.test`,
    password: cashierPassword,
  });
  if (cashierLoginError) {
    throw new Error(`Setup POS: login caixa — ${cashierLoginError.message}`);
  }

  const { data: device, error: deviceError } = await admin
    .from("devices")
    .insert({
      store_id: maputoStoreId,
      kind: "pos",
      label: "POS principal teste F2",
      device_key_hash: `teste-f2-${suffix}`,
    })
    .select("id")
    .single();
  if (deviceError || !device) {
    throw new Error(`Setup POS: dispositivo — ${deviceError?.message}`);
  }
  posDeviceId = device.id;
  createdDeviceIds.push(device.id);
});

afterAll(async () => {
  if (createdOrderIds.length > 0) {
    await admin.from("orders").delete().in("id", createdOrderIds);
  }
  if (createdDeviceIds.length > 0) {
    await admin.from("devices").delete().in("id", createdDeviceIds);
  }
  if (originalStoreItem) {
    await admin
      .from("store_items")
      .update(originalStoreItem)
      .eq("store_id", maputoStoreId)
      .eq("menu_item_id", classicSmashId);
  }
  for (const userId of createdUserIds) {
    await admin.auth.admin.deleteUser(userId);
  }
});

describe("F2 — schema do POS", () => {
  it("expõe os campos de venda de balcão em orders", async () => {
    const { error } = await admin
      .from("orders")
      .select(
        "client_sale_id,daily_number,cash_received_cents,change_cents,needs_review,channel",
      )
      .limit(1);

    expect(error).toBeNull();
  });

  it("regista um dispositivo POS ligado a uma loja", async () => {
    const { data, error } = await admin
      .from("devices")
      .select("id,store_id,kind,active")
      .eq("id", posDeviceId)
      .single();

    expect(error).toBeNull();
    expect(data).toMatchObject({
      store_id: maputoStoreId,
      kind: "pos",
      active: true,
    });
  });

  it("rejeita tipos de dispositivo desconhecidos", async () => {
    const { error } = await admin.from("devices").insert({
      store_id: maputoStoreId,
      kind: "terminal_desconhecido",
      label: "Inválido",
      device_key_hash: "teste-f2-invalido-nao-real",
    });

    expect(error).not.toBeNull();
  });
});

describe("F2 — create_counter_sale", () => {
  it("é idempotente e calcula preço e troco no servidor", async () => {
    const clientSaleId = crypto.randomUUID();
    const payload = {
      clientSaleId,
      deviceId: posDeviceId,
      items: [
        {
          menuItemId: classicSmashId,
          qty: 1,
          unitPriceCents: 1,
        },
      ],
      payments: [{ method: "cash", amountCents: 30000 }],
      cashReceivedCents: 50000,
    };

    const first = await manager.rpc("create_counter_sale", { p_payload: payload });
    const second = await manager.rpc("create_counter_sale", { p_payload: payload });

    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    expect(first.data.order_id).toBe(second.data.order_id);
    expect(first.data).toMatchObject({
      total_cents: 30000,
      cash_received_cents: 50000,
      change_cents: 20000,
      duplicate: false,
    });
    expect(second.data.duplicate).toBe(true);

    createdOrderIds.push(first.data.order_id);

    const { data: orders, error: orderError } = await admin
      .from("orders")
      .select(
        "id,status,channel,daily_number,total_cents,cash_received_cents,change_cents",
      )
      .eq("client_sale_id", clientSaleId);

    expect(orderError).toBeNull();
    expect(orders).toHaveLength(1);
    expect(orders?.[0]).toMatchObject({
      status: "paid",
      channel: "counter",
      total_cents: 30000,
      cash_received_cents: 50000,
      change_cents: 20000,
    });
    expect(orders?.[0].daily_number).toBeGreaterThan(0);

    const { data: payments, error: paymentsError } = await admin
      .from("payments")
      .select("method,amount_cents,status")
      .eq("order_id", first.data.order_id);

    expect(paymentsError).toBeNull();
    expect(payments).toEqual([
      { method: "cash", amount_cents: 30000, status: "confirmed" },
    ]);
  });
});

describe("F2 — void_sale", () => {
  it("exige gerente, anula por advance_order e repõe stock uma só vez", async () => {
    const { error: stockSetupError } = await admin
      .from("store_items")
      .update({ available: true, track_stock: true, stock_qty: 2 })
      .eq("store_id", maputoStoreId)
      .eq("menu_item_id", classicSmashId);
    expect(stockSetupError).toBeNull();

    const clientSaleId = crypto.randomUUID();
    const sale = await manager.rpc("create_counter_sale", {
      p_payload: {
        clientSaleId,
        deviceId: posDeviceId,
        items: [{ menuItemId: classicSmashId, qty: 1 }],
        payments: [{ method: "cash", amountCents: 30000 }],
        cashReceivedCents: 30000,
      },
    });
    expect(sale.error).toBeNull();
    createdOrderIds.push(sale.data.order_id);

    const denied = await cashier.rpc("void_sale", {
      p_order_id: sale.data.order_id,
      p_reason: "Erro registado pelo caixa",
    });
    expect(denied.error?.message).toContain("void_access_denied");

    const first = await manager.rpc("void_sale", {
      p_order_id: sale.data.order_id,
      p_reason: "Cliente desistiu antes da entrega",
    });
    const second = await manager.rpc("void_sale", {
      p_order_id: sale.data.order_id,
      p_reason: "Cliente desistiu antes da entrega",
    });

    expect(first.error).toBeNull();
    expect(first.data).toMatchObject({ status: "cancelled", duplicate: false });
    expect(second.error).toBeNull();
    expect(second.data).toMatchObject({ status: "cancelled", duplicate: true });

    const [{ data: order }, { data: stock }, { data: events }] = await Promise.all([
      admin.from("orders").select("status").eq("id", sale.data.order_id).single(),
      admin
        .from("store_items")
        .select("stock_qty")
        .eq("store_id", maputoStoreId)
        .eq("menu_item_id", classicSmashId)
        .single(),
      admin
        .from("event_log")
        .select("type,actor_user_id")
        .eq("order_id", sale.data.order_id)
        .eq("type", "counter.sale_voided"),
    ]);

    expect(order?.status).toBe("cancelled");
    expect(stock?.stock_qty).toBe(2);
    expect(events).toHaveLength(1);
    expect(events?.[0].actor_user_id).toBeTruthy();
  });
});
