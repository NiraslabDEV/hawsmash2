/**
 * Gate da 1061 — marcar um produto como esgotado a partir do balcão.
 *
 * A carne acaba a meio do turno. Quem está ao balcão tem de tirar o produto do
 * cardápio naquele momento, sem ir ao painel e sem chamar o dono: senão o site
 * continua a vender o que a cozinha já não consegue fazer.
 *
 * O que aqui se prova:
 *   · caixa e gerente marcam esgotado e voltam a marcar disponível;
 *   · a cozinha não — foi a decisão do dono;
 *   · marcar esgotado tira mesmo o produto: o site deixa de o vender;
 *   · cada loja só mexe no seu cardápio (regra 3);
 *   · fica rasto de quem mudou (§6), e um duplo toque não o duplica.
 *
 * O que o caixa NÃO ganha com isto: mexer em quantidades, contagens ou quebras.
 * Isso continua a ser do gerente, pela `adjust_store_stock`.
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
let anon: SupabaseClient;
let caixaMaputo: SupabaseClient;
let gerenteMaputo: SupabaseClient;
let cozinhaMaputo: SupabaseClient;
let caixaMatola: SupabaseClient;
let maputoStoreId: string;
let matolaStoreId: string;
let itemId: string;
let itemName: string;
let caixaMaputoId: string;

const sufixo = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const PASSWORD = "Esgotado-1061-Teste-2026!";
const criados: string[] = [];

async function criarPessoa(
  label: string,
  role: "manager" | "cashier" | "kitchen",
  storeId: string,
): Promise<{ client: SupabaseClient; id: string }> {
  const email = `esgotado-${label}-${sufixo}@delivery.test`;
  const { data: user, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !user.user) throw new Error(`Setup esgotado: ${label} — ${error?.message}`);
  criados.push(user.user.id);
  await admin
    .from("staff_profiles")
    .insert({ user_id: user.user.id, full_name: `Esgotado ${label}`, role, active: true });
  await admin.from("staff_stores").insert({ user_id: user.user.id, store_id: storeId });

  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: loginError } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (loginError) throw new Error(`Setup esgotado: sessão ${label} — ${loginError.message}`);
  return { client, id: user.user.id };
}

/** O que o site vende agora: só conta o que o `get_menu` público devolve. */
async function siteVende(id: string): Promise<boolean> {
  const { data } = await anon.rpc("get_menu", { p_store_slug: "maputo" });
  const itens = (data as { categories: Array<{ items: Array<{ id: string }> }> }).categories.flatMap(
    (c) => c.items,
  );
  return itens.some((i) => i.id === id);
}

async function repor(): Promise<void> {
  if (!admin || !itemId) return;
  await admin
    .from("store_items")
    .update({ available: true })
    .eq("store_id", maputoStoreId)
    .eq("menu_item_id", itemId);
}

beforeAll(async () => {
  admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  anon = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: lojas } = await admin.from("stores").select("id,slug");
  maputoStoreId = lojas!.find((l) => l.slug === "maputo")!.id as string;
  matolaStoreId = lojas!.find((l) => l.slug === "matola")!.id as string;

  // Um produto que o site está a vender agora, e sem stock controlado — para
  // o teste medir a disponibilidade e não um stock a zero.
  const { data: menu } = await anon.rpc("get_menu", { p_store_slug: "maputo" });
  const candidatos = (menu as { categories: Array<{ items: Array<{ id: string; name: string }> }> })
    .categories.flatMap((c) => c.items);
  const { data: semStock } = await admin
    .from("store_items")
    .select("menu_item_id")
    .eq("store_id", maputoStoreId)
    .eq("track_stock", false)
    .eq("available", true);
  const livres = new Set((semStock ?? []).map((s) => s.menu_item_id as string));
  const escolhido = candidatos.find((i) => livres.has(i.id));
  if (!escolhido) throw new Error("Setup esgotado: nenhum produto disponível sem stock controlado");
  itemId = escolhido.id;
  itemName = escolhido.name;

  const caixa = await criarPessoa("caixa-mpt", "cashier", maputoStoreId);
  caixaMaputo = caixa.client;
  caixaMaputoId = caixa.id;
  gerenteMaputo = (await criarPessoa("gerente-mpt", "manager", maputoStoreId)).client;
  cozinhaMaputo = (await criarPessoa("cozinha-mpt", "kitchen", maputoStoreId)).client;
  caixaMatola = (await criarPessoa("caixa-mtl", "cashier", matolaStoreId)).client;
}, 90_000);

afterAll(async () => {
  // Primeiro repor: um produto esquecido como esgotado parte os outros testes
  // e, pior, fica fora do cardápio do staging.
  await repor();
  if (!admin) return;
  await admin
    .from("event_log")
    .delete()
    .eq("type", "stock.availability_changed")
    .in("actor_user_id", criados);
  for (const id of criados) {
    await admin.from("staff_stores").delete().eq("user_id", id);
    await admin.from("staff_profiles").delete().eq("user_id", id);
    await admin.auth.admin.deleteUser(id);
  }
});

describe("1061 · esgotado no balcão", () => {
  it("o caixa marca esgotado, e o site deixa de o vender", async () => {
    expect(await siteVende(itemId)).toBe(true);

    const { data, error } = await caixaMaputo.rpc("set_item_availability", {
      p_store_id: maputoStoreId,
      p_menu_item_id: itemId,
      p_available: false,
      p_reason: "acabou a carne",
    });
    expect(error).toBeNull();
    expect(data).toMatchObject({ available: false, changed: true });

    expect(await siteVende(itemId)).toBe(false);
  });

  it("com o produto esgotado, uma encomenda online dele é recusada", async () => {
    const { error } = await anon.rpc("create_order", {
      p_store_slug: "maputo",
      p_payload: {
        items: [{ menuItemId: itemId, qty: 1 }],
        customerName: `Esgotado ${sufixo}`,
        customerPhone: `84${sufixo.replace(/\D/g, "").slice(-7)}`,
        fulfillmentType: "pickup",
        paymentMethod: "mpesa",
      },
    });
    expect(error).not.toBeNull();
    expect(error?.message ?? "").toMatch(/unavailable|indispon/i);
  });

  it("fica rasto de quem marcou, com o perfil", async () => {
    const { data } = await admin
      .from("event_log")
      .select("actor_user_id,store_id,payload")
      .eq("type", "stock.availability_changed")
      .eq("actor_user_id", caixaMaputoId);

    expect((data ?? []).length).toBe(1);
    expect(data![0].store_id).toBe(maputoStoreId);
    expect(data![0].payload).toMatchObject({
      menu_item_id: itemId,
      available: false,
      role: "cashier",
      reason: "acabou a carne",
    });
  });

  it("um duplo toque não muda nada nem regista duas vezes", async () => {
    const { data, error } = await caixaMaputo.rpc("set_item_availability", {
      p_store_id: maputoStoreId,
      p_menu_item_id: itemId,
      p_available: false,
    });
    expect(error).toBeNull();
    expect(data).toMatchObject({ available: false, changed: false });

    const { count } = await admin
      .from("event_log")
      .select("id", { count: "exact", head: true })
      .eq("type", "stock.availability_changed")
      .eq("actor_user_id", caixaMaputoId);
    expect(count).toBe(1);
  });

  it("a cozinha não marca — foi a decisão do dono", async () => {
    const { error } = await cozinhaMaputo.rpc("set_item_availability", {
      p_store_id: maputoStoreId,
      p_menu_item_id: itemId,
      p_available: true,
    });
    expect(error).not.toBeNull();
    expect(await siteVende(itemId)).toBe(false);
  });

  it("o caixa da Matola não mexe no cardápio de Maputo", async () => {
    const { error } = await caixaMatola.rpc("set_item_availability", {
      p_store_id: maputoStoreId,
      p_menu_item_id: itemId,
      p_available: true,
    });
    expect(error).not.toBeNull();
    expect(await siteVende(itemId)).toBe(false);
  });

  it("o anónimo não chega lá", async () => {
    const { error } = await anon.rpc("set_item_availability", {
      p_store_id: maputoStoreId,
      p_menu_item_id: itemId,
      p_available: true,
    });
    expect(error).not.toBeNull();
  });

  it("o gerente volta a pôr disponível, e o site volta a vender", async () => {
    const { data, error } = await gerenteMaputo.rpc("set_item_availability", {
      p_store_id: maputoStoreId,
      p_menu_item_id: itemId,
      p_available: true,
    });
    expect(error).toBeNull();
    expect(data).toMatchObject({ available: true, changed: true });
    expect(await siteVende(itemId), `${itemName} devia estar de volta ao cardápio`).toBe(true);
  });
});
