/**
 * Gate da 1129 — telefone e característica do cliente na conta da mesa.
 *
 * Pedido da loja (Nov/2026). O que tem de ser verdade:
 *
 *  - telefone e OBS são da CONTA, como o nome (1092): quem pede a seguir herda;
 *  - o caixa e o garçom escrevem-nos ao lançar; o caixa corrige-os depois;
 *  - o telefone fica normalizado e nunca sai para o telemóvel do garçom;
 *  - a OBS sai na comanda, para quem leva o prato encontrar a pessoa;
 *  - fechada a conta, a mesa seguinte começa sem nada disto;
 *  - nada atravessa lojas (Regra 3) e a mudança fica registada.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://localhost:54731";
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz";

const sufixo = `${Date.now()}`;
const PASSWORD = "MesaCliente-1129-Teste-2026!";
const PIN = "5713";
const MESA = 92;
// 9 dígitos, prefixo 80 (não atribuído a operadora em MZ).
const TELEFONE = `80${sufixo.slice(-7)}`;
const OBS = "Camisa azul, junto à janela";
const inicio = new Date(Date.now() - 60_000).toISOString();

type Pedido = { id: string; customer_name: string; customer_phone?: string | null; tab_note?: string | null };
type Mesa = { id: string; orders: Pedido[] };

let admin: SupabaseClient;
let anon: SupabaseClient;
let caixa: SupabaseClient;
let caixaMaputo: SupabaseClient;
let gerente: SupabaseClient;
let matola: string;
let maputo: string;
let deviceId: string;
let mesaId: string;
let classicId: string;
let hawId: string;
let dineInAntes: boolean | null = null;
let stockAntes: { available: boolean; track_stock: boolean; stock_qty: number } | null = null;
let ingredientesAntes: Array<{ ingredient_id: string; qty: number }> = [];
let tokenGarcom: string;
let garcomId: string;

const criadosUsers: string[] = [];
const criadosPedidos: string[] = [];
const criadasContas: string[] = [];
const criadasMesas: string[] = [];

async function conta(role: string, loja: string, nome: string): Promise<SupabaseClient> {
  const email = `mesa-cliente-${nome}-${sufixo}@delivery.test`;
  const { data: user, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error || !user.user) throw new Error(`Setup 1129: conta — ${error?.message}`);
  criadosUsers.push(user.user.id);
  await admin.from("staff_profiles").insert({ user_id: user.user.id, full_name: `Teste ${nome}`, role, active: true });
  await admin.from("staff_stores").insert({ user_id: user.user.id, store_id: loja });
  const cliente = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: loginError } = await cliente.auth.signInWithPassword({ email, password: PASSWORD });
  if (loginError) throw new Error(`Setup 1129: sessão — ${loginError.message}`);
  return cliente;
}

async function lancar(extra: Record<string, string> = {}) {
  const { data, error } = await caixa.rpc("launch_table_order", {
    p_payload: {
      clientSaleId: crypto.randomUUID(),
      deviceId,
      tableId: mesaId,
      items: [{ menuItemId: classicId, qty: 1, variantId: hawId }],
      ...extra,
    },
  });
  if (error) throw new Error(`launch_table_order — ${error.message}`);
  criadosPedidos.push(data.order_id as string);
  return data.order_id as string;
}

async function mesaNoPos(): Promise<Mesa> {
  const { data, error } = await caixa.rpc("pos_table_overview", { p_device_id: deviceId });
  if (error) throw new Error(`pos_table_overview — ${error.message}`);
  return (data.tables as Mesa[]).find((m) => m.id === mesaId)!;
}

async function pagarAMesa() {
  const mesa = await mesaNoPos();
  const totais = await admin.from("orders").select("total_cents").in("id", mesa.orders.map((o) => o.id));
  const total = (totais.data ?? []).reduce((soma, o) => soma + (o.total_cents as number), 0);
  const { data, error } = await caixa.rpc("close_table_bill", {
    p_payload: {
      clientCloseId: crypto.randomUUID(),
      deviceId,
      tableId: mesaId,
      expectedTotalCents: total,
      payments: [{ method: "mpesa", amountCents: total }],
    },
  });
  if (error) throw new Error(`close_table_bill — ${error.message}`);
  criadasContas.push(data.bill_id as string);
}

beforeAll(async () => {
  admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: lojas } = await admin.from("stores").select("id,slug").in("slug", ["matola", "maputo"]);
  matola = lojas!.find((l) => l.slug === "matola")!.id as string;
  maputo = lojas!.find((l) => l.slug === "maputo")!.id as string;

  const { data: classic } = await admin.from("menu_items").select("id,available_dine_in").eq("name", "Classic Smash").single();
  classicId = classic!.id as string;
  dineInAntes = classic!.available_dine_in as boolean;
  await admin.from("menu_items").update({ available_dine_in: true }).eq("id", classicId);
  const { data: haw } = await admin.from("menu_item_variants").select("id").eq("menu_item_id", classicId).eq("name", "HAW").single();
  hawId = haw!.id as string;

  const { data: stock } = await admin
    .from("store_items")
    .select("available,track_stock,stock_qty")
    .eq("store_id", matola)
    .eq("menu_item_id", classicId)
    .single();
  stockAntes = stock;
  await admin
    .from("store_items")
    .update({ available: true, track_stock: true, stock_qty: 50 })
    .eq("store_id", matola)
    .eq("menu_item_id", classicId);
  const { data: ingredientes } = await admin.from("store_ingredients").select("ingredient_id,qty").eq("store_id", matola);
  ingredientesAntes = (ingredientes ?? []) as Array<{ ingredient_id: string; qty: number }>;
  await admin.from("store_ingredients").update({ qty: 100000 }).eq("store_id", matola);

  const { data: mesa, error: mesaError } = await admin
    .from("tables")
    .insert({ store_id: matola, number: MESA })
    .select("id")
    .single();
  if (mesaError || !mesa) throw new Error(`Setup 1129: mesa — ${mesaError?.message}`);
  mesaId = mesa.id as string;
  criadasMesas.push(mesaId);

  caixa = await conta("cashier", matola, "caixa");
  caixaMaputo = await conta("cashier", maputo, "caixa-mpt");
  gerente = await conta("manager", matola, "gerente");

  const { data: device, error: deviceError } = await admin
    .from("devices")
    .insert({ store_id: matola, kind: "pos", label: `POS cliente ${sufixo}`, device_key_hash: `mesa-cliente-${sufixo}` })
    .select("id")
    .single();
  if (deviceError || !device) throw new Error(`Setup 1129: terminal — ${deviceError?.message}`);
  deviceId = device.id as string;

  const telefoneGarcom = `80${sufixo.slice(-6)}9`;
  const { data: id, error: garcomError } = await gerente.rpc("save_waiter", {
    p_waiter_id: null,
    p_store_id: matola,
    p_full_name: "Garçom Cliente",
    p_phone: telefoneGarcom,
    p_active: true,
  });
  if (garcomError) throw new Error(`Setup 1129: garçom — ${garcomError.message}`);
  garcomId = id as string;
  await gerente.rpc("set_waiter_pin", { p_waiter_id: garcomId, p_pin: PIN });
  const { data: login } = await admin.rpc("waiter_login", { p_phone: telefoneGarcom, p_pin: PIN });
  tokenGarcom = login.token as string;
}, 90_000);

afterAll(async () => {
  if (!admin) return;
  if (dineInAntes !== null) await admin.from("menu_items").update({ available_dine_in: dineInAntes }).eq("id", classicId);
  for (const linha of ingredientesAntes) {
    await admin.from("store_ingredients").update({ qty: linha.qty }).eq("store_id", matola).eq("ingredient_id", linha.ingredient_id);
  }
  if (stockAntes) await admin.from("store_items").update(stockAntes).eq("store_id", matola).eq("menu_item_id", classicId);
  if (criadasContas.length > 0) await admin.from("print_jobs").delete().in("request_id", criadasContas);
  if (criadosPedidos.length > 0) {
    await admin.from("print_jobs").delete().in("order_id", criadosPedidos);
    await admin.from("stock_movements").delete().in("order_id", criadosPedidos);
    await admin.from("event_log").delete().in("order_id", criadosPedidos);
    await admin.from("orders").delete().in("id", criadosPedidos);
  }
  if (criadasContas.length > 0) await admin.from("table_bills").delete().in("id", criadasContas);
  // Pagar a conta abre um turno automático: não pode ficar para o teste seguinte.
  const { data: caixas } = await admin.from("cash_sessions").select("id").eq("store_id", matola).gte("opened_at", inicio);
  const idsCaixa = (caixas ?? []).map((c) => c.id as string);
  if (idsCaixa.length > 0) {
    await admin.from("cash_movements").delete().in("session_id", idsCaixa);
    await admin.from("cash_sessions").delete().in("id", idsCaixa);
  }
  await admin.from("customers").delete().eq("phone", TELEFONE);
  await admin.from("event_log").delete().in("actor_user_id", criadosUsers);
  if (garcomId) {
    await admin.from("waiter_sessions").delete().eq("waiter_id", garcomId);
    await admin.from("waiters").delete().eq("id", garcomId);
  }
  if (criadasMesas.length > 0) await admin.from("tables").delete().in("id", criadasMesas);
  if (deviceId) await admin.from("devices").delete().eq("id", deviceId);
  for (const id of criadosUsers) {
    await admin.from("staff_stores").delete().eq("user_id", id);
    await admin.from("staff_profiles").delete().eq("user_id", id);
    await admin.auth.admin.deleteUser(id);
  }
});

describe("1129 · telefone e característica na conta da mesa", () => {
  it("o caixa grava-os ao lançar, com o telefone normalizado", async () => {
    const id = await lancar({ customerName: "João", customerPhone: `+258 ${TELEFONE}`, tabNote: OBS });
    const { data } = await admin.from("orders").select("customer_name,customer_phone,tab_note").eq("id", id).single();
    expect(data).toEqual({ customer_name: `Mesa ${MESA} · João`, customer_phone: TELEFONE, tab_note: OBS });
  });

  it("a OBS sai na comanda, o telefone não", async () => {
    const id = await lancar();
    const { data: jobs } = await admin.from("print_jobs").select("payload").eq("order_id", id).eq("kind", "order");
    expect(jobs!.length).toBeGreaterThan(0);
    for (const job of jobs!) {
      expect(job.payload.notes).toContain(`Cliente: ${OBS}`);
      expect(JSON.stringify(job.payload)).not.toContain(TELEFONE);
    }
  });

  it("o pedido seguinte herda sem ninguém repetir", async () => {
    const id = await lancar();
    const { data } = await admin.from("orders").select("customer_name,customer_phone,tab_note").eq("id", id).single();
    expect(data).toEqual({ customer_name: `Mesa ${MESA} · João`, customer_phone: TELEFONE, tab_note: OBS });
  });

  it("o pedido pelo QR também herda", async () => {
    const { data: id, error } = await anon.rpc("create_order", {
      p_store_slug: "matola",
      p_payload: { fulfillmentType: "dine_in", tableId: mesaId, items: [{ menuItemId: classicId, qty: 1 }] },
    });
    expect(error).toBeNull();
    criadosPedidos.push(id as string);
    const { data } = await admin.from("orders").select("customer_phone,tab_note").eq("id", id as string).single();
    expect(data).toEqual({ customer_phone: TELEFONE, tab_note: OBS });
  });

  it("o POS vê telefone e OBS; o telemóvel do garçom vê a OBS mas não o telefone", async () => {
    const mesa = await mesaNoPos();
    expect(mesa.orders.at(-1)).toMatchObject({ customer_phone: TELEFONE, tab_note: OBS });

    const { data, error } = await admin.rpc("waiter_state", { p_token: tokenGarcom });
    expect(error).toBeNull();
    const naMao = (data.tables as Mesa[]).find((m) => m.id === mesaId)!;
    expect(naMao.orders.at(-1)?.tab_note).toBe(OBS);
    expect(JSON.stringify(data)).not.toContain(TELEFONE);
  });

  it("o garçom grava-os ao lançar e os seguintes herdam", async () => {
    const outra = "Boné vermelho";
    const { data, error } = await admin.rpc("waiter_launch_order", {
      p_token: tokenGarcom,
      p_payload: {
        clientSaleId: crypto.randomUUID(),
        tableId: mesaId,
        items: [{ menuItemId: classicId, qty: 1, variantId: hawId }],
        tabNote: outra,
      },
    });
    expect(error).toBeNull();
    criadosPedidos.push(data.order_id as string);
    const { data: pedido } = await admin
      .from("orders")
      .select("customer_phone,tab_note")
      .eq("id", data.order_id as string)
      .single();
    expect(pedido).toEqual({ customer_phone: TELEFONE, tab_note: outra });
    // O mais recente manda: o seguinte herda esta OBS, não a primeira.
    const id = await lancar();
    const { data: seguinte } = await admin.from("orders").select("tab_note").eq("id", id).single();
    expect(seguinte?.tab_note).toBe(outra);
  });

  it("o caixa corrige a conta inteira depois de lançar, e fica registado", async () => {
    const { data, error } = await caixa.rpc("update_table_tab_customer", {
      p_payload: { deviceId, tableId: mesaId, customerName: "Maria", customerPhone: `258${TELEFONE}`, tabNote: "Vestido verde" },
    });
    expect(error).toBeNull();
    expect(data).toMatchObject({ customer_name: "Maria", customer_phone: TELEFONE, tab_note: "Vestido verde" });

    const mesa = await mesaNoPos();
    expect(mesa.orders.length).toBeGreaterThan(1);
    for (const pedido of mesa.orders) {
      expect(pedido).toMatchObject({
        customer_name: `Mesa ${MESA} · Maria`,
        customer_phone: TELEFONE,
        tab_note: "Vestido verde",
      });
    }

    const { data: eventos } = await admin
      .from("event_log")
      .select("store_id,actor_user_id,payload")
      .eq("type", "table.tab_customer_updated")
      .in("actor_user_id", criadosUsers);
    expect(eventos).toHaveLength(1);
    expect(eventos![0].store_id).toBe(matola);
    // Quem lê o registo de auditoria não precisa do número do cliente.
    expect(JSON.stringify(eventos![0].payload)).not.toContain(TELEFONE);
  });

  it("o que não vem fica como está; vazio apaga", async () => {
    await caixa.rpc("update_table_tab_customer", { p_payload: { deviceId, tableId: mesaId, tabNote: "" } });
    const mesa = await mesaNoPos();
    expect(mesa.orders.at(-1)).toMatchObject({
      customer_name: `Mesa ${MESA} · Maria`,
      customer_phone: TELEFONE,
      tab_note: null,
    });
  });

  it("um caixa de outra loja não mexe nesta conta (Regra 3)", async () => {
    const { error } = await caixaMaputo.rpc("update_table_tab_customer", {
      p_payload: { deviceId, tableId: mesaId, customerName: "Intruso" },
    });
    expect(error?.message).toContain("invalid_or_unauthorised_device");
  });

  it("a anon não chama a função", async () => {
    const { error } = await anon.rpc("update_table_tab_customer", {
      p_payload: { deviceId, tableId: mesaId, customerName: "Intruso" },
    });
    expect(error).not.toBeNull();
  });

  it("fechada a conta, a mesa seguinte começa sem telefone nem OBS", async () => {
    await pagarAMesa();
    const semContaAberta = await caixa.rpc("update_table_tab_customer", {
      p_payload: { deviceId, tableId: mesaId, customerName: "Depois" },
    });
    expect(semContaAberta.error?.message).toContain("table_has_no_open_orders");

    const id = await lancar();
    const { data } = await admin.from("orders").select("customer_name,customer_phone,tab_note").eq("id", id).single();
    expect(data).toEqual({ customer_name: `Mesa ${MESA}`, customer_phone: null, tab_note: null });
  });
});
