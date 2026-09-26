/**
 * Gate das 1097–1099 — o que a auditoria de 26/09 encontrou aberto.
 *
 * - V-14: a cozinha não aprova nem cancela; o caixa aprova e recusa pedidos
 *   online, mas não cancela uma venda já paga (é `void_sale`, do gerente).
 * - V-15: `confirm_payment` é só do servidor.
 * - V-13: repetir uma sangria com a mesma chave não a conta duas vezes.
 * - V-01: o telefone sozinho não identifica ninguém a um anónimo.
 * - V-04: stock e preço da loja não mudam por UPDATE directo.
 * - V-02: um caixa não abre comprovativos de outra loja.
 *
 * Corre na Matola (como o talão da casa): aprovar e vender põem papel na fila.
 * Os mesmos cenários foram provados numa BD local (PGlite) antes de corrigir.
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

const sufixo = `${Date.now()}`;
const PASSWORD = "Permissoes-1097-Teste-2026!";
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let admin: SupabaseClient;
let anon: SupabaseClient;
let cozinha: SupabaseClient;
let caixa: SupabaseClient;
let gerente: SupabaseClient;
let caixaMaputo: SupabaseClient;
let matolaStoreId: string;
let maputoStoreId: string;
let itemId: string;
let precoItem: number;
let deviceId: string;
let inicio: string;
let ingredientesAntes: Array<{ ingredient_id: string; qty: number }> = [];

const criadosUsers: string[] = [];
const criadosPedidos: string[] = [];
const criadosProofs: string[] = [];

async function conta(role: string, loja: string, nome: string): Promise<SupabaseClient> {
  const email = `perm-${role}-${nome}-${sufixo}@delivery.test`;
  const { data: user, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error || !user.user) throw new Error(`Setup permissões: conta ${role} — ${error?.message}`);
  criadosUsers.push(user.user.id);
  await admin.from("staff_profiles").insert({ user_id: user.user.id, full_name: `Teste ${role}`, role, active: true });
  await admin.from("staff_stores").insert({ user_id: user.user.id, store_id: loja });
  const cliente = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: loginError } = await cliente.auth.signInWithPassword({ email, password: PASSWORD });
  if (loginError) throw new Error(`Setup permissões: sessão ${role} — ${loginError.message}`);
  return cliente;
}

async function pedidoOnline(): Promise<string> {
  const { data, error } = await anon.rpc("create_order", {
    p_store_slug: "matola",
    p_payload: {
      items: [{ menuItemId: itemId, qty: 1 }],
      customerName: `Permissões ${sufixo}`,
      fulfillmentType: "pickup",
      paymentMethod: "mpesa",
    },
  });
  if (error) throw new Error(`Setup permissões: create_order — ${error.message}`);
  criadosPedidos.push(data as string);
  return data as string;
}

async function vendaBalcao(): Promise<string> {
  const { data, error } = await caixa.rpc("create_counter_sale", {
    p_payload: {
      clientSaleId: crypto.randomUUID(),
      deviceId,
      items: [{ menuItemId: itemId, qty: 1 }],
      payments: [{ method: "cash", amountCents: precoItem }],
      cashReceivedCents: precoItem,
    },
  });
  if (error) throw new Error(`Setup permissões: venda — ${error.message}`);
  criadosPedidos.push(data.order_id as string);
  return data.order_id as string;
}

async function estado(orderId: string): Promise<string> {
  const { data } = await admin.from("orders").select("status").eq("id", orderId).single();
  return data!.status as string;
}

beforeAll(async () => {
  inicio = new Date(Date.now() - 60_000).toISOString();
  admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: lojas } = await admin.from("stores").select("id,slug").in("slug", ["matola", "maputo"]);
  matolaStoreId = lojas!.find((l) => l.slug === "matola")!.id as string;
  maputoStoreId = lojas!.find((l) => l.slug === "maputo")!.id as string;

  const { data: ingredientes } = await admin
    .from("store_ingredients").select("ingredient_id,qty").eq("store_id", matolaStoreId);
  ingredientesAntes = (ingredientes ?? []) as Array<{ ingredient_id: string; qty: number }>;
  await admin.from("store_ingredients").update({ qty: 1000 }).eq("store_id", matolaStoreId);

  const { data: menu } = await anon.rpc("get_menu", { p_store_slug: "matola" });
  const item = (menu as { categories: Array<{ items: Array<{ id: string; price_cents: number }> }> })
    .categories.flatMap((c) => c.items)[0];
  if (!item) throw new Error("Setup permissões: a Matola não tem nenhum item à venda");
  itemId = item.id;
  precoItem = item.price_cents;

  cozinha = await conta("kitchen", matolaStoreId, "mtl");
  caixa = await conta("cashier", matolaStoreId, "mtl");
  gerente = await conta("manager", matolaStoreId, "mtl");
  caixaMaputo = await conta("cashier", maputoStoreId, "mpt");

  const { data: device, error: deviceError } = await admin
    .from("devices")
    .insert({ store_id: matolaStoreId, kind: "pos", label: `POS permissões ${sufixo}`, device_key_hash: `perm-${sufixo}` })
    .select("id")
    .single();
  if (deviceError || !device) throw new Error(`Setup permissões: terminal — ${deviceError?.message}`);
  deviceId = device.id as string;
}, 120_000);

afterAll(async () => {
  if (!admin) return;
  for (const linha of ingredientesAntes) {
    await admin.from("store_ingredients").update({ qty: linha.qty })
      .eq("store_id", matolaStoreId).eq("ingredient_id", linha.ingredient_id);
  }
  if (criadosProofs.length > 0) await admin.storage.from("payment-proofs").remove(criadosProofs);
  if (criadosPedidos.length > 0) {
    await admin.from("print_jobs").delete().in("order_id", criadosPedidos);
    await admin.from("payments").delete().in("order_id", criadosPedidos);
    await admin.from("event_log").delete().in("order_id", criadosPedidos);
    await admin.from("orders").delete().in("id", criadosPedidos);
  }
  const { data: caixas } = await admin
    .from("cash_sessions").select("id").eq("store_id", matolaStoreId).gte("opened_at", inicio);
  const idsCaixa = (caixas ?? []).map((c) => c.id as string);
  if (idsCaixa.length > 0) {
    await admin.from("cash_movements").delete().in("session_id", idsCaixa);
    await admin.from("cash_sessions").delete().in("id", idsCaixa);
  }
  await admin.from("event_log").delete().in("actor_user_id", criadosUsers);
  if (deviceId) await admin.from("devices").delete().eq("id", deviceId);
  for (const id of criadosUsers) {
    await admin.from("staff_stores").delete().eq("user_id", id);
    await admin.from("staff_profiles").delete().eq("user_id", id);
    await admin.auth.admin.deleteUser(id);
  }
});

describe("V-14 · quem muda o estado do pedido", () => {
  it("a cozinha não aprova nem recusa um pedido online", async () => {
    const orderId = await pedidoOnline();
    const aprovar = await cozinha.rpc("advance_order", { p_order_id: orderId, p_event: "APPROVE" });
    expect(aprovar.error?.message).toContain("order_transition_denied");
    const recusar = await cozinha.rpc("advance_order", { p_order_id: orderId, p_event: "CANCEL", p_reason: "x" });
    expect(recusar.error?.message).toContain("order_transition_denied");
    expect(await estado(orderId)).toBe("awaiting_approval");
  });

  it("o caixa aprova (decisão de 23 Set) e a cozinha avança o preparo", async () => {
    const orderId = await pedidoOnline();
    expect((await caixa.rpc("advance_order", { p_order_id: orderId, p_event: "APPROVE" })).error).toBeNull();
    expect((await cozinha.rpc("advance_order", { p_order_id: orderId, p_event: "START_PREPARATION" })).error).toBeNull();
    expect((await cozinha.rpc("advance_order", { p_order_id: orderId, p_event: "MARK_READY" })).error).toBeNull();
    expect(await estado(orderId)).toBe("ready");
  });

  it("o caixa recusa um pedido online ainda por aprovar", async () => {
    const orderId = await pedidoOnline();
    const { error } = await caixa.rpc("advance_order", {
      p_order_id: orderId, p_event: "CANCEL", p_reason: "Comprovativo ilegível",
    });
    expect(error).toBeNull();
    expect(await estado(orderId)).toBe("cancelled");
  });

  it("o caixa não cancela uma venda de balcão paga; o gerente anula-a com void_sale", async () => {
    const vendaId = await vendaBalcao();
    const cancelar = await caixa.rpc("advance_order", { p_order_id: vendaId, p_event: "CANCEL", p_reason: "engano" });
    expect(cancelar.error?.message).toContain("order_transition_denied");
    expect(await estado(vendaId)).toBe("paid");

    const anular = await gerente.rpc("void_sale", { p_order_id: vendaId, p_reason: "Engano do operador" });
    expect(anular.error).toBeNull();
    expect(await estado(vendaId)).toBe("cancelled");
  });
});

describe("V-15 · confirmar pagamento é só do servidor", () => {
  it("o gerente não marca um pedido digital como pago por RPC", async () => {
    const orderId = await pedidoOnline();
    const { data: pedido } = await admin.from("orders").select("total_cents").eq("id", orderId).single();
    const { error } = await gerente.rpc("confirm_payment", {
      p_idempotency_key: `perm-${orderId}`,
      p_order_id: orderId,
      p_provider: "mock",
      p_provider_ref: "PLACEHOLDER_REF",
      p_method: "mpesa",
      p_amount_cents: pedido!.total_cents,
    });
    expect(error).not.toBeNull();
    const { count } = await admin.from("payments").select("id", { count: "exact", head: true }).eq("order_id", orderId);
    expect(count).toBe(0);
  });
});

describe("V-13 · sangria idempotente", () => {
  it("a mesma chave duas vezes grava um só movimento", async () => {
    await vendaBalcao(); // abre o turno da Matola, se ainda não houver
    const args = {
      p_store: matolaStoreId, p_type: "sangria", p_amount_cents: 100,
      p_reason: `Sangria de teste ${sufixo}`, p_request_id: crypto.randomUUID(),
    };
    const a = await caixa.rpc("add_cash_movement", args);
    const b = await caixa.rpc("add_cash_movement", args);
    expect(a.error).toBeNull();
    expect(b.error).toBeNull();
    expect(b.data).toBe(a.data);
    const { count } = await admin
      .from("cash_movements").select("id", { count: "exact", head: true }).eq("reason", args.p_reason);
    expect(count).toBe(1);

    const outra = await caixa.rpc("add_cash_movement", { ...args, p_amount_cents: 999 });
    expect(outra.error?.message).toContain("request_id_reused");
  });
});

describe("V-01 · telefone sozinho não chega", () => {
  it("anónimo não identifica cliente nem lista pedidos por telefone", async () => {
    expect((await anon.rpc("identify_customer", { p_phone: "841234567" })).error).not.toBeNull();
    expect((await anon.rpc("get_customer_orders", { p_phone: "841234567" })).error).not.toBeNull();
  });
});

describe("V-04 · stock e preço só pelas RPCs auditadas", () => {
  it("o gerente não muda stock_qty por update directo, mas marca esgotado", async () => {
    const stock = await gerente.from("store_items")
      .update({ stock_qty: 7 }).eq("store_id", matolaStoreId).eq("menu_item_id", itemId).select("store_id");
    expect(stock.error).not.toBeNull();

    const esgotado = await gerente.from("store_items")
      .update({ available: true }).eq("store_id", matolaStoreId).eq("menu_item_id", itemId).select("store_id");
    expect(esgotado.error).toBeNull();
    expect(esgotado.data?.length).toBe(1);
  });
});

describe("V-02 · comprovativos por loja", () => {
  it("o caixa de Maputo não abre o comprovativo de um pedido da Matola", async () => {
    const orderId = await pedidoOnline();
    const path = `${orderId}/perm-${sufixo}.png`;
    const up = await anon.storage.from("payment-proofs").upload(path, PNG, { contentType: "image/png" });
    expect(up.error).toBeNull();
    criadosProofs.push(path);

    const alheio = await caixaMaputo.storage.from("payment-proofs").createSignedUrl(path, 60);
    expect(alheio.data?.signedUrl).toBeFalsy();
    const daLoja = await caixa.storage.from("payment-proofs").createSignedUrl(path, 60);
    expect(daLoja.error).toBeNull();
    const daCozinha = await cozinha.storage.from("payment-proofs").createSignedUrl(path, 60);
    expect(daCozinha.data?.signedUrl).toBeFalsy();
  });
});
