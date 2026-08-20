/**
 * Gate de integração da F7 — loja pública multi-unidade.
 * Cobre a listagem pública de lojas, o encaminhamento do pedido para a loja
 * certa, as zonas/horários por loja e o kill switch `accepting_orders`.
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

type PublicStore = {
  slug: string;
  name: string;
  short_name: string;
  address: string | null;
  phone: string | null;
  maps_url: string | null;
  accepting_orders: boolean;
  delivery_enabled: boolean;
  pickup_enabled: boolean;
  open_now: boolean;
  hours: Array<{ dow: number; opens: string; closes: string; active: boolean }>;
};

let admin: SupabaseClient;
let anon: SupabaseClient;
let maputoStoreId: string;
let matolaStoreId: string;
let itemId: string;
const createdOrderIds: string[] = [];

beforeAll(async () => {
  admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  anon = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: stores, error } = await admin
    .from("stores")
    .select("id,slug")
    .in("slug", ["maputo", "matola"]);
  if (error || stores?.length !== 2) throw new Error(`Setup loja: lojas — ${error?.message}`);
  maputoStoreId = stores.find((store) => store.slug === "maputo")!.id;
  matolaStoreId = stores.find((store) => store.slug === "matola")!.id;

  const { data: item, error: itemError } = await admin
    .from("menu_items")
    .select("id")
    .eq("name", "Classic Smash")
    .single();
  if (itemError || !item) throw new Error(`Setup loja: item — ${itemError?.message}`);
  itemId = item.id;

  await admin
    .from("store_items")
    .update({ available: true, track_stock: false })
    .eq("menu_item_id", itemId)
    .in("store_id", [maputoStoreId, matolaStoreId]);
});

afterAll(async () => {
  if (!admin) return;
  await admin.from("stores").update({ accepting_orders: true }).eq("id", matolaStoreId);
  if (createdOrderIds.length > 0) {
    await admin.from("stock_movements").delete().in("order_id", createdOrderIds);
    await admin.from("orders").delete().in("id", createdOrderIds);
  }
});

async function createOrder(storeSlug: string, name: string) {
  const result = await anon.rpc("create_order", {
    p_store_slug: storeSlug,
    p_payload: {
      items: [{ menuItemId: itemId, qty: 1 }],
      customerName: name,
      fulfillmentType: "pickup",
      paymentMethod: "mpesa",
    },
  });
  if (result.data) createdOrderIds.push(result.data);
  return result;
}

describe("F7 — entrada pública com escolha de loja", () => {
  it("lista as lojas activas com horário e estado, sem expor segredos", async () => {
    const { data, error } = await anon.rpc("list_public_stores");
    expect(error).toBeNull();

    const stores = data as PublicStore[];
    expect(stores.map((store) => store.slug).sort()).toEqual(["maputo", "matola"]);

    const maputo = stores.find((store) => store.slug === "maputo")!;
    expect(maputo.short_name).toBe("Maputo");
    expect(maputo.hours.length).toBeGreaterThan(0);
    expect(typeof maputo.open_now).toBe("boolean");
    expect(typeof maputo.accepting_orders).toBe("boolean");

    const serialized = JSON.stringify(stores);
    expect(serialized).not.toContain("paysuite");
    expect(serialized).not.toContain("api_key");
    expect(serialized).not.toContain("webhook_secret");
  });

  it("devolve zonas e horários da loja escolhida, não da outra", async () => {
    const [{ data: maputoMenu }, { data: matolaMenu }] = await Promise.all([
      anon.rpc("get_menu", { p_store_slug: "maputo" }),
      anon.rpc("get_menu", { p_store_slug: "matola" }),
    ]);

    expect(maputoMenu.store.slug).toBe("maputo");
    expect(matolaMenu.store.slug).toBe("matola");
    expect(maputoMenu.hours).not.toEqual(matolaMenu.hours);

    const zoneIds = (menu: { zones: Array<{ id: string }> }) => menu.zones.map((zone) => zone.id);
    const shared = zoneIds(maputoMenu).filter((id) => zoneIds(matolaMenu).includes(id));
    expect(shared).toEqual([]);
  });
});

describe("F7 — encaminhamento e kill switch", () => {
  it("manda o pedido para a loja escolhida, com o prefixo e o papel dessa loja", async () => {
    const maputo = await createOrder("maputo", "Cliente F7 Maputo");
    const matola = await createOrder("matola", "Cliente F7 Matola");

    expect(maputo.error).toBeNull();
    expect(matola.error).toBeNull();

    const { data: orders } = await admin
      .from("orders")
      .select("id,store_id,order_number")
      .in("id", [maputo.data, matola.data]);

    const maputoOrder = orders!.find((order) => order.id === maputo.data)!;
    const matolaOrder = orders!.find((order) => order.id === matola.data)!;

    expect(maputoOrder.store_id).toBe(maputoStoreId);
    expect(matolaOrder.store_id).toBe(matolaStoreId);
    expect(maputoOrder.order_number.startsWith("MPT-")).toBe(true);
    expect(matolaOrder.order_number.startsWith("MTL-")).toBe(true);

    const { data: items } = await admin
      .from("order_items")
      .select("store_id")
      .eq("order_id", matolaOrder.id);
    expect(items!.every((line) => line.store_id === matolaStoreId)).toBe(true);
  });

  it("fecha só a loja desligada e deixa a outra a vender", async () => {
    const { error: killError } = await admin
      .from("stores")
      .update({ accepting_orders: false })
      .eq("id", matolaStoreId);
    expect(killError).toBeNull();

    try {
      const blocked = await createOrder("matola", "Cliente F7 bloqueado");
      expect(blocked.error?.message).toContain("store_not_accepting_orders");

      const allowed = await createOrder("maputo", "Cliente F7 permitido");
      expect(allowed.error).toBeNull();

      const { data: stores } = await anon.rpc("list_public_stores");
      const matola = (stores as PublicStore[]).find((store) => store.slug === "matola")!;
      expect(matola.accepting_orders).toBe(false);
    } finally {
      await admin.from("stores").update({ accepting_orders: true }).eq("id", matolaStoreId);
    }
  });
});

describe("F9 — ecrãs de TV", () => {
  it("mostra o esgotado na parede em vez de o esconder, sem dados internos", async () => {
    await admin
      .from("store_items")
      .update({ available: true, track_stock: true, stock_qty: 0 })
      .eq("store_id", maputoStoreId)
      .eq("menu_item_id", itemId);

    try {
      const { data, error } = await anon.rpc("get_store_board", { p_store_slug: "maputo" });
      expect(error).toBeNull();

      const board = data as {
        categories: Array<{ items: Array<{ id: string; available: boolean; price_cents: number }> }>;
      };
      const item = board.categories
        .flatMap((category) => category.items)
        .find((entry) => entry.id === itemId);

      expect(item).toBeTruthy();
      expect(item!.available).toBe(false);
      expect(Object.keys(item!).sort()).toEqual(["available", "id", "name", "price_cents"]);
    } finally {
      await admin
        .from("store_items")
        .update({ available: true, track_stock: false, stock_qty: 0 })
        .eq("store_id", maputoStoreId)
        .eq("menu_item_id", itemId);
    }
  });

  it("mostra as senhas da loja sem expor um único dado do cliente", async () => {
    const order = await createOrder("maputo", "Cliente TV Maputo");
    expect(order.error).toBeNull();

    await admin
      .from("orders")
      .update({ status: "ready", daily_number: 77 })
      .eq("id", order.data);

    const { data, error } = await anon.rpc("get_store_queue", { p_store_slug: "maputo" });
    expect(error).toBeNull();

    const queue = data as {
      store: { slug: string; short_name: string };
      ready: Array<{ daily_number: number; order_number: string }>;
      preparing: Array<{ daily_number: number }>;
    };
    expect(queue.store.slug).toBe("maputo");
    expect(queue.ready.some((entry) => entry.daily_number === 77)).toBe(true);

    const serialized = JSON.stringify(queue);
    expect(serialized).not.toContain("Cliente TV Maputo");
    expect(serialized).not.toContain("customer");
    expect(serialized).not.toContain("total_cents");

    const { data: matolaQueue } = await anon.rpc("get_store_queue", { p_store_slug: "matola" });
    expect(
      (matolaQueue as { ready: Array<{ daily_number: number }> }).ready.some(
        (entry) => entry.daily_number === 77,
      ),
    ).toBe(false);
  });
});

describe("F10 — numeração do pedido ao longo dos dias", () => {
  it("não repete o número do pedido quando o contador do dia recomeça", async () => {
    const first = await createOrder("maputo", "Cliente numeração 1");
    expect(first.error).toBeNull();

    // Simula a viragem do dia: o contador diário volta a zero.
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Maputo" });
    await admin
      .from("order_counters")
      .update({ seq: 0 })
      .eq("store_id", maputoStoreId)
      .eq("day", today);

    const second = await createOrder("maputo", "Cliente numeração 2");
    expect(second.error).toBeNull();

    const { data: orders } = await admin
      .from("orders")
      .select("id,order_number,daily_number")
      .in("id", [first.data, second.data]);

    const one = orders!.find((order) => order.id === first.data)!;
    const two = orders!.find((order) => order.id === second.data)!;

    // O número do pedido é contínuo por loja; o número do dia é que reinicia.
    expect(two.order_number).not.toBe(one.order_number);
    expect(Number(two.order_number.split("-")[1])).toBeGreaterThan(
      Number(one.order_number.split("-")[1]),
    );
    expect(two.daily_number).toBe(1);
  });

  it("dá número do dia ao pedido online, para a cozinha e para a TV de senhas", async () => {
    const order = await createOrder("matola", "Cliente senha online");
    expect(order.error).toBeNull();

    const { data: row } = await admin
      .from("orders")
      .select("daily_number,order_number")
      .eq("id", order.data)
      .single();

    expect(row?.daily_number).toBeGreaterThan(0);
    expect(row?.order_number?.startsWith("MTL-")).toBe(true);
  });
});
