/**
 * Gate de integração da ficha técnica (1024–1027).
 *
 * O que aqui se prova é o que motivou a funcionalidade: um Classic HAW e um
 * Classic WAGYU deixam de baixar o mesmo saldo. Cobre também o consumo por
 * variante, a falta de matéria-prima a travar a venda inteira, a reposição na
 * anulação, o custo congelado na linha e o isolamento entre lojas.
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
let owner: SupabaseClient;
let cashier: SupabaseClient;
let matolaManager: SupabaseClient;

let maputoStoreId: string;
let matolaStoreId: string;
let posDeviceId: string;

let classicId: string;
let doubleId: string;
let classicHawVariantId: string;
let classicWagyuVariantId: string;

let rawId: string;
let wagyuId: string;
let cheeseId: string;

const createdUserIds: string[] = [];
const createdDeviceIds: string[] = [];
const createdOrderIds: string[] = [];
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const PASSWORD = "Ficha-Tecnica-Teste-2026!";

async function createStaff(
  role: "owner" | "manager" | "cashier",
  storeId: string,
  label: string,
): Promise<SupabaseClient> {
  const email = `recipe-${label}-${suffix}@delivery.test`;
  const { data: user, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !user.user) throw new Error(`Setup ficha: utilizador ${label} — ${error?.message}`);
  createdUserIds.push(user.user.id);

  const { error: profileError } = await admin.from("staff_profiles").insert({
    user_id: user.user.id,
    full_name: `Equipa Ficha ${label}`,
    role,
    active: true,
  });
  if (profileError) throw new Error(`Setup ficha: perfil ${label} — ${profileError.message}`);

  const { error: storeError } = await admin
    .from("staff_stores")
    .insert({ user_id: user.user.id, store_id: storeId });
  if (storeError) throw new Error(`Setup ficha: loja ${label} — ${storeError.message}`);

  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: loginError } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (loginError) throw new Error(`Setup ficha: login ${label} — ${loginError.message}`);
  return client;
}

async function ingredientId(name: string): Promise<string> {
  const { data, error } = await admin
    .from("ingredients")
    .select("id")
    .eq("name", name)
    .single();
  if (error || !data) throw new Error(`Setup ficha: ingrediente ${name} — ${error?.message}`);
  return data.id;
}

async function setIngredient(
  storeId: string,
  id: string,
  values: { qty: number; track?: boolean; low_qty?: number },
): Promise<void> {
  const { error } = await admin
    .from("store_ingredients")
    .update({
      qty: values.qty,
      track: values.track ?? true,
      low_qty: values.low_qty ?? 0,
    })
    .eq("store_id", storeId)
    .eq("ingredient_id", id);
  if (error) throw new Error(`Setup ficha: store_ingredients — ${error.message}`);
}

async function readIngredient(storeId: string, id: string): Promise<number> {
  const { data, error } = await admin
    .from("store_ingredients")
    .select("qty")
    .eq("store_id", storeId)
    .eq("ingredient_id", id)
    .single();
  if (error || !data) throw new Error(`Leitura de ingrediente — ${error?.message}`);
  return data.qty;
}

type SaleLine = { menuItemId: string; qty: number; variantId?: string };

async function sell(lines: SaleLine[], totalCents: number) {
  const result = await cashier.rpc("create_counter_sale", {
    p_payload: {
      clientSaleId: crypto.randomUUID(),
      deviceId: posDeviceId,
      items: lines,
      payments: [{ method: "cash", amountCents: totalCents }],
      cashReceivedCents: totalCents,
    },
  });
  if (result.data?.order_id) createdOrderIds.push(result.data.order_id);
  return result;
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
    throw new Error(`Setup ficha: lojas — ${storesError?.message}`);
  }
  maputoStoreId = stores.find((store) => store.slug === "maputo")!.id;
  matolaStoreId = stores.find((store) => store.slug === "matola")!.id;

  const { data: items, error: itemsError } = await admin
    .from("menu_items")
    .select("id,name")
    .in("name", ["Classic Smash", "Double Smash"]);
  if (itemsError || items?.length !== 2) {
    throw new Error(`Setup ficha: produtos — ${itemsError?.message}`);
  }
  classicId = items.find((item) => item.name === "Classic Smash")!.id;
  doubleId = items.find((item) => item.name === "Double Smash")!.id;

  const { data: variants, error: variantsError } = await admin
    .from("menu_item_variants")
    .select("id,name")
    .eq("menu_item_id", classicId);
  if (variantsError || !variants) {
    throw new Error(`Setup ficha: variantes — ${variantsError?.message}`);
  }
  classicHawVariantId = variants.find((variant) => variant.name === "HAW")!.id;
  classicWagyuVariantId = variants.find((variant) => variant.name === "WAGYU")!.id;

  rawId = await ingredientId("Carne RAW");
  wagyuId = await ingredientId("Carne WAGYU");
  cheeseId = await ingredientId("Queijo cheddar (fatia)");

  owner = await createStaff("owner", maputoStoreId, "dono");
  cashier = await createStaff("cashier", maputoStoreId, "caixa");
  matolaManager = await createStaff("manager", matolaStoreId, "matola");

  const { data: device, error: deviceError } = await admin
    .from("devices")
    .insert({
      store_id: maputoStoreId,
      kind: "pos",
      label: "POS ficha tecnica",
      device_key_hash: `teste-ficha-${suffix}`,
    })
    .select("id")
    .single();
  if (deviceError || !device) throw new Error(`Setup ficha: dispositivo — ${deviceError?.message}`);
  posDeviceId = device.id;
  createdDeviceIds.push(device.id);
});

beforeEach(async () => {
  for (const storeId of [maputoStoreId, matolaStoreId]) {
    await setIngredient(storeId, rawId, { qty: 20 });
    await setIngredient(storeId, wagyuId, { qty: 20 });
    await setIngredient(storeId, cheeseId, { qty: 20 });
  }
  // O produto final não pode ser quem trava: quem conta aqui é a matéria-prima.
  await admin
    .from("store_items")
    .update({ track_stock: false, available: true })
    .in("store_id", [maputoStoreId, matolaStoreId])
    .in("menu_item_id", [classicId, doubleId]);
});

afterAll(async () => {
  for (const orderId of createdOrderIds) {
    await admin.from("orders").delete().eq("id", orderId);
  }
  for (const deviceId of createdDeviceIds) {
    await admin.from("devices").delete().eq("id", deviceId);
  }
  for (const userId of createdUserIds) {
    await admin.from("staff_stores").delete().eq("user_id", userId);
    await admin.from("staff_profiles").delete().eq("user_id", userId);
    await admin.auth.admin.deleteUser(userId);
  }
});

describe("ficha técnica — consumo por variante", () => {
  it("Classic HAW consome carne RAW e não toca na WAGYU", async () => {
    const result = await sell([{ menuItemId: classicId, qty: 1, variantId: classicHawVariantId }], 30000);
    expect(result.error).toBeNull();

    expect(await readIngredient(maputoStoreId, rawId)).toBe(19);
    expect(await readIngredient(maputoStoreId, wagyuId)).toBe(20);
    expect(await readIngredient(maputoStoreId, cheeseId)).toBe(19);
  });

  it("Classic WAGYU consome carne WAGYU e não toca na RAW", async () => {
    const result = await sell([{ menuItemId: classicId, qty: 1, variantId: classicWagyuVariantId }], 40000);
    expect(result.error).toBeNull();

    expect(await readIngredient(maputoStoreId, rawId)).toBe(20);
    expect(await readIngredient(maputoStoreId, wagyuId)).toBe(19);
  });

  it("Double leva duas carnes por hambúrguer", async () => {
    const { data: doubleVariants } = await admin
      .from("menu_item_variants")
      .select("id,name")
      .eq("menu_item_id", doubleId);
    const hawId = doubleVariants!.find((variant) => variant.name === "HAW")!.id;

    const result = await sell([{ menuItemId: doubleId, qty: 2, variantId: hawId }], 80000);
    expect(result.error).toBeNull();

    expect(await readIngredient(maputoStoreId, rawId)).toBe(16);
    expect(await readIngredient(maputoStoreId, cheeseId)).toBe(18);
  });

  it("a venda em Maputo não mexe no que a Matola tem", async () => {
    await sell([{ menuItemId: classicId, qty: 1, variantId: classicHawVariantId }], 30000);
    expect(await readIngredient(matolaStoreId, rawId)).toBe(20);
  });
});

describe("ficha técnica — falta de matéria-prima", () => {
  it("sem carne WAGYU a venda inteira é recusada e nada é descontado", async () => {
    await setIngredient(maputoStoreId, wagyuId, { qty: 0 });

    const result = await sell([{ menuItemId: classicId, qty: 1, variantId: classicWagyuVariantId }], 40000);
    expect(result.error).not.toBeNull();
    expect(result.error?.message).toContain("out_of_ingredient");

    // O queijo é da mesma venda: se tivesse saído, a transacção não teria
    // revertido e o inventário ficaria a mentir.
    expect(await readIngredient(maputoStoreId, cheeseId)).toBe(20);
  });

  it("ingrediente com track desligado não trava a venda", async () => {
    await setIngredient(maputoStoreId, wagyuId, { qty: 0, track: false });

    const result = await sell([{ menuItemId: classicId, qty: 1, variantId: classicWagyuVariantId }], 40000);
    expect(result.error).toBeNull();
    expect(await readIngredient(maputoStoreId, wagyuId)).toBe(0);
  });
});

describe("ficha técnica — anulação e custo", () => {
  it("anular a venda devolve a matéria-prima uma única vez", async () => {
    const sale = await sell([{ menuItemId: classicId, qty: 1, variantId: classicHawVariantId }], 30000);
    expect(sale.error).toBeNull();
    const orderId = sale.data.order_id as string;
    expect(await readIngredient(maputoStoreId, rawId)).toBe(19);

    const first = await owner.rpc("void_sale", { p_order_id: orderId, p_reason: "teste de anulação" });
    expect(first.error).toBeNull();
    expect(await readIngredient(maputoStoreId, rawId)).toBe(20);

    const second = await owner.rpc("void_sale", { p_order_id: orderId, p_reason: "teste de anulação" });
    expect(second.error).toBeNull();
    expect(await readIngredient(maputoStoreId, rawId)).toBe(20);
  });

  it("grava o custo da linha com o custo do momento da venda", async () => {
    const sale = await sell([{ menuItemId: classicId, qty: 2, variantId: classicWagyuVariantId }], 80000);
    expect(sale.error).toBeNull();

    const { data: lines } = await admin
      .from("order_items")
      .select("cost_cents,qty")
      .eq("order_id", sale.data.order_id as string);

    const { data: wagyu } = await admin
      .from("ingredients")
      .select("cost_cents")
      .eq("id", wagyuId)
      .single();
    const { data: cheese } = await admin
      .from("ingredients")
      .select("cost_cents")
      .eq("id", cheeseId)
      .single();

    const esperado = 2 * (wagyu!.cost_cents + cheese!.cost_cents);
    expect(lines![0].cost_cents).toBe(esperado);
  });

  it("o custo gravado não muda quando o custo do ingrediente muda depois", async () => {
    const sale = await sell([{ menuItemId: classicId, qty: 1, variantId: classicHawVariantId }], 30000);
    const orderId = sale.data.order_id as string;

    const { data: before } = await admin
      .from("order_items")
      .select("cost_cents")
      .eq("order_id", orderId)
      .single();

    const { data: original } = await admin
      .from("ingredients")
      .select("cost_cents")
      .eq("id", rawId)
      .single();
    await admin.from("ingredients").update({ cost_cents: 999_00 }).eq("id", rawId);

    const { data: after } = await admin
      .from("order_items")
      .select("cost_cents")
      .eq("order_id", orderId)
      .single();
    expect(after!.cost_cents).toBe(before!.cost_cents);

    await admin.from("ingredients").update({ cost_cents: original!.cost_cents }).eq("id", rawId);
  });
});

describe("ficha técnica — permissões e isolamento", () => {
  it("a Matola não vê os ingredientes de Maputo", async () => {
    const { data } = await matolaManager
      .from("store_ingredients")
      .select("store_id")
      .eq("store_id", maputoStoreId);
    expect(data ?? []).toHaveLength(0);
  });

  it("list_store_ingredients recusa loja de outrem", async () => {
    const { error } = await matolaManager.rpc("list_store_ingredients", {
      p_store_id: maputoStoreId,
    });
    expect(error).not.toBeNull();
  });

  it("só o dono mexe no custo e na ficha", async () => {
    const negado = await cashier.rpc("save_ingredient", {
      p_name: "Carne RAW",
      p_cost_cents: 1,
    });
    expect(negado.error).not.toBeNull();

    const permitido = await owner.rpc("save_recipe_item", {
      p_menu_item_id: classicId,
      p_ingredient_id: cheeseId,
      p_qty: 1,
      p_variant_id: null,
    });
    expect(permitido.error).toBeNull();
  });

  it("recusa uma ficha com variante de outro produto", async () => {
    const { error } = await owner.rpc("save_recipe_item", {
      p_menu_item_id: doubleId,
      p_ingredient_id: cheeseId,
      p_qty: 1,
      p_variant_id: classicHawVariantId,
    });
    expect(error?.message).toContain("variant_not_in_item");
  });
});
