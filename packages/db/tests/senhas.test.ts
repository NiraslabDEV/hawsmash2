/**
 * Gate das senhas do balcão (1076): o caixa digita a senha e ela vai para a TV.
 *
 * Pedido do dono, 24 Set: na barra lateral do POS, por baixo de Delivery, uma
 * aba Senhas onde quem está ao balcão digita o número que saiu da cozinha — e
 * a TV mostra PEDIDO PRONTO. O que isto protege:
 *
 * - a senha anda pelo `advance_order`, nunca por um update à mão ao estado;
 * - repetir a mesma senha não faz nada de novo (regra 4);
 * - um pedido da internet por aprovar não salta para a TV só porque alguém
 *   digitou o número dele;
 * - a Matola não chama senhas de Maputo (regra 3);
 * - fica escrito quem chamou.
 *
 * Corre na Matola pela mesma razão do talão: vender põe papel na fila.
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
let caixa: SupabaseClient;
let caixaId: string;
let matolaStoreId: string;
let maputoStoreId: string;
let itemId: string;
let precoItem: number;
let deviceId: string;
let inicio: string;
let ingredientesAntes: Array<{ ingredient_id: string; qty: number }> = [];

const sufixo = `${Date.now()}`;
const PASSWORD = "Senhas-1076-Teste-2026!";
const criadosUsers: string[] = [];
const criadosPedidos: string[] = [];

async function vendaBalcao(): Promise<{ id: string; senha: number }> {
  const { data, error } = await caixa.rpc("create_counter_sale", {
    p_payload: {
      clientSaleId: crypto.randomUUID(),
      deviceId,
      items: [{ menuItemId: itemId, qty: 1 }],
      payments: [{ method: "cash", amountCents: precoItem }],
      cashReceivedCents: precoItem,
    },
  });
  if (error) throw new Error(`venda de balcão — ${error.message}`);
  const id = data.order_id as string;
  criadosPedidos.push(id);
  const { data: pedido } = await admin.from("orders").select("daily_number").eq("id", id).single();
  return { id, senha: pedido!.daily_number as number };
}

async function estado(id: string): Promise<string> {
  const { data } = await admin.from("orders").select("status").eq("id", id).single();
  return data!.status as string;
}

beforeAll(async () => {
  inicio = new Date().toISOString();
  admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  anon = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: lojas } = await admin.from("stores").select("id,slug").in("slug", ["matola", "maputo"]);
  matolaStoreId = lojas!.find((l) => l.slug === "matola")!.id as string;
  maputoStoreId = lojas!.find((l) => l.slug === "maputo")!.id as string;

  const { data: ingredientes } = await admin
    .from("store_ingredients")
    .select("ingredient_id,qty")
    .eq("store_id", matolaStoreId);
  ingredientesAntes = (ingredientes ?? []) as Array<{ ingredient_id: string; qty: number }>;
  await admin.from("store_ingredients").update({ qty: 1000 }).eq("store_id", matolaStoreId);

  const { data: menu } = await anon.rpc("get_menu", { p_store_slug: "matola" });
  const item = (
    menu as { categories: Array<{ items: Array<{ id: string; price_cents: number }> }> }
  ).categories.flatMap((c) => c.items)[0];
  if (!item) throw new Error("Setup senhas: a Matola não tem nenhum item à venda");
  itemId = item.id;
  precoItem = item.price_cents;

  const email = `senhas-caixa-${sufixo}@delivery.test`;
  const { data: user } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  caixaId = user.user!.id;
  criadosUsers.push(caixaId);
  await admin
    .from("staff_profiles")
    .insert({ user_id: caixaId, full_name: "Caixa das senhas", role: "cashier", active: true });
  await admin.from("staff_stores").insert({ user_id: caixaId, store_id: matolaStoreId });
  caixa = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await caixa.auth.signInWithPassword({ email, password: PASSWORD });

  const { data: device, error: deviceError } = await admin
    .from("devices")
    .insert({
      store_id: matolaStoreId,
      kind: "pos",
      label: `POS senhas ${sufixo}`,
      device_key_hash: `senhas-${sufixo}`,
    })
    .select("id")
    .single();
  if (deviceError || !device) throw new Error(`Setup senhas: terminal — ${deviceError?.message}`);
  deviceId = device.id as string;
}, 90_000);

afterAll(async () => {
  if (!admin) return;
  for (const linha of ingredientesAntes) {
    await admin
      .from("store_ingredients")
      .update({ qty: linha.qty })
      .eq("store_id", matolaStoreId)
      .eq("ingredient_id", linha.ingredient_id);
  }
  if (criadosPedidos.length > 0) {
    await admin.from("print_jobs").delete().in("order_id", criadosPedidos);
    await admin.from("event_log").delete().in("order_id", criadosPedidos);
    await admin.from("orders").delete().in("id", criadosPedidos);
  }
  const { data: caixas } = await admin
    .from("cash_sessions")
    .select("id")
    .eq("store_id", matolaStoreId)
    .gte("opened_at", inicio);
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

describe("senhas · chamar ao balcão", () => {
  it("a senha de uma venda paga vai para pronto e aparece na TV com o tipo", async () => {
    const venda = await vendaBalcao();
    expect(await estado(venda.id)).toBe("paid");

    const { data, error } = await caixa.rpc("call_ticket", {
      p_store_id: matolaStoreId,
      p_daily_number: venda.senha,
    });
    expect(error).toBeNull();
    expect(data).toMatchObject({ order_id: venda.id, daily_number: venda.senha, status: "ready", already_ready: false });
    expect(await estado(venda.id)).toBe("ready");

    const { data: fila } = await anon.rpc("get_store_queue", { p_store_slug: "matola" });
    const pronto = (fila as { ready: Array<Record<string, unknown>> }).ready.find(
      (entry) => entry.daily_number === venda.senha,
    );
    expect(pronto).toMatchObject({ channel: "counter", fulfillment_type: "pickup" });

    // Quem chamou fica escrito, com a loja.
    const { data: registo } = await admin
      .from("event_log")
      .select("actor_user_id,store_id")
      .eq("order_id", venda.id)
      .eq("type", "ticket.called");
    expect(registo).toEqual([{ actor_user_id: caixaId, store_id: matolaStoreId }]);
  });

  it("repetir a mesma senha não faz nada de novo", async () => {
    const venda = await vendaBalcao();
    await caixa.rpc("call_ticket", { p_store_id: matolaStoreId, p_daily_number: venda.senha });

    const { data, error } = await caixa.rpc("call_ticket", {
      p_store_id: matolaStoreId,
      p_daily_number: venda.senha,
    });
    expect(error).toBeNull();
    expect(data).toMatchObject({ order_id: venda.id, status: "ready", already_ready: true });

    const { count } = await admin
      .from("event_log")
      .select("id", { count: "exact", head: true })
      .eq("order_id", venda.id)
      .eq("type", "ticket.called");
    expect(count).toBe(1);
  });

  it("um pedido já em preparo também vai para pronto", async () => {
    const venda = await vendaBalcao();
    await caixa.rpc("advance_order", { p_order_id: venda.id, p_event: "START_PREPARATION" });

    const { error } = await caixa.rpc("call_ticket", {
      p_store_id: matolaStoreId,
      p_daily_number: venda.senha,
    });
    expect(error).toBeNull();
    expect(await estado(venda.id)).toBe("ready");
  });

  it("uma senha já entregue não volta à TV", async () => {
    const venda = await vendaBalcao();
    await caixa.rpc("call_ticket", { p_store_id: matolaStoreId, p_daily_number: venda.senha });
    await caixa.rpc("advance_order", { p_order_id: venda.id, p_event: "DELIVER" });

    const { error } = await caixa.rpc("call_ticket", {
      p_store_id: matolaStoreId,
      p_daily_number: venda.senha,
    });
    expect(error?.message).toContain("ticket_already_delivered");
    expect(await estado(venda.id)).toBe("delivered");
  });

  it("um pedido da internet por aprovar não salta para a TV", async () => {
    const { data: id, error: orderError } = await anon.rpc("create_order", {
      p_store_slug: "matola",
      p_payload: {
        items: [{ menuItemId: itemId, qty: 1 }],
        customerName: `Senha online ${sufixo}`,
        fulfillmentType: "pickup",
        paymentMethod: "mpesa",
      },
    });
    expect(orderError).toBeNull();
    criadosPedidos.push(id as string);
    const { data: pedido } = await admin.from("orders").select("daily_number,status").eq("id", id).single();
    expect(pedido!.status).toBe("awaiting_approval");

    const { error } = await caixa.rpc("call_ticket", {
      p_store_id: matolaStoreId,
      p_daily_number: pedido!.daily_number,
    });
    expect(error?.message).toContain("ticket_not_paid");
    expect(await estado(id as string)).toBe("awaiting_approval");
  });

  it("uma senha que não existe hoje diz isso mesmo", async () => {
    const { data: maior } = await admin
      .from("orders")
      .select("daily_number")
      .eq("store_id", matolaStoreId)
      .not("daily_number", "is", null)
      .order("daily_number", { ascending: false })
      .limit(1);
    const inexistente = ((maior?.[0]?.daily_number as number | undefined) ?? 0) + 1000;

    const { error } = await caixa.rpc("call_ticket", {
      p_store_id: matolaStoreId,
      p_daily_number: inexistente,
    });
    expect(error?.message).toContain("ticket_not_found");
  });

  it("a Matola não chama senhas de Maputo", async () => {
    const { error } = await caixa.rpc("call_ticket", { p_store_id: maputoStoreId, p_daily_number: 1 });
    expect(error?.message).toContain("store_access_denied");
  });

  it("o anónimo não chama senhas", async () => {
    const { error } = await anon.rpc("call_ticket", { p_store_id: matolaStoreId, p_daily_number: 1 });
    expect(error).not.toBeNull();
  });
});
