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
let matolaStoreId: string;
let classicSmashId: string;
let posDeviceId: string;
let matolaPosDeviceId: string;
let managerUserId: string;
let originalStoreItem: {
  available: boolean;
  track_stock: boolean;
  stock_qty: number;
};
const createdDeviceIds: string[] = [];
const createdOrderIds: string[] = [];
const createdUserIds: string[] = [];
const createdDrawerRequestIds: string[] = [];

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

  const { data: matolaStore, error: matolaStoreError } = await admin
    .from("stores")
    .select("id")
    .eq("slug", "matola")
    .single();
  if (matolaStoreError || !matolaStore) {
    throw new Error(`Setup POS: loja Matola não encontrada — ${matolaStoreError?.message}`);
  }
  matolaStoreId = matolaStore.id;

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
  managerUserId = created.user.id;

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

  const { data: matolaDevice, error: matolaDeviceError } = await admin
    .from("devices")
    .insert({
      store_id: matolaStoreId,
      kind: "pos",
      label: "POS Matola teste F3",
      device_key_hash: `teste-f3-matola-${suffix}`,
    })
    .select("id")
    .single();
  if (matolaDeviceError || !matolaDevice) {
    throw new Error(`Setup POS: dispositivo Matola — ${matolaDeviceError?.message}`);
  }
  matolaPosDeviceId = matolaDevice.id;
  createdDeviceIds.push(matolaDevice.id);
});

afterAll(async () => {
  if (createdDrawerRequestIds.length > 0) {
    await admin.from("print_jobs").delete().in("request_id", createdDrawerRequestIds);
  }
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

  it("lista apenas dispositivos da loja do gerente no estado operacional", async () => {
    await admin
      .from("devices")
      .update({ last_seen_at: new Date().toISOString() })
      .in("id", [posDeviceId, matolaPosDeviceId]);

    const { data, error } = await manager.rpc("get_device_status");
    expect(error).toBeNull();
    expect(data.threshold_seconds).toBe(120);
    expect(data.devices.some((device: { id: string }) => device.id === posDeviceId)).toBe(true);
    expect(data.devices.some((device: { id: string }) => device.id === matolaPosDeviceId)).toBe(false);
  });
});

describe("F2 — vinculação e bloqueio do POS", () => {
  it("permite ao gerente vincular um terminal à sua loja e audita a acção", async () => {
    const label = `POS vinculado ${Date.now()}`;
    const { data, error } = await manager.rpc("bind_pos_device", {
      p_store_id: maputoStoreId,
      p_label: label,
    });

    expect(error).toBeNull();
    expect(data?.device_id).toBeTruthy();
    createdDeviceIds.push(data.device_id);

    const [{ data: device }, { data: events }] = await Promise.all([
      admin
        .from("devices")
        .select("store_id,kind,label,active,created_by")
        .eq("id", data.device_id)
        .single(),
      admin
        .from("event_log")
        .select("store_id,actor_user_id,type")
        .eq("type", "pos.device_bound")
        .eq("payload->>device_id", data.device_id),
    ]);

    expect(device).toMatchObject({
      store_id: maputoStoreId,
      kind: "pos",
      label,
      active: true,
      created_by: managerUserId,
    });
    expect(events).toEqual([
      {
        store_id: maputoStoreId,
        actor_user_id: managerUserId,
        type: "pos.device_bound",
      },
    ]);
  });

  it("impede o caixa de vincular um terminal", async () => {
    const { error } = await cashier.rpc("bind_pos_device", {
      p_store_id: maputoStoreId,
      p_label: "POS sem autorização",
    });

    expect(error?.message).toContain("device_binding_access_denied");
  });

  it("guarda o PIN com hash e só desbloqueia o terminal com o PIN certo", async () => {
    const setPin = await manager.rpc("set_own_pos_pin", {
      p_device_id: posDeviceId,
      p_pin: "4826",
    });
    expect(setPin.error).toBeNull();

    const { data: profile } = await admin
      .from("staff_profiles")
      .select("pin_hash")
      .eq("user_id", managerUserId)
      .single();
    expect(profile?.pin_hash).toBeTruthy();
    expect(profile?.pin_hash).not.toContain("4826");

    const locked = await manager.rpc("lock_pos_device", { p_device_id: posDeviceId });
    expect(locked.error).toBeNull();

    const saleWhileLocked = await manager.rpc("create_counter_sale", {
      p_payload: {
        clientSaleId: crypto.randomUUID(),
        deviceId: posDeviceId,
        items: [{ menuItemId: classicSmashId, qty: 1 }],
        payments: [{ method: "cash", amountCents: 30000 }],
        cashReceivedCents: 30000,
      },
    });
    expect(saleWhileLocked.error?.message).toContain("device_locked");

    const wrong = await manager.rpc("unlock_pos_device", {
      p_device_id: posDeviceId,
      p_pin: "0000",
    });
    expect(wrong.error?.message).toContain("invalid_pin");

    const unlocked = await manager.rpc("unlock_pos_device", {
      p_device_id: posDeviceId,
      p_pin: "4826",
    });
    expect(unlocked.error).toBeNull();

    const { data: device } = await admin
      .from("devices")
      .select("locked_at")
      .eq("id", posDeviceId)
      .single();
    expect(device?.locked_at).toBeNull();
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

  it("rejeita produto esgotado sem criar pedido nem pagamento", async () => {
    const clientSaleId = crypto.randomUUID();
    const { error: stockSetupError } = await admin
      .from("store_items")
      .update({ available: true, track_stock: true, stock_qty: 0 })
      .eq("store_id", maputoStoreId)
      .eq("menu_item_id", classicSmashId);
    expect(stockSetupError).toBeNull();

    try {
      const sale = await manager.rpc("create_counter_sale", {
        p_payload: {
          clientSaleId,
          deviceId: posDeviceId,
          items: [{ menuItemId: classicSmashId, qty: 1 }],
          payments: [{ method: "cash", amountCents: 30000 }],
          cashReceivedCents: 30000,
        },
      });

      expect(sale.error?.message).toContain("out_of_stock");

      const { data: orders } = await admin
        .from("orders")
        .select("id")
        .eq("client_sale_id", clientSaleId);
      expect(orders).toEqual([]);
    } finally {
      await admin
        .from("store_items")
        .update(originalStoreItem)
        .eq("store_id", maputoStoreId)
        .eq("menu_item_id", classicSmashId);
    }
  });

  it("fecha pagamento misto apenas quando as parcelas igualam o total", async () => {
    const clientSaleId = crypto.randomUUID();
    const sale = await manager.rpc("create_counter_sale", {
      p_payload: {
        clientSaleId,
        deviceId: posDeviceId,
        items: [{ menuItemId: classicSmashId, qty: 1 }],
        payments: [
          { method: "cash", amountCents: 10000 },
          { method: "mpesa", amountCents: 20000 },
        ],
        cashReceivedCents: 10000,
      },
    });

    expect(sale.error).toBeNull();
    expect(sale.data).toMatchObject({ total_cents: 30000, change_cents: 0 });
    createdOrderIds.push(sale.data.order_id);

    const { data: payments, error } = await admin
      .from("payments")
      .select("method,amount_cents,status")
      .eq("order_id", sale.data.order_id)
      .order("amount_cents");

    expect(error).toBeNull();
    expect(payments).toEqual([
      { method: "cash", amount_cents: 10000, status: "confirmed" },
      { method: "mpesa", amount_cents: 20000, status: "confirmed" },
    ]);
  });
});

describe("F4 — sync_counter_sale", () => {
  it("sincroniza sem duplicar a venda nem o papel já emitido localmente", async () => {
    const clientSaleId = crypto.randomUUID();
    const payload = {
      clientSaleId,
      deviceId: posDeviceId,
      items: [{ menuItemId: classicSmashId, qty: 1 }],
      payments: [{ method: "cash", amountCents: 30000 }],
      cashReceivedCents: 30000,
    };
    const localPrint = { receipt: true, drawer: true, stations: ["kitchen"] };

    const first = await manager.rpc("sync_counter_sale", {
      p_payload: payload,
      p_local_print: localPrint,
    });
    const retry = await manager.rpc("sync_counter_sale", {
      p_payload: payload,
      p_local_print: localPrint,
    });

    expect(first.error).toBeNull();
    expect(retry.error).toBeNull();
    expect(retry.data.order_id).toBe(first.data.order_id);
    createdOrderIds.push(first.data.order_id);

    const { count: orderCount } = await admin
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("client_sale_id", clientSaleId);
    expect(orderCount).toBe(1);

    const { data: jobs, error: jobsError } = await admin
      .from("print_jobs")
      .select("kind,station,status")
      .eq("order_id", first.data.order_id);
    expect(jobsError).toBeNull();
    expect(jobs?.length).toBeGreaterThanOrEqual(3);
    expect(jobs?.every((job) => job.status === "printed")).toBe(true);
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

describe("F3 — gaveta", () => {
  it("enfileira um único pulso na venda com numerário e nenhum no pagamento móvel", async () => {
    const cashClientSaleId = crypto.randomUUID();
    const cashPayload = {
      clientSaleId: cashClientSaleId,
      deviceId: posDeviceId,
      items: [{ menuItemId: classicSmashId, qty: 1 }],
      payments: [{ method: "cash", amountCents: 30000 }],
      cashReceivedCents: 30000,
    };

    const first = await manager.rpc("create_counter_sale", { p_payload: cashPayload });
    const retry = await manager.rpc("create_counter_sale", { p_payload: cashPayload });
    expect(first.error).toBeNull();
    expect(retry.error).toBeNull();
    createdOrderIds.push(first.data.order_id);

    const { data: cashJobs, error: cashJobError } = await admin
      .from("print_jobs")
      .select("store_id,order_id,station,kind,request_id,payload")
      .eq("order_id", first.data.order_id)
      .eq("kind", "drawer");
    expect(cashJobError).toBeNull();
    expect(cashJobs).toHaveLength(1);
    expect(cashJobs?.[0]).toMatchObject({
      store_id: maputoStoreId,
      order_id: first.data.order_id,
      station: "counter",
      kind: "drawer",
      request_id: first.data.order_id,
      payload: { source: "counter_sale", request_id: first.data.order_id },
    });

    const mobileClientSaleId = crypto.randomUUID();
    const mobile = await manager.rpc("create_counter_sale", {
      p_payload: {
        clientSaleId: mobileClientSaleId,
        deviceId: posDeviceId,
        items: [{ menuItemId: classicSmashId, qty: 1 }],
        payments: [{ method: "mpesa", amountCents: 30000 }],
      },
    });
    expect(mobile.error).toBeNull();
    createdOrderIds.push(mobile.data.order_id);

    const { count: mobileDrawerCount } = await admin
      .from("print_jobs")
      .select("id", { count: "exact", head: true })
      .eq("order_id", mobile.data.order_id)
      .eq("kind", "drawer");
    expect(mobileDrawerCount).toBe(0);
  });

  it("exige gerente da loja, motivo e audita uma abertura excepcional idempotente", async () => {
    const requestId = crypto.randomUUID();
    createdDrawerRequestIds.push(requestId);

    const deniedCashier = await cashier.rpc("open_cash_drawer", {
      p_device_id: posDeviceId,
      p_request_id: crypto.randomUUID(),
      p_reason: "Trocar dinheiro para o cliente",
    });
    expect(deniedCashier.error?.message).toContain("drawer_access_denied");

    const deniedOtherStore = await manager.rpc("open_cash_drawer", {
      p_device_id: matolaPosDeviceId,
      p_request_id: crypto.randomUUID(),
      p_reason: "Teste indevido entre lojas",
    });
    expect(deniedOtherStore.error?.message).toContain("invalid_or_unauthorised_device");

    const missingReason = await manager.rpc("open_cash_drawer", {
      p_device_id: posDeviceId,
      p_request_id: crypto.randomUUID(),
      p_reason: "  ",
    });
    expect(missingReason.error?.message).toContain("drawer_reason_required");

    const first = await manager.rpc("open_cash_drawer", {
      p_device_id: posDeviceId,
      p_request_id: requestId,
      p_reason: "Trocar dinheiro para o cliente",
    });
    const retry = await manager.rpc("open_cash_drawer", {
      p_device_id: posDeviceId,
      p_request_id: requestId,
      p_reason: "Trocar dinheiro para o cliente",
    });
    expect(first.error).toBeNull();
    expect(first.data).toMatchObject({ request_id: requestId, duplicate: false });
    expect(retry.error).toBeNull();
    expect(retry.data).toMatchObject({ request_id: requestId, duplicate: true });

    const [{ data: jobs }, { data: events }] = await Promise.all([
      admin
        .from("print_jobs")
        .select("store_id,order_id,station,kind,request_id,payload")
        .eq("request_id", requestId),
      admin
        .from("event_log")
        .select("store_id,actor_user_id,type,payload")
        .eq("type", "cash.drawer_opened_outside_sale")
        .eq("payload->>request_id", requestId),
    ]);

    expect(jobs).toHaveLength(1);
    expect(jobs?.[0]).toMatchObject({
      store_id: maputoStoreId,
      order_id: null,
      station: "counter",
      kind: "drawer",
      request_id: requestId,
      payload: { reason: "Trocar dinheiro para o cliente", request_id: requestId },
    });
    expect(events).toHaveLength(1);
    expect(events?.[0]).toMatchObject({
      store_id: maputoStoreId,
      actor_user_id: managerUserId,
      type: "cash.drawer_opened_outside_sale",
    });
  });
});

describe("F3 — talões da venda", () => {
  it("enfileira uma comanda sem preços e um talão com troco uma só vez", async () => {
    const { error: stockSetupError } = await admin
      .from("store_items")
      .update({ available: true, track_stock: true, stock_qty: 5 })
      .eq("store_id", maputoStoreId)
      .eq("menu_item_id", classicSmashId);
    expect(stockSetupError).toBeNull();

    const clientSaleId = crypto.randomUUID();
    const payload = {
      clientSaleId,
      deviceId: posDeviceId,
      items: [{ menuItemId: classicSmashId, qty: 2, notes: "Sem cebola" }],
      payments: [{ method: "cash", amountCents: 60000 }],
      cashReceivedCents: 100000,
    };

    const first = await manager.rpc("create_counter_sale", { p_payload: payload });
    const retry = await manager.rpc("create_counter_sale", { p_payload: payload });
    expect(first.error).toBeNull();
    expect(retry.error).toBeNull();
    createdOrderIds.push(first.data.order_id);

    const { data: jobs, error } = await admin
      .from("print_jobs")
      .select("store_id,order_id,station,kind,reprint_seq,payload")
      .eq("order_id", first.data.order_id)
      .in("kind", ["order", "receipt"])
      .order("kind");

    expect(error).toBeNull();
    expect(jobs).toHaveLength(2);

    const kitchen = jobs?.find((job) => job.kind === "order");
    const receipt = jobs?.find((job) => job.kind === "receipt");
    expect(kitchen).toMatchObject({
      store_id: maputoStoreId,
      station: "kitchen",
      reprint_seq: 0,
      payload: {
        template: "kitchen",
        daily_number: first.data.daily_number,
        order_number: first.data.order_number,
        channel: "counter",
        items: [{ name: "Classic Smash", quantity: 2, notes: "Sem cebola" }],
      },
    });
    expect(kitchen?.payload).not.toHaveProperty("total_cents");
    expect(kitchen?.payload.items[0]).not.toHaveProperty("unit_price_cents");

    expect(receipt).toMatchObject({
      store_id: maputoStoreId,
      station: "counter",
      reprint_seq: 0,
      payload: {
        template: "receipt",
        daily_number: first.data.daily_number,
        order_number: first.data.order_number,
        subtotal_cents: 60000,
        total_cents: 60000,
        cash_received_cents: 100000,
        change_cents: 40000,
        items: [
          {
            name: "Classic Smash",
            quantity: 2,
            unit_price_cents: 30000,
            line_total_cents: 60000,
          },
        ],
        payments: [{ method: "cash", amount_cents: 60000 }],
      },
    });
  });
});

describe("F3 — reimpressão auditada", () => {
  it("é idempotente por pedido de reimpressão e incrementa a sequência", async () => {
    const { error: stockSetupError } = await admin
      .from("store_items")
      .update({ available: true, track_stock: true, stock_qty: 5 })
      .eq("store_id", maputoStoreId)
      .eq("menu_item_id", classicSmashId);
    expect(stockSetupError).toBeNull();

    const sale = await manager.rpc("create_counter_sale", {
      p_payload: {
        clientSaleId: crypto.randomUUID(),
        deviceId: posDeviceId,
        items: [{ menuItemId: classicSmashId, qty: 1 }],
        payments: [{ method: "mpesa", amountCents: 30000 }],
      },
    });
    expect(sale.error).toBeNull();
    createdOrderIds.push(sale.data.order_id);

    const requestId = crypto.randomUUID();
    const [first, concurrentRetry] = await Promise.all([
      cashier.rpc("reprint", {
        p_order_id: sale.data.order_id,
        p_kind: "receipt",
        p_request_id: requestId,
      }),
      cashier.rpc("reprint", {
        p_order_id: sale.data.order_id,
        p_kind: "receipt",
        p_request_id: requestId,
      }),
    ]);
    expect(first.error).toBeNull();
    expect(concurrentRetry.error).toBeNull();
    expect([first.data.duplicate, concurrentRetry.data.duplicate].sort()).toEqual([false, true]);
    expect(first.data.reprint_seq).toBe(1);
    expect(concurrentRetry.data.reprint_seq).toBe(1);

    const secondRequestId = crypto.randomUUID();
    const second = await manager.rpc("reprint", {
      p_order_id: sale.data.order_id,
      p_kind: "receipt",
      p_request_id: secondRequestId,
    });
    expect(second.error).toBeNull();
    expect(second.data).toMatchObject({ duplicate: false, reprint_seq: 2 });

    const [{ data: jobs }, { data: events }] = await Promise.all([
      admin
        .from("print_jobs")
        .select("kind,station,reprint_seq,request_id,payload")
        .eq("order_id", sale.data.order_id)
        .eq("kind", "receipt")
        .gt("reprint_seq", 0)
        .order("reprint_seq"),
      admin
        .from("event_log")
        .select("actor_user_id,type,payload")
        .eq("order_id", sale.data.order_id)
        .eq("type", "print.reprinted")
        .order("created_at"),
    ]);
    expect(jobs).toHaveLength(2);
    expect(jobs?.map((job) => job.reprint_seq)).toEqual([1, 2]);
    expect(jobs?.[0]).toMatchObject({
      kind: "receipt",
      station: "counter",
      request_id: requestId,
      payload: { template: "receipt", order_number: sale.data.order_number },
    });
    expect(events).toHaveLength(2);
    expect(events?.every((event) => Boolean(event.actor_user_id))).toBe(true);
  });

  it("recusa tipos perigosos e pedidos de outra loja", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const { data: otherOrder, error: otherOrderError } = await admin
      .from("orders")
      .insert({
        store_id: matolaStoreId,
        order_number: `MAT-RP-${suffix}`,
        status: "paid",
        flow: "manual",
        fulfillment_type: "pickup",
        channel: "counter",
        customer_name: "Teste entre lojas",
        subtotal_cents: 30000,
        total_cents: 30000,
        payment_method: "cash",
      })
      .select("id")
      .single();
    expect(otherOrderError).toBeNull();
    createdOrderIds.push(otherOrder.id);

    const crossStore = await manager.rpc("reprint", {
      p_order_id: otherOrder.id,
      p_kind: "receipt",
      p_request_id: crypto.randomUUID(),
    });
    expect(crossStore.error?.message).toContain("order_not_found_or_unauthorised");

    const drawer = await manager.rpc("reprint", {
      p_order_id: otherOrder.id,
      p_kind: "drawer",
      p_request_id: crypto.randomUUID(),
    });
    expect(drawer.error?.message).toContain("invalid_reprint_kind");
  });
});
