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
let maputoStoreId: string;
let classicSmashId: string;
let posDeviceId: string;
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
