/**
 * Gate de integração da 1127 — o mini POS do garçom.
 *
 * O que tem de ser verdade contra um Supabase a sério:
 *  - retirar: só os pedidos dele, na cozinha, dentro do limite da loja; repõe o
 *    stock, baixa o total e fica registado; dois toques retiram um;
 *  - cobrar: só com autorização, nunca em dinheiro, com o total que o garçom viu;
 *    a conta fica como a do POS e repetir não cobra duas vezes;
 *  - mudar de mesa: a conta muda inteira, junta-se à que lá estiver, e a cozinha sabe;
 *  - nada disto atravessa lojas (Regra 3) nem abre à anon ou à equipa;
 *  - o POS continua igual: mesmas funções, mesmo resultado.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://localhost:54731";
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz";

const sufixo = `${Date.now()}`;
const PASSWORD = "MiniPos-1127-Teste-2026!";
const PIN = "3719";

let admin: SupabaseClient;
let anon: SupabaseClient;
let gerente: SupabaseClient;
let gerenteMaputo: SupabaseClient;
let caixa: SupabaseClient;
let matola: string;
let maputo: string;
let deviceId: string;
let itemId: string;
let varianteId: string;
let preco: number;
let inicio: string;
let mesas: string[] = [];
let mesaMaputo: string;
let numeros: number[] = [];
let ana: { id: string; token: string };
let beto: { id: string; token: string };
let deMaputo: { id: string; token: string };
let stockAntes: { available: boolean; track_stock: boolean; stock_qty: number } | null = null;
let ingredientesAntes: Array<{ ingredient_id: string; qty: number }> = [];

const users: string[] = [];
const pedidos: string[] = [];
const garcons: string[] = [];
const contas: string[] = [];
const criadasMesas: string[] = [];

const telefone = (n: number) => `82${sufixo.slice(-5)}${String(n).padStart(2, "0")}`;

async function conta(role: string, loja: string, nome: string) {
  const email = `minipos-${role}-${nome}-${sufixo}@delivery.test`;
  const { data: user, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error || !user.user) throw new Error(`Setup 1127: ${error?.message}`);
  users.push(user.user.id);
  await admin.from("staff_profiles").insert({ user_id: user.user.id, full_name: `Teste ${nome}`, role, active: true });
  await admin.from("staff_stores").insert({ user_id: user.user.id, store_id: loja });
  const cliente = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  await cliente.auth.signInWithPassword({ email, password: PASSWORD });
  return cliente;
}

async function garcom(n: number, loja: string, quem: SupabaseClient) {
  const { data: id, error } = await quem.rpc("save_waiter", {
    p_waiter_id: null, p_store_id: loja, p_full_name: `Garçom ${n}`, p_phone: telefone(n), p_active: true,
  });
  if (error) throw new Error(`Setup 1127: ${error.message}`);
  garcons.push(id as string);
  await quem.rpc("set_waiter_pin", { p_waiter_id: id, p_pin: PIN });
  const { data } = await admin.rpc("waiter_login", { p_phone: telefone(n), p_pin: PIN });
  return { id: id as string, token: data.token as string };
}

async function lancar(token: string, tableId: string, qty = 2) {
  const { data, error } = await admin.rpc("waiter_launch_order", {
    p_token: token,
    p_payload: { clientSaleId: crypto.randomUUID(), tableId, items: [{ menuItemId: itemId, variantId: varianteId, qty }] },
  });
  if (error) throw new Error(`lançar: ${error.message}`);
  pedidos.push(data.order_id as string);
  return data.order_id as string;
}

async function linhaDe(orderId: string) {
  const { data } = await admin.from("order_items").select("id,qty").eq("order_id", orderId).single();
  return data as { id: string; qty: number };
}

async function stock(): Promise<number> {
  const { data } = await admin.from("store_items").select("stock_qty").eq("store_id", matola).eq("menu_item_id", itemId).single();
  return data?.stock_qty as number;
}

function retirar(token: string, orderItemId: string, extra: Record<string, unknown> = {}) {
  return admin.rpc("waiter_remove_item", {
    p_token: token,
    p_payload: { requestId: crypto.randomUUID(), orderItemId, qty: 1, reason: "Lançado por engano", ...extra },
  });
}

function cobrar(token: string, tableId: string, total: number, payments: unknown[], extra: Record<string, unknown> = {}) {
  return admin.rpc("waiter_close_bill", {
    p_token: token,
    p_payload: { clientCloseId: crypto.randomUUID(), tableId, expectedTotalCents: total, payments, ...extra },
  });
}

beforeAll(async () => {
  inicio = new Date(Date.now() - 60_000).toISOString();
  admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: lojas } = await admin.from("stores").select("id,slug").in("slug", ["matola", "maputo"]);
  matola = lojas!.find((l) => l.slug === "matola")!.id as string;
  maputo = lojas!.find((l) => l.slug === "maputo")!.id as string;

  const { data: classic } = await admin.from("menu_items").select("id").eq("name", "Classic Smash").single();
  itemId = classic!.id as string;
  const { data: haw } = await admin
    .from("menu_item_variants").select("id,price_cents").eq("menu_item_id", itemId).eq("name", "HAW").single();
  varianteId = haw!.id as string;
  preco = haw!.price_cents as number;

  const { data: s } = await admin
    .from("store_items").select("available,track_stock,stock_qty").eq("store_id", matola).eq("menu_item_id", itemId).single();
  stockAntes = s;
  await admin.from("store_items")
    .update({ available: true, track_stock: true, stock_qty: 500 }).eq("store_id", matola).eq("menu_item_id", itemId);
  const { data: ingredientes } = await admin.from("store_ingredients").select("ingredient_id,qty").eq("store_id", matola);
  ingredientesAntes = (ingredientes ?? []) as Array<{ ingredient_id: string; qty: number }>;
  await admin.from("store_ingredients").update({ qty: 100000 }).eq("store_id", matola);

  numeros = [90, 91, 92, 93, 94];
  const { data: criadas, error } = await admin.from("tables")
    .insert([...numeros.map((number) => ({ store_id: matola, number })), { store_id: maputo, number: 90 }])
    .select("id,store_id,number");
  if (error) throw new Error(`Setup 1127: mesas — ${error.message}`);
  criadasMesas.push(...criadas.map((m) => m.id as string));
  mesas = numeros.map((n) => criadas.find((m) => m.number === n && m.store_id === matola)!.id as string);
  mesaMaputo = criadas.find((m) => m.store_id === maputo)!.id as string;

  gerente = await conta("manager", matola, "mtl");
  gerenteMaputo = await conta("manager", maputo, "mpt");
  caixa = await conta("cashier", matola, "mtl");

  const { data: device } = await admin.from("devices")
    .insert({ store_id: matola, kind: "pos", label: `POS mini ${sufixo}`, device_key_hash: `minipos-${sufixo}` })
    .select("id").single();
  deviceId = device!.id as string;

  ana = await garcom(1, matola, gerente);
  beto = await garcom(2, matola, gerente);
  deMaputo = await garcom(3, maputo, gerenteMaputo);
}, 120_000);

afterAll(async () => {
  if (!admin) return;
  await admin.from("stores").update({ waiter_remove_minutes: 3 }).in("id", [matola, maputo]);
  for (const l of ingredientesAntes) {
    await admin.from("store_ingredients").update({ qty: l.qty }).eq("store_id", matola).eq("ingredient_id", l.ingredient_id);
  }
  if (stockAntes) await admin.from("store_items").update(stockAntes).eq("store_id", matola).eq("menu_item_id", itemId);
  await admin.from("print_jobs").delete().in("order_id", pedidos);
  if (contas.length) await admin.from("print_jobs").delete().in("request_id", contas);
  await admin.from("print_jobs").delete().eq("store_id", matola).is("order_id", null).gte("created_at", inicio);
  await admin.from("stock_movements").delete().in("order_id", pedidos);
  await admin.from("event_log").delete().in("order_id", pedidos);
  await admin.from("payments").delete().in("order_id", pedidos);
  await admin.from("orders").delete().in("id", pedidos);
  if (contas.length) await admin.from("table_bills").delete().in("id", contas);
  const { data: caixas } = await admin.from("cash_sessions").select("id").eq("store_id", matola).gte("opened_at", inicio);
  const ids = (caixas ?? []).map((c) => c.id as string);
  if (ids.length) {
    await admin.from("cash_movements").delete().in("session_id", ids);
    await admin.from("cash_sessions").delete().in("id", ids);
  }
  await admin.from("waiters").delete().in("id", garcons);
  await admin.from("event_log").delete().in("actor_user_id", users);
  await admin.from("event_log").delete().like("type", "waiter.%").gte("created_at", inicio);
  await admin.from("event_log").delete().eq("type", "stock.availability_changed").gte("created_at", inicio);
  await admin.from("tables").delete().in("id", criadasMesas);
  await admin.from("devices").delete().eq("id", deviceId);
  for (const id of users) {
    await admin.from("staff_stores").delete().eq("user_id", id);
    await admin.from("staff_profiles").delete().eq("user_id", id);
    await admin.auth.admin.deleteUser(id);
  }
});

describe("1127 · portas fechadas", () => {
  it("as RPCs novas não abrem à anon nem à sessão da equipa", async () => {
    const chamadas: Array<[string, Record<string, unknown>]> = [
      ["waiter_remove_item", { p_token: "x".repeat(64), p_payload: {} }],
      ["waiter_close_bill", { p_token: "x".repeat(64), p_payload: {} }],
      ["waiter_move_table", { p_token: "x".repeat(64), p_payload: {} }],
      ["waiter_request_bill", { p_token: "x".repeat(64), p_payload: {} }],
      ["waiter_reprint_order", { p_token: "x".repeat(64), p_payload: {} }],
      ["waiter_set_availability", { p_token: "x".repeat(64), p_menu_item_id: crypto.randomUUID(), p_available: false }],
      ["waiter_history", { p_token: "x".repeat(64), p_days: 1 }],
    ];
    for (const [nome, args] of chamadas) {
      expect((await anon.rpc(nome, args)).error, `anon ${nome}`).not.toBeNull();
      expect((await caixa.rpc(nome, args)).error, `caixa ${nome}`).not.toBeNull();
    }
  });

  it("token inventado não faz nada", async () => {
    const { error } = await retirar("f".repeat(64), crypto.randomUUID());
    expect(error?.message).toContain("waiter_session_invalid");
  });
});

describe("1127 · retirar um artigo", () => {
  it("retira do pedido dele: total desce, stock volta, cozinha é avisada, fica registado", async () => {
    const pedido = await lancar(ana.token, mesas[0]);
    const linha = await linhaDe(pedido);
    const antes = await stock();
    const { data, error } = await retirar(ana.token, linha.id);
    expect(error).toBeNull();
    expect(data).toMatchObject({ removed_cents: preco, order_total_cents: preco, duplicate: false });
    expect(await stock()).toBe(antes + 1);

    const { data: papel } = await admin.from("print_jobs").select("payload").eq("order_id", pedido).eq("station", "kitchen");
    expect((papel ?? []).some((p) => p.payload.customer_name === "*** ANULAR ***")).toBe(true);

    const { data: ev } = await admin.from("event_log").select("payload").eq("order_id", pedido).eq("type", "table.item_removed").single();
    expect(ev!.payload.waiter_id).toBe(ana.id);
    expect(ev!.payload.reason).toBe("Lançado por engano");
  });

  it("dois toques retiram um só", async () => {
    const pedido = await lancar(ana.token, mesas[0], 3);
    const linha = await linhaDe(pedido);
    const requestId = crypto.randomUUID();
    await retirar(ana.token, linha.id, { requestId });
    const { data } = await retirar(ana.token, linha.id, { requestId });
    expect(data).toMatchObject({ duplicate: true });
    expect((await linhaDe(pedido)).qty).toBe(2);
  });

  it("sem motivo, ou no pedido de outro garçom, não retira", async () => {
    const pedido = await lancar(ana.token, mesas[0]);
    const linha = await linhaDe(pedido);
    expect((await retirar(ana.token, linha.id, { reason: " " })).error?.message).toContain("reason_required");
    expect((await retirar(beto.token, linha.id)).error?.message).toContain("waiter_order_not_yours");
    expect((await linhaDe(pedido)).qty).toBe(2);
  });

  it("depois do limite da loja já é com o balcão", async () => {
    const pedido = await lancar(ana.token, mesas[0]);
    const linha = await linhaDe(pedido);
    await admin.from("orders").update({ created_at: new Date(Date.now() - 4 * 60_000).toISOString() }).eq("id", pedido);
    expect((await retirar(ana.token, linha.id)).error?.message).toContain("waiter_remove_window_over");

    // O gerente alarga o limite: passa a poder.
    const { error } = await gerente.rpc("set_waiter_remove_minutes", { p_store_id: matola, p_minutes: 10 });
    expect(error).toBeNull();
    expect((await retirar(ana.token, linha.id)).error).toBeNull();

    // Zero desliga.
    await gerente.rpc("set_waiter_remove_minutes", { p_store_id: matola, p_minutes: 0 });
    const outro = await lancar(ana.token, mesas[0]);
    expect((await retirar(ana.token, (await linhaDe(outro)).id)).error?.message).toContain("waiter_remove_window_over");
    await gerente.rpc("set_waiter_remove_minutes", { p_store_id: matola, p_minutes: 3 });
  });

  it("pedido servido já não se retira no telemóvel", async () => {
    const pedido = await lancar(ana.token, mesas[0]);
    await admin.rpc("waiter_serve_order", { p_token: ana.token, p_order_id: pedido });
    expect((await retirar(ana.token, (await linhaDe(pedido)).id)).error?.message).toContain("waiter_remove_window_over");
  });

  it("só o gerente da loja mexe no limite, e dentro de 0 a 30", async () => {
    expect((await caixa.rpc("set_waiter_remove_minutes", { p_store_id: matola, p_minutes: 5 })).error?.message).toContain("waiter_access_denied");
    expect((await gerenteMaputo.rpc("set_waiter_remove_minutes", { p_store_id: matola, p_minutes: 5 })).error?.message).toContain("waiter_access_denied");
    expect((await gerente.rpc("set_waiter_remove_minutes", { p_store_id: matola, p_minutes: 31 })).error?.message).toContain("invalid_remove_minutes");
  });

  it("o caixa continua a retirar no POS como sempre, sem limite", async () => {
    const pedido = await lancar(ana.token, mesas[0]);
    await admin.from("orders").update({ created_at: new Date(Date.now() - 50 * 60_000).toISOString() }).eq("id", pedido);
    const { data, error } = await caixa.rpc("remove_table_item", {
      p_payload: { requestId: crypto.randomUUID(), deviceId, orderItemId: (await linhaDe(pedido)).id, qty: 1, reason: "Cliente desistiu" },
    });
    expect(error).toBeNull();
    expect(data).toMatchObject({ removed_cents: preco, duplicate: false });
  });
});

describe("1127 · cobrar na mesa", () => {
  const metodo = (amountCents: number, method = "mpesa") => [{ method, amountCents }];

  it("sem autorização não cobra", async () => {
    await lancar(beto.token, mesas[1], 1);
    const { error } = await cobrar(beto.token, mesas[1], preco, metodo(preco));
    expect(error?.message).toContain("waiter_charge_denied");
  });

  it("só o gerente da loja autoriza, e o dono vê no registo", async () => {
    expect((await caixa.rpc("set_waiter_can_charge", { p_waiter_id: beto.id, p_can_charge: true })).error?.message).toContain("waiter_access_denied");
    expect((await gerenteMaputo.rpc("set_waiter_can_charge", { p_waiter_id: beto.id, p_can_charge: true })).error?.message).toContain("waiter_access_denied");
    expect((await gerente.rpc("set_waiter_can_charge", { p_waiter_id: beto.id, p_can_charge: true })).error).toBeNull();
    const { data } = await admin.from("event_log").select("payload").eq("type", "waiter.can_charge_set").eq("store_id", matola).order("created_at", { ascending: false }).limit(1).single();
    expect(data!.payload).toMatchObject({ waiter_id: beto.id, can_charge: true });
    const { data: estado } = await admin.rpc("waiter_state", { p_token: beto.token });
    expect(estado.waiter.can_charge).toBe(true);
  });

  it("dinheiro não: nem sozinho nem misturado", async () => {
    expect((await cobrar(beto.token, mesas[1], preco, metodo(preco, "cash"), { cashReceivedCents: preco })).error?.message).toContain("waiter_cash_not_allowed");
    const misto = [{ method: "mpesa", amountCents: preco - 100 }, { method: "cash", amountCents: 100 }];
    expect((await cobrar(beto.token, mesas[1], preco, misto, { cashReceivedCents: 100 })).error?.message).toContain("waiter_cash_not_allowed");
  });

  it("o total tem de ser o que o garçom viu", async () => {
    expect((await cobrar(beto.token, mesas[1], preco + 1, metodo(preco + 1))).error?.message).toContain("table_bill_changed");
  });

  it("fecha a conta como o POS: pagamentos, sem gaveta, talão; repetir não cobra duas vezes", async () => {
    const clientCloseId = crypto.randomUUID();
    const { data, error } = await cobrar(beto.token, mesas[1], preco, metodo(preco, "emola"), { clientCloseId });
    expect(error).toBeNull();
    expect(data).toMatchObject({ total_cents: preco, duplicate: false });
    contas.push(data.bill_id as string);

    const { data: conta } = await gerente.from("table_bills").select("waiter_id,closed_by,device_id,total_cents").eq("id", data.bill_id).single();
    expect(conta).toMatchObject({ waiter_id: beto.id, closed_by: null, device_id: null, total_cents: preco });

    const { data: jobs } = await admin.from("print_jobs").select("kind").eq("request_id", data.bill_id);
    expect((jobs ?? []).map((j) => j.kind)).toEqual(["order"]);

    const { data: outraVez } = await cobrar(beto.token, mesas[1], preco, metodo(preco, "emola"), { clientCloseId });
    expect(outraVez).toMatchObject({ bill_id: data.bill_id, duplicate: true });
    const { count } = await gerente.from("table_bills").select("id", { count: "exact", head: true }).eq("client_close_id", clientCloseId);
    expect(count).toBe(1);

    const { data: pagamentos } = await admin.from("payments").select("method,amount_cents,status").in("order_id", pedidos).eq("idempotency_key", `table:${data.bill_id}:1`);
    expect(pagamentos).toEqual([{ method: "emola", amount_cents: preco, status: "confirmed" }]);
  });

  it("autorização retirada deixa de cobrar", async () => {
    await gerente.rpc("set_waiter_can_charge", { p_waiter_id: beto.id, p_can_charge: false });
    await lancar(beto.token, mesas[1], 1);
    expect((await cobrar(beto.token, mesas[1], preco, metodo(preco))).error?.message).toContain("waiter_charge_denied");
  });

  it("o POS continua a fechar em dinheiro como sempre", async () => {
    const { data, error } = await caixa.rpc("close_table_bill", {
      p_payload: {
        clientCloseId: crypto.randomUUID(), deviceId, tableId: mesas[1], expectedTotalCents: preco,
        payments: [{ method: "cash", amountCents: preco }], cashReceivedCents: preco + 500,
      },
    });
    expect(error).toBeNull();
    expect(data).toMatchObject({ change_cents: 500, duplicate: false });
    contas.push(data.bill_id as string);
    const { data: jobs } = await admin.from("print_jobs").select("kind").eq("request_id", data.bill_id);
    expect((jobs ?? []).map((j) => j.kind).sort()).toEqual(["drawer", "order"]);
  });
});

describe("1127 · mudar de mesa", () => {
  const mover = (token: string, from: string, to: string, requestId = crypto.randomUUID()) =>
    admin.rpc("waiter_move_table", { p_token: token, p_payload: { requestId, fromTableId: from, toTableId: to } });

  it("a conta muda inteira, leva o nome, e a cozinha recebe o aviso", async () => {
    const { data: l } = await admin.rpc("waiter_launch_order", {
      p_token: ana.token,
      p_payload: { clientSaleId: crypto.randomUUID(), tableId: mesas[2], customerName: "Rita", items: [{ menuItemId: itemId, variantId: varianteId, qty: 1 }] },
    });
    pedidos.push(l.order_id as string);

    const requestId = crypto.randomUUID();
    const { data, error } = await mover(ana.token, mesas[2], mesas[3], requestId);
    expect(error).toBeNull();
    expect(data).toMatchObject({ moved_orders: 1, to_table_number: numeros[3], duplicate: false });

    const { data: pedido } = await admin.from("orders").select("table_id,customer_name").eq("id", l.order_id).single();
    expect(pedido).toEqual({ table_id: mesas[3], customer_name: `Mesa ${numeros[3]} · Rita` });

    const { data: papel } = await admin.from("print_jobs").select("payload").eq("order_id", l.order_id).eq("station", "kitchen");
    const aviso = (papel ?? []).find((p) => p.payload.customer_name === "*** MUDOU DE MESA ***");
    expect(aviso?.payload.table_number).toBe(numeros[3]);
    expect(aviso?.payload.notes).toContain(`mesa ${numeros[2]}`);

    const { data: outraVez } = await mover(ana.token, mesas[2], mesas[3], requestId);
    expect(outraVez).toMatchObject({ duplicate: true, moved_orders: 1 });
  });

  it("para uma mesa ocupada, as contas juntam-se e pagam-se juntas", async () => {
    const a = await lancar(ana.token, mesas[2], 1);
    const b = await lancar(ana.token, mesas[4], 1);
    const { error } = await mover(ana.token, mesas[2], mesas[4]);
    expect(error).toBeNull();
    const { data } = await admin.rpc("waiter_state", { p_token: ana.token });
    const destino = (data.tables as Array<{ id: string; orders: Array<{ id: string }> }>).find((t) => t.id === mesas[4])!;
    expect(destino.orders.map((o) => o.id).sort()).toEqual([a, b].sort());
  });

  it("mesa sem conta, a mesma mesa, ou outra loja: recusa", async () => {
    expect((await mover(ana.token, mesas[2], mesas[3])).error?.message).toContain("table_has_no_open_orders");
    expect((await mover(ana.token, mesas[3], mesas[3])).error?.message).toContain("invalid_table");
    expect((await mover(ana.token, mesas[3], mesaMaputo)).error?.message).toContain("invalid_table");
    expect((await mover(deMaputo.token, mesas[3], mesaMaputo)).error?.message).toContain("invalid_table");
  });
});

describe("1127 · papel", () => {
  it("pedir a conta imprime no balcão, com o total, e dois toques imprimem um", async () => {
    const pedido = await lancar(ana.token, mesas[0], 1);
    expect(pedido).toBeTruthy();
    const requestId = crypto.randomUUID();
    const pedir = () => admin.rpc("waiter_request_bill", { p_token: ana.token, p_payload: { requestId, tableId: mesas[0] } });
    const { data, error } = await pedir();
    expect(error).toBeNull();
    expect(data.duplicate).toBe(false);
    await pedir();
    const { data: jobs } = await admin.from("print_jobs").select("station,kind,payload").eq("request_id", requestId);
    expect(jobs).toHaveLength(1);
    expect(jobs![0]).toMatchObject({ station: "counter", kind: "order" });
    expect(jobs![0].payload.customer_name).toBe("*** PEDE A CONTA ***");
    expect(jobs![0].payload.table_number).toBe(numeros[0]);
    expect(jobs![0].payload.items.length).toBeGreaterThan(0);
  });

  it("reimprimir a comanda fica marcado, e dois toques imprimem uma", async () => {
    const pedido = await lancar(ana.token, mesas[0], 1);
    const requestId = crypto.randomUUID();
    const repetir = () => admin.rpc("waiter_reprint_order", { p_token: ana.token, p_payload: { requestId, orderId: pedido } });
    expect((await repetir()).error).toBeNull();
    const { data: dup } = await repetir();
    expect(dup.duplicate).toBe(true);
    const { data: jobs } = await admin.from("print_jobs").select("payload").eq("order_id", pedido).eq("station", "kitchen");
    expect((jobs ?? []).filter((j) => String(j.payload.notes).includes("REIMPRESSÃO"))).toHaveLength(1);
    const { error } = await admin.rpc("waiter_reprint_order", { p_token: deMaputo.token, p_payload: { requestId: crypto.randomUUID(), orderId: pedido } });
    expect(error?.message).toContain("order_not_found");
  });
});

describe("1127 · esgotado", () => {
  it("marca e desmarca na loja dele, com registo, e vê a lista para desfazer", async () => {
    const { data, error } = await admin.rpc("waiter_set_availability", { p_token: ana.token, p_menu_item_id: itemId, p_available: false });
    expect(error).toBeNull();
    expect(data).toMatchObject({ available: false, changed: true });

    const { data: menu } = await admin.rpc("waiter_menu", { p_token: ana.token });
    expect((menu.unavailable as Array<{ id: string }>).some((i) => i.id === itemId)).toBe(true);

    const { data: ev } = await admin.from("event_log").select("payload").eq("type", "stock.availability_changed").eq("store_id", matola).order("created_at", { ascending: false }).limit(1).single();
    expect(ev!.payload).toMatchObject({ waiter_id: ana.id, role: "waiter", available: false });

    await admin.rpc("waiter_set_availability", { p_token: ana.token, p_menu_item_id: itemId, p_available: true });
    const { data: menu2 } = await admin.rpc("waiter_menu", { p_token: ana.token });
    expect((menu2.unavailable as Array<{ id: string }>).some((i) => i.id === itemId)).toBe(false);

    // O da loja dele não mexe na outra.
    const { data: maputoAntes } = await admin.from("store_items").select("available").eq("store_id", maputo).eq("menu_item_id", itemId).single();
    await admin.rpc("waiter_set_availability", { p_token: ana.token, p_menu_item_id: itemId, p_available: false });
    const { data: maputoDepois } = await admin.from("store_items").select("available").eq("store_id", maputo).eq("menu_item_id", itemId).single();
    expect(maputoDepois).toEqual(maputoAntes);
    await admin.rpc("waiter_set_availability", { p_token: ana.token, p_menu_item_id: itemId, p_available: true });
  });
});

describe("1127 · histórico", () => {
  it("o garçom vê os pedidos dele, com retirados e motivo; nunca os de outro", async () => {
    const { data, error } = await admin.rpc("waiter_history", { p_token: ana.token, p_days: 7 });
    expect(error).toBeNull();
    const ids = (data.orders as Array<{ id: string; waiter_name: string }>).map((o) => o.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(data.summary.orders).toBeGreaterThan(0);
    const { data: linhas } = await admin.from("orders").select("id").eq("waiter_id", beto.id);
    for (const l of linhas ?? []) expect(ids).not.toContain(l.id);
    const comRetirada = (data.orders as Array<{ removed: Array<{ reason: string }> }>).find((o) => o.removed.length > 0);
    expect(comRetirada?.removed[0].reason).toBe("Lançado por engano");
  });

  it("o gerente vê o histórico no painel, com paginação; o caixa e outra loja não", async () => {
    const args = { p_store_id: matola, p_waiter_id: ana.id, p_from: inicio, p_to: new Date(Date.now() + 3_600_000).toISOString(), p_limit: 2, p_offset: 0 };
    const { data, error } = await gerente.rpc("get_waiter_orders", args);
    expect(error).toBeNull();
    expect(data.orders).toHaveLength(2);
    expect(data.total).toBeGreaterThan(2);
    const { data: seguinte } = await gerente.rpc("get_waiter_orders", { ...args, p_offset: 2 });
    expect(seguinte.orders[0].id).not.toBe(data.orders[0].id);

    expect((await caixa.rpc("get_waiter_orders", args)).error?.message).toContain("waiter_access_denied");
    expect((await gerenteMaputo.rpc("get_waiter_orders", args)).error?.message).toContain("waiter_access_denied");
    const { data: alheio } = await gerenteMaputo.rpc("get_waiter_orders", { ...args, p_store_id: maputo });
    expect(alheio.orders).toEqual([]);
  });

  it("no histórico vê-se quem cobrou a conta", async () => {
    const { data } = await gerente.rpc("get_waiter_orders", {
      p_store_id: matola, p_waiter_id: beto.id, p_from: inicio, p_to: new Date(Date.now() + 3_600_000).toISOString(), p_limit: 50, p_offset: 0,
    });
    const cobrados = (data.orders as Array<{ paid: boolean; charged_by_waiter: string | null }>).filter((o) => o.paid);
    expect(cobrados.some((o) => o.charged_by_waiter === "Garçom 2")).toBe(true);
  });
});
