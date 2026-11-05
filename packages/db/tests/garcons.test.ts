/**
 * Gate de integração da 1122 — o garçom tira o pedido no telemóvel.
 *
 * O que tem de ser verdade, contra um Supabase a sério (RLS, grants,
 * `security definer`):
 *
 *  - o garçom entra com telefone + PIN; o token é a única chave, e as RPCs do
 *    telemóvel não abrem à `anon` nem a uma sessão da equipa;
 *  - o pedido dele é o mesmo pedido de mesa do balcão: preço da loja (Regra 2),
 *    stock baixado, comanda nas vias + senha no balcão, conta da mesa por pagar;
 *  - a comanda diz quem o lançou ("Garçom: …"), e o POS também;
 *  - tocar duas vezes em "Enviar" não lança dois pedidos nem baixa o stock duas vezes (Regra 4);
 *  - garçom da Matola não lança numa mesa de Maputo nem serve um pedido de lá (Regra 3);
 *  - desactivar o garçom ou trocar-lhe o PIN fecha o telemóvel antigo.
 *
 * Corre na Matola pela razão do comanda-padrao: pôr papel na fila sem
 * impressora a sério à escuta.
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
const PASSWORD = "Garcons-1122-Teste-2026!";
const PIN = "5713";
const MESA = 96;

let admin: SupabaseClient;
let anon: SupabaseClient;
let gerente: SupabaseClient;
let gerenteMaputo: SupabaseClient;
let caixa: SupabaseClient;
let matolaStoreId: string;
let maputoStoreId: string;
let deviceId: string;
let classicId: string;
let hawId: string;
let precoHaw: number;
let mesaId: string;
let mesaMaputoId: string;
let inicio: string;
let stockAntes: { available: boolean; track_stock: boolean; stock_qty: number } | null = null;
let viasAntes: number | null = null;
let ingredientesAntes: Array<{ ingredient_id: string; qty: number }> = [];

const criadosUsers: string[] = [];
const criadosPedidos: string[] = [];
const criadosGarcons: string[] = [];
const criadasMesas: string[] = [];

// Telefones de teste: 9 dígitos, prefixo 80 (não atribuído a operadora em MZ).
const telefone = (n: number) => `80${sufixo.slice(-5)}${String(n).padStart(2, "0")}`;

async function conta(role: string, loja: string, nome: string): Promise<SupabaseClient> {
  const email = `garcons-${role}-${nome}-${sufixo}@delivery.test`;
  const { data: user, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error || !user.user) throw new Error(`Setup 1122: conta ${role} — ${error?.message}`);
  criadosUsers.push(user.user.id);
  await admin.from("staff_profiles").insert({ user_id: user.user.id, full_name: `Teste ${role}`, role, active: true });
  await admin.from("staff_stores").insert({ user_id: user.user.id, store_id: loja });
  const cliente = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: loginError } = await cliente.auth.signInWithPassword({ email, password: PASSWORD });
  if (loginError) throw new Error(`Setup 1122: sessão ${role} — ${loginError.message}`);
  return cliente;
}

async function novoGarcom(n: number, loja = matolaStoreId, quem: SupabaseClient = gerente) {
  const phone = telefone(n);
  const { data: id, error } = await quem.rpc("save_waiter", {
    p_waiter_id: null,
    p_store_id: loja,
    p_full_name: `Garçom Teste ${n}`,
    p_phone: phone,
    p_active: true,
  });
  if (error) throw new Error(`Setup 1122: save_waiter — ${error.message}`);
  criadosGarcons.push(id as string);
  const { error: pinError } = await quem.rpc("set_waiter_pin", { p_waiter_id: id, p_pin: PIN });
  if (pinError) throw new Error(`Setup 1122: set_waiter_pin — ${pinError.message}`);
  return { id: id as string, phone, nome: `Garçom Teste ${n}` };
}

async function entrar(phone: string, pin = PIN): Promise<string> {
  const { data, error } = await admin.rpc("waiter_login", { p_phone: phone, p_pin: pin });
  if (error) throw new Error(`waiter_login — ${error.message}`);
  if (!data.ok) throw new Error(`waiter_login recusou: ${data.reason}`);
  return data.token as string;
}

function lancar(token: string, items: unknown[], clientSaleId = crypto.randomUUID(), tableId = mesaId, extra = {}) {
  return admin.rpc("waiter_launch_order", {
    p_token: token,
    p_payload: { clientSaleId, tableId, items, ...extra },
  });
}

async function stockDoClassic(): Promise<number> {
  const { data } = await admin
    .from("store_items")
    .select("stock_qty")
    .eq("store_id", matolaStoreId)
    .eq("menu_item_id", classicId)
    .single();
  return data?.stock_qty as number;
}

beforeAll(async () => {
  inicio = new Date(Date.now() - 60_000).toISOString();
  admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: lojas } = await admin.from("stores").select("id,slug").in("slug", ["matola", "maputo"]);
  matolaStoreId = lojas!.find((l) => l.slug === "matola")!.id as string;
  maputoStoreId = lojas!.find((l) => l.slug === "maputo")!.id as string;

  const { data: vias } = await admin.from("stores").select("kitchen_ticket_copies").eq("id", matolaStoreId).single();
  viasAntes = (vias?.kitchen_ticket_copies as number | undefined) ?? null;
  await admin.from("stores").update({ kitchen_ticket_copies: 2 }).eq("id", matolaStoreId);

  const { data: classic } = await admin.from("menu_items").select("id").eq("name", "Classic Smash").single();
  if (!classic) throw new Error("Setup 1122: Classic Smash não encontrado");
  classicId = classic.id as string;
  const { data: haw } = await admin
    .from("menu_item_variants")
    .select("id,price_cents")
    .eq("menu_item_id", classicId)
    .eq("name", "HAW")
    .single();
  if (!haw) throw new Error("Setup 1122: falta a variante HAW do Classic");
  hawId = haw.id as string;
  precoHaw = haw.price_cents as number;

  const { data: stock } = await admin
    .from("store_items")
    .select("available,track_stock,stock_qty")
    .eq("store_id", matolaStoreId)
    .eq("menu_item_id", classicId)
    .single();
  stockAntes = stock;
  await admin
    .from("store_items")
    .update({ available: true, track_stock: true, stock_qty: 50 })
    .eq("store_id", matolaStoreId)
    .eq("menu_item_id", classicId);

  const { data: ingredientes } = await admin.from("store_ingredients").select("ingredient_id,qty").eq("store_id", matolaStoreId);
  ingredientesAntes = (ingredientes ?? []) as Array<{ ingredient_id: string; qty: number }>;
  await admin.from("store_ingredients").update({ qty: 100000 }).eq("store_id", matolaStoreId);

  const { data: mesas, error: mesasError } = await admin
    .from("tables")
    .insert([
      { store_id: matolaStoreId, number: MESA },
      { store_id: maputoStoreId, number: MESA },
    ])
    .select("id,store_id");
  if (mesasError || !mesas) throw new Error(`Setup 1122: mesas — ${mesasError?.message}`);
  criadasMesas.push(...mesas.map((m) => m.id as string));
  mesaId = mesas.find((m) => m.store_id === matolaStoreId)!.id as string;
  mesaMaputoId = mesas.find((m) => m.store_id === maputoStoreId)!.id as string;

  gerente = await conta("manager", matolaStoreId, "mtl");
  gerenteMaputo = await conta("manager", maputoStoreId, "mpt");
  caixa = await conta("cashier", matolaStoreId, "mtl");

  const { data: device, error: deviceError } = await admin
    .from("devices")
    .insert({ store_id: matolaStoreId, kind: "pos", label: `POS garçons ${sufixo}`, device_key_hash: `garcons-${sufixo}` })
    .select("id")
    .single();
  if (deviceError || !device) throw new Error(`Setup 1122: terminal — ${deviceError?.message}`);
  deviceId = device.id as string;
}, 120_000);

afterAll(async () => {
  if (!admin) return;
  if (viasAntes !== null) {
    await admin.from("stores").update({ kitchen_ticket_copies: viasAntes }).eq("id", matolaStoreId);
  }
  for (const linha of ingredientesAntes) {
    await admin
      .from("store_ingredients")
      .update({ qty: linha.qty })
      .eq("store_id", matolaStoreId)
      .eq("ingredient_id", linha.ingredient_id);
  }
  if (stockAntes) {
    await admin.from("store_items").update(stockAntes).eq("store_id", matolaStoreId).eq("menu_item_id", classicId);
  }
  if (criadosPedidos.length > 0) {
    await admin.from("print_jobs").delete().in("order_id", criadosPedidos);
    await admin.from("stock_movements").delete().in("order_id", criadosPedidos);
    await admin.from("event_log").delete().in("order_id", criadosPedidos);
    await admin.from("orders").delete().in("id", criadosPedidos);
  }
  if (criadosGarcons.length > 0) {
    await admin.from("waiter_sessions").delete().in("waiter_id", criadosGarcons);
    await admin.from("waiter_credentials").delete().in("waiter_id", criadosGarcons);
    await admin.from("waiters").delete().in("id", criadosGarcons);
  }
  await admin.from("event_log").delete().in("actor_user_id", criadosUsers);
  await admin.from("event_log").delete().like("type", "waiter.%").gte("created_at", inicio);
  if (criadasMesas.length > 0) await admin.from("tables").delete().in("id", criadasMesas);
  if (deviceId) await admin.from("devices").delete().eq("id", deviceId);
  for (const id of criadosUsers) {
    await admin.from("staff_stores").delete().eq("user_id", id);
    await admin.from("staff_profiles").delete().eq("user_id", id);
    await admin.auth.admin.deleteUser(id);
  }
});

describe("1122 · quem gere os garçons", () => {
  it("o caixa não cria garçom", async () => {
    const { error } = await caixa.rpc("save_waiter", {
      p_waiter_id: null, p_store_id: matolaStoreId, p_full_name: "Não Devia", p_phone: telefone(90), p_active: true,
    });
    expect(error?.message).toContain("waiter_access_denied");
  });

  it("o gerente de Maputo não cria garçom na Matola", async () => {
    const { error } = await gerenteMaputo.rpc("save_waiter", {
      p_waiter_id: null, p_store_id: matolaStoreId, p_full_name: "Outra Loja", p_phone: telefone(91), p_active: true,
    });
    expect(error?.message).toContain("waiter_access_denied");
  });

  it("o telefone não se repete entre garçons activos, e o PIN não se lê", async () => {
    const { id, phone } = await novoGarcom(1);
    const { error } = await gerente.rpc("save_waiter", {
      p_waiter_id: null, p_store_id: matolaStoreId, p_full_name: "Duplicado", p_phone: `+258 ${phone}`, p_active: true,
    });
    expect(error?.message).toContain("waiter_phone_taken");

    const { data, error: credError } = await gerente.from("waiter_credentials").select("*").eq("waiter_id", id);
    expect(credError !== null || (data ?? []).length === 0).toBe(true);
  });

  it("o gerente vê os garçons da loja dele, com o PIN marcado", async () => {
    const { data, error } = await gerente.rpc("get_waiters", { p_store_id: matolaStoreId });
    expect(error).toBeNull();
    const meu = (data as Array<{ id: string; has_pin: boolean }>).find((w) => w.id === criadosGarcons[0]);
    expect(meu?.has_pin).toBe(true);

    const { error: alheio } = await gerenteMaputo.rpc("get_waiters", { p_store_id: matolaStoreId });
    expect(alheio?.message).toContain("waiter_access_denied");
  });
});

describe("1122 · o telemóvel do garçom", () => {
  it("as RPCs do telemóvel não abrem à anon nem à sessão da equipa", async () => {
    const { error: e1 } = await anon.rpc("waiter_login", { p_phone: "840000000", p_pin: "1234" });
    const { error: e2 } = await caixa.rpc("waiter_state", { p_token: "x".repeat(64) });
    const { error: e3 } = await caixa.rpc("waiter_launch_order", { p_token: "x".repeat(64), p_payload: {} });
    expect(e1).not.toBeNull();
    expect(e2).not.toBeNull();
    expect(e3).not.toBeNull();
  });

  it("PIN errado não entra, e token inventado não lê nada", async () => {
    const { phone } = await novoGarcom(2);
    const { data } = await admin.rpc("waiter_login", { p_phone: phone, p_pin: "0000" });
    expect(data).toMatchObject({ ok: false, reason: "invalid_credentials" });

    const { error } = await admin.rpc("waiter_state", { p_token: "f".repeat(64) });
    expect(error?.message).toContain("waiter_session_invalid");
  });

  it("cinco PIN errados bloqueiam, mesmo com o certo a seguir", async () => {
    const { phone } = await novoGarcom(3);
    for (let i = 0; i < 5; i += 1) {
      await admin.rpc("waiter_login", { p_phone: phone, p_pin: "0000" });
    }
    const { data } = await admin.rpc("waiter_login", { p_phone: phone, p_pin: PIN });
    expect(data).toMatchObject({ ok: false, reason: "pin_locked" });
  });

  it("vê as mesas da loja dele e o cardápio dela — nunca as de Maputo", async () => {
    const { phone } = await novoGarcom(4);
    const token = await entrar(phone);
    const { data, error } = await admin.rpc("waiter_state", { p_token: token });
    expect(error).toBeNull();
    const ids = (data.tables as Array<{ id: string }>).map((t) => t.id);
    expect(ids).toContain(mesaId);
    expect(ids).not.toContain(mesaMaputoId);
    expect(data.store).toMatchObject({ open: true });

    const { data: menu, error: menuError } = await admin.rpc("waiter_menu", { p_token: token });
    expect(menuError).toBeNull();
    const itens = (menu.categories as Array<{ items: Array<{ id: string }> }>).flatMap((c) => c.items);
    expect(itens.some((item) => item.id === classicId)).toBe(true);
  });
});

describe("1122 · o pedido do garçom", () => {
  let garcom: { id: string; phone: string; nome: string };
  let token: string;
  let pedidoId: string;
  let clientSaleId: string;

  beforeAll(async () => {
    garcom = await novoGarcom(5);
    token = await entrar(garcom.phone);
  });

  it("não lança numa mesa de Maputo", async () => {
    const { error } = await lancar(token, [{ menuItemId: classicId, qty: 1 }], crypto.randomUUID(), mesaMaputoId);
    expect(error?.message).toContain("invalid_table");
  });

  it("lança na mesa a preço da loja, por pagar, e baixa o stock", async () => {
    const antes = await stockDoClassic();
    clientSaleId = crypto.randomUUID();
    const { data, error } = await lancar(
      token,
      // O preço que o telemóvel mandasse seria ignorado: só vão ids e quantidades.
      [{ menuItemId: classicId, variantId: hawId, qty: 2, notes: "Sem cebola", unitPriceCents: 1 }],
      clientSaleId,
      mesaId,
      { customerName: "Rita", notes: "Sem pressa" },
    );
    expect(error).toBeNull();
    pedidoId = data.order_id as string;
    criadosPedidos.push(pedidoId);
    expect(data).toMatchObject({
      table_number: MESA,
      total_cents: 2 * precoHaw,
      customer_name: `Mesa ${MESA} · Rita`,
      duplicate: false,
    });

    const { data: pedido } = await admin
      .from("orders")
      .select("status,fulfillment_type,payment_method,waiter_id,table_id,notes")
      .eq("id", pedidoId)
      .single();
    expect(pedido).toMatchObject({
      status: "in_preparation",
      fulfillment_type: "dine_in",
      payment_method: "no_payment",
      waiter_id: garcom.id,
      table_id: mesaId,
      notes: "Sem pressa",
    });

    const { count: pagamentos } = await admin
      .from("payments")
      .select("id", { count: "exact", head: true })
      .eq("order_id", pedidoId);
    expect(pagamentos).toBe(0);
    expect(await stockDoClassic()).toBe(antes - 2);
  });

  it("a comanda sai nas vias da loja com o nome do garçom, e a senha no balcão", async () => {
    const { data: jobs } = await admin
      .from("print_jobs")
      .select("kind,station,payload")
      .eq("order_id", pedidoId);
    const comandas = (jobs ?? []).filter((j) => j.kind === "order");
    const senhas = (jobs ?? []).filter((j) => j.kind === "receipt" && j.station === "counter");
    expect(comandas).toHaveLength(2);
    expect(senhas).toHaveLength(1);
    for (const comanda of comandas) {
      expect(comanda.payload.notes).toBe(`Garçom: ${garcom.nome} · Sem pressa`);
      expect(comanda.payload.table_number).toBe(MESA);
    }
    // O pedido em si não leva o nome do garçom nas notas.
    const { data: pedido } = await admin.from("orders").select("notes").eq("id", pedidoId).single();
    expect(pedido!.notes).toBe("Sem pressa");
  });

  it("dois toques em Enviar dão o mesmo pedido, e o stock baixa uma vez só", async () => {
    const antes = await stockDoClassic();
    const { data, error } = await lancar(token, [{ menuItemId: classicId, variantId: hawId, qty: 2 }], clientSaleId);
    expect(error).toBeNull();
    expect(data).toMatchObject({ order_id: pedidoId, duplicate: true });
    expect(await stockDoClassic()).toBe(antes);

    const { count } = await admin
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("client_sale_id", clientSaleId);
    expect(count).toBe(1);
  });

  it("outro garçom não abre o pedido com a chave deste", async () => {
    const outro = await novoGarcom(6);
    const outroToken = await entrar(outro.phone);
    const { error } = await lancar(outroToken, [{ menuItemId: classicId, qty: 1 }], clientSaleId);
    expect(error?.message).toContain("client_sale_id_store_conflict");
  });

  it("o POS vê o pedido na conta da mesa, com o nome do garçom", async () => {
    const { data, error } = await caixa.rpc("pos_table_overview", { p_device_id: deviceId });
    expect(error).toBeNull();
    const mesa = (data.tables as Array<{ id: string; orders: Array<{ id: string; waiter_name: string | null }> }>)
      .find((t) => t.id === mesaId);
    const pedido = mesa?.orders.find((o) => o.id === pedidoId);
    expect(pedido?.waiter_name).toBe(garcom.nome);

    // E o telemóvel vê a mesma conta.
    const { data: estado } = await admin.rpc("waiter_state", { p_token: token });
    const naMesa = (estado.tables as Array<{ id: string; orders: Array<{ id: string }> }>).find((t) => t.id === mesaId);
    expect(naMesa?.orders.map((o) => o.id)).toContain(pedidoId);
    expect(estado.today.orders).toBeGreaterThanOrEqual(1);
  });

  it("Servido leva o pedido a entregue; repetir não muda nada; continua na conta", async () => {
    const { data, error } = await admin.rpc("waiter_serve_order", { p_token: token, p_order_id: pedidoId });
    expect(error).toBeNull();
    expect(data).toMatchObject({ status: "delivered", unchanged: false });

    const { data: outraVez } = await admin.rpc("waiter_serve_order", { p_token: token, p_order_id: pedidoId });
    expect(outraVez).toMatchObject({ status: "delivered", unchanged: true });

    const { data: pedido } = await admin.from("orders").select("status,table_bill_id").eq("id", pedidoId).single();
    expect(pedido).toMatchObject({ status: "delivered", table_bill_id: null });
  });

  it("o esgotado não aparece no cardápio dele, e o servidor recusa-o se vier", async () => {
    await admin
      .from("store_items")
      .update({ available: false })
      .eq("store_id", matolaStoreId)
      .eq("menu_item_id", classicId);
    try {
      const { data: menu } = await admin.rpc("waiter_menu", { p_token: token });
      const itens = (menu.categories as Array<{ items: Array<{ id: string }> }>).flatMap((c) => c.items);
      expect(itens.some((item) => item.id === classicId)).toBe(false);

      const { error } = await lancar(token, [{ menuItemId: classicId, qty: 1 }]);
      expect(error?.message).toContain("item_unavailable");
    } finally {
      await admin
        .from("store_items")
        .update({ available: true })
        .eq("store_id", matolaStoreId)
        .eq("menu_item_id", classicId);
    }
  });

  it("um garçom de Maputo não serve um pedido da Matola", async () => {
    const deMaputo = await novoGarcom(7, maputoStoreId, gerenteMaputo);
    const tokenMaputo = await entrar(deMaputo.phone);
    const { error } = await admin.rpc("waiter_serve_order", { p_token: tokenMaputo, p_order_id: pedidoId });
    expect(error?.message).toContain("order_not_found");
  });
});

describe("1122 · fechar o telemóvel antigo", () => {
  it("PIN novo termina a sessão aberta", async () => {
    const g = await novoGarcom(8);
    const token = await entrar(g.phone);
    await gerente.rpc("set_waiter_pin", { p_waiter_id: g.id, p_pin: "9182" });
    const { error } = await admin.rpc("waiter_state", { p_token: token });
    expect(error?.message).toContain("waiter_session_invalid");
  });

  it("desactivar o garçom termina a sessão e impede a entrada", async () => {
    const g = await novoGarcom(9);
    const token = await entrar(g.phone);
    const { error: saveError } = await gerente.rpc("save_waiter", {
      p_waiter_id: g.id, p_store_id: matolaStoreId, p_full_name: g.nome, p_phone: g.phone, p_active: false,
    });
    expect(saveError).toBeNull();
    const { error } = await admin.rpc("waiter_state", { p_token: token });
    expect(error?.message).toContain("waiter_session_invalid");
    const { data } = await admin.rpc("waiter_login", { p_phone: g.phone, p_pin: PIN });
    expect(data).toMatchObject({ ok: false, reason: "invalid_credentials" });
  });
});
