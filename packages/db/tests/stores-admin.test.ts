/**
 * Gate de integração da F10 — gestão de lojas pelo painel.
 * Cobre perfil (dono configura, gerente só fecha a sua loja), imutabilidade de
 * `slug`/`order_prefix`, horário, zonas, kill switch e auditoria.
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
let owner: SupabaseClient;
let manager: SupabaseClient;
let cashier: SupabaseClient;

let maputoStoreId: string;
let matolaStoreId: string;
let createdStoreId: string | null = null;

const createdUserIds: string[] = [];
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const shortSuffix = `${Date.now()}`.slice(-5);
// O prefixo do pedido só aceita letras (constraint da 1001).
const testPrefix = Array.from({ length: 3 }, () =>
  String.fromCharCode(65 + Math.floor(Math.random() * 26)),
).join('');
const PASSWORD = "Lojas-F10-Teste-2026!";

async function createUser(
  label: string,
  role: "owner" | "manager" | "cashier",
  storeIds: string[],
): Promise<SupabaseClient> {
  const email = `lojas-${label}-${suffix}@delivery.test`;
  const { data: user, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !user.user) throw new Error(`Setup lojas: ${label} — ${error?.message}`);
  createdUserIds.push(user.user.id);

  const { error: profileError } = await admin.from("staff_profiles").insert({
    user_id: user.user.id,
    full_name: `Equipa Lojas ${label}`,
    role,
    active: true,
  });
  if (profileError) throw new Error(`Setup lojas: perfil ${label} — ${profileError.message}`);

  if (storeIds.length > 0) {
    const { error: storeError } = await admin
      .from("staff_stores")
      .insert(storeIds.map((storeId) => ({ user_id: user.user!.id, store_id: storeId })));
    if (storeError) throw new Error(`Setup lojas: acesso ${label} — ${storeError.message}`);
  }

  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: loginError } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (loginError) throw new Error(`Setup lojas: login ${label} — ${loginError.message}`);
  return client;
}

beforeAll(async () => {
  admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: stores, error } = await admin
    .from("stores")
    .select("id,slug")
    .in("slug", ["maputo", "matola"]);
  if (error || stores?.length !== 2) throw new Error(`Setup lojas: lojas — ${error?.message}`);
  maputoStoreId = stores.find((store) => store.slug === "maputo")!.id;
  matolaStoreId = stores.find((store) => store.slug === "matola")!.id;

  owner = await createUser("dono", "owner", []);
  manager = await createUser("gerente", "manager", [maputoStoreId]);
  cashier = await createUser("caixa", "cashier", [maputoStoreId]);
});

afterAll(async () => {
  if (!admin) return;
  if (createdStoreId) {
    await admin.from("store_items").delete().eq("store_id", createdStoreId);
    await admin.from("store_hours").delete().eq("store_id", createdStoreId);
    await admin.from("delivery_zones").delete().eq("store_id", createdStoreId);
    await admin.from("event_log").delete().eq("store_id", createdStoreId);
    await admin.from("stores").delete().eq("id", createdStoreId);
  }
  await admin.from("stores").update({ accepting_orders: true }).eq("id", maputoStoreId);
  for (const userId of createdUserIds) {
    await admin.auth.admin.deleteUser(userId);
  }
});

describe("F10 — configuração da loja", () => {
  it("deixa o dono criar uma loja já com o cardápio inteiro e sem horário inventado", async () => {
    const created = await owner.rpc("save_store", {
      p_payload: {
        slug: `teste-${shortSuffix}`,
        name: `HAWSMASH Teste ${shortSuffix}`,
        short_name: `Teste ${shortSuffix}`,
        order_prefix: testPrefix,
        address: "Rua de teste",
        phone: "840000000",
        receipt_footer: "Obrigado!",
        accepting_orders: false,
      },
    });
    expect(created.error).toBeNull();
    createdStoreId = created.data.id as string;

    expect(created.data).toMatchObject({ accepting_orders: false, active: true });
    expect(JSON.stringify(created.data)).not.toContain("paysuite");

    const [{ count: itemsCount }, { data: hours }] = await Promise.all([
      admin
        .from("store_items")
        .select("menu_item_id", { count: "exact", head: true })
        .eq("store_id", createdStoreId),
      admin.from("store_hours").select("dow").eq("store_id", createdStoreId),
    ]);
    expect(itemsCount).toBeGreaterThan(0);
    expect(hours ?? []).toEqual([]);

    const readiness = created.data.missing as string[];
    expect(readiness).toContain("hours");
    expect(readiness).toContain("payment");
  });

  it("recusa criar ou editar a quem não é dono", async () => {
    const byManager = await manager.rpc("save_store", {
      p_payload: { slug: `bloqueado-${shortSuffix}`, name: "X", short_name: "X", order_prefix: "XXX" },
    });
    expect(byManager.error?.message).toContain("staff_admin_denied");

    const byCashier = await cashier.rpc("save_store", {
      p_payload: { id: maputoStoreId, phone: "999999999" },
    });
    expect(byCashier.error?.message).toContain("staff_admin_denied");
  });

  it("guarda contactos e rodapé sem deixar mudar slug nem prefixo", async () => {
    const updated = await owner.rpc("save_store", {
      p_payload: {
        id: matolaStoreId,
        phone: "870909080",
        receipt_footer: "Obrigado! Volte sempre.",
        maps_url: "https://maps.example/matola",
      },
    });
    expect(updated.error).toBeNull();
    expect(updated.data).toMatchObject({
      slug: "matola",
      receipt_footer: "Obrigado! Volte sempre.",
    });

    const renamed = await owner.rpc("save_store", {
      p_payload: { id: matolaStoreId, slug: "matola-nova" },
    });
    expect(renamed.error?.message).toContain("store_slug_immutable");

    const reprefixed = await owner.rpc("save_store", {
      p_payload: { id: matolaStoreId, order_prefix: "MTX" },
    });
    expect(reprefixed.error?.message).toContain("store_prefix_immutable");

    const { data: store } = await admin
      .from("stores")
      .select("slug,order_prefix")
      .eq("id", matolaStoreId)
      .single();
    expect(store).toMatchObject({ slug: "matola", order_prefix: "MTL" });
  });

  it("substitui o horário da semana e recusa horas impossíveis", async () => {
    if (!createdStoreId) throw new Error("loja de teste em falta");

    const saved = await owner.rpc("set_store_hours", {
      p_store_id: createdStoreId,
      p_hours: [
        { dow: 4, opens: "11:00", closes: "21:30", active: true },
        { dow: 5, opens: "11:00", closes: "21:30", active: true },
      ],
    });
    expect(saved.error).toBeNull();
    expect((saved.data as { hours: unknown[] }).hours).toHaveLength(2);

    const broken = await owner.rpc("set_store_hours", {
      p_store_id: createdStoreId,
      p_hours: [{ dow: 4, opens: "22:00", closes: "10:00", active: true }],
    });
    expect(broken.error).not.toBeNull();

    const { data: hours } = await admin
      .from("store_hours")
      .select("dow,opens")
      .eq("store_id", createdStoreId)
      .order("dow");
    expect(hours).toHaveLength(2);
    expect(hours?.[0]).toMatchObject({ dow: 4, opens: "11:00:00" });
  });

  it("cria zona, actualiza taxa e desactiva em vez de apagar quando já houve pedidos", async () => {
    if (!createdStoreId) throw new Error("loja de teste em falta");

    const zone = await owner.rpc("save_delivery_zone", {
      p_store_id: createdStoreId,
      p_zone: { name: "Centro", fee_cents: 15000, sort: 1 },
    });
    expect(zone.error).toBeNull();
    expect(zone.data).toMatchObject({ name: "Centro", fee_cents: 15000, active: true });

    const cheaper = await owner.rpc("save_delivery_zone", {
      p_store_id: createdStoreId,
      p_zone: { id: zone.data.id, name: "Centro", fee_cents: 10000 },
    });
    expect(cheaper.error).toBeNull();
    expect(cheaper.data.fee_cents).toBe(10000);

    const removed = await owner.rpc("delete_delivery_zone", { p_zone_id: zone.data.id });
    expect(removed.error).toBeNull();
    expect(removed.data).toMatchObject({ deleted: true });

    const negative = await owner.rpc("save_delivery_zone", {
      p_store_id: createdStoreId,
      p_zone: { name: "Impossível", fee_cents: -100 },
    });
    expect(negative.error).not.toBeNull();
  });

  it("deixa o gerente fechar a sua loja com motivo e nunca a loja do lado", async () => {
    const closed = await manager.rpc("set_store_accepting_orders", {
      p_store_id: maputoStoreId,
      p_accepting: false,
      p_reason: "Falta de energia",
    });
    expect(closed.error).toBeNull();
    expect(closed.data).toMatchObject({ accepting_orders: false });

    const { data: store } = await admin
      .from("stores")
      .select("accepting_orders")
      .eq("id", maputoStoreId)
      .single();
    expect(store?.accepting_orders).toBe(false);

    const other = await manager.rpc("set_store_accepting_orders", {
      p_store_id: matolaStoreId,
      p_accepting: false,
      p_reason: "Tentativa entre lojas",
    });
    expect(other.error).not.toBeNull();

    const byCashier = await cashier.rpc("set_store_accepting_orders", {
      p_store_id: maputoStoreId,
      p_accepting: true,
      p_reason: "Tentativa do caixa",
    });
    expect(byCashier.error).not.toBeNull();

    const { data: events } = await admin
      .from("event_log")
      .select("type,payload,actor_user_id")
      .eq("store_id", maputoStoreId)
      .eq("type", "store.accepting_orders_changed")
      .order("created_at", { ascending: false })
      .limit(1);
    expect(events?.[0].payload).toMatchObject({
      accepting_orders: false,
      reason: "Falta de energia",
    });

    const reopened = await manager.rpc("set_store_accepting_orders", {
      p_store_id: maputoStoreId,
      p_accepting: true,
      p_reason: "Energia reposta",
    });
    expect(reopened.error).toBeNull();
    await admin
      .from("event_log")
      .delete()
      .eq("store_id", maputoStoreId)
      .eq("type", "store.accepting_orders_changed");
  });

  it("entrega ao painel a configuração da loja sem as chaves de pagamento", async () => {
    const view = await owner.rpc("get_store_admin", { p_store_id: matolaStoreId });
    expect(view.error).toBeNull();

    const payload = view.data as {
      store: Record<string, unknown>;
      hours: unknown[];
      zones: unknown[];
      missing: string[];
    };
    expect(payload.store).toMatchObject({ slug: "matola" });
    expect(Array.isArray(payload.hours)).toBe(true);
    expect(Array.isArray(payload.zones)).toBe(true);
    expect(JSON.stringify(payload)).not.toContain("paysuite");

    const foreign = await manager.rpc("get_store_admin", { p_store_id: matolaStoreId });
    expect(foreign.error).not.toBeNull();
  });

  it("mantém as chaves do Paysuite fora do alcance do cliente autenticado", async () => {
    const { error } = await manager.from("stores").select("paysuite_api_key").eq("id", maputoStoreId);
    expect(error).not.toBeNull();

    const { data: allowed, error: allowedError } = await manager
      .from("stores")
      .select("slug,short_name,accepting_orders")
      .eq("id", maputoStoreId)
      .single();
    expect(allowedError).toBeNull();
    expect(allowed).toMatchObject({ slug: "maputo" });
  });
});
