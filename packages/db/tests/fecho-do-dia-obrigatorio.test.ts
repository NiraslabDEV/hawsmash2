/**
 * Gate da 1128 — o dia só muda com o fecho do dia, e o caixa não fecha com mesa aberta.
 *
 * Pedido da loja (Nov/2026): a caixa fechou o segundo turno, esqueceu-se do
 * fecho do dia e, na manhã seguinte, abriu outro turno por cima. O que tem de
 * ser verdade contra um Supabase a sério:
 *
 *  - turno e dia recusam fechar com mesa por pagar, dizendo quais;
 *  - o turno novo de outro dia é recusado enquanto o dia anterior não fechar;
 *  - a venda nunca pára (Regra 1): o auto-open continua a funcionar;
 *  - a conta da mesa atravessa a meia-noite até ao fecho do dia, e o que ficou
 *    para trás do corte da migration não reaparece a bloquear o caixa;
 *  - uma loja não trava a outra (Regra 3).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://localhost:54731";
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz";

const sufixo = `${Date.now()}`;
const PASSWORD = "Fecho-1128-Teste-2026!";
const MESA = 93;
const UM_DIA = 24 * 60 * 60 * 1000;

let admin: SupabaseClient;
let caixa: SupabaseClient;
let caixaMaputo: SupabaseClient;
let matola: string;
let maputo: string;
let deviceId: string;
let mesaId: string;
let mesaMaputoId: string;
let classicId: string;
let hawId: string;
let precoHaw: number;
let corteAntes: Record<string, string> = {};
let stockAntes: { available: boolean; track_stock: boolean; stock_qty: number } | null = null;
let ingredientesAntes: Array<{ ingredient_id: string; qty: number }> = [];

const criadosUsers: string[] = [];
const criadosPedidos: string[] = [];
const criadasMesas: string[] = [];

/** Esta suite apaga o caixa das duas lojas: só numa base descartável. */
const BASE_LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(SUPABASE_URL);

const ontem = () => new Date(Date.now() - UM_DIA).toISOString();

async function limparCaixa() {
  if (!BASE_LOCAL && process.env.ALLOW_CASH_WIPE !== "1") {
    throw new Error(`fecho-do-dia-obrigatorio.test.ts apaga o caixa e recusa correr contra ${SUPABASE_URL}.`);
  }
  await admin.from("print_jobs").delete().eq("kind", "cash_close").in("store_id", [matola, maputo]);
  await admin.from("cash_movements").delete().in("store_id", [matola, maputo]);
  await admin.from("cash_sessions").delete().in("store_id", [matola, maputo]);
  await admin.from("cash_day_closes").delete().in("store_id", [matola, maputo]);
}

/** Tira do caminho as contas deixadas por testes anteriores desta suite. */
async function limparMesas() {
  if (criadosPedidos.length === 0) return;
  await admin
    .from("orders")
    .update({ status: "cancelled" })
    .in("id", criadosPedidos)
    .is("table_bill_id", null);
}

async function novoCaixa(loja: string, nome: string): Promise<SupabaseClient> {
  const email = `fecho-${nome}-${sufixo}@delivery.test`;
  const { data: user, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error || !user.user) throw new Error(`Setup 1128: conta — ${error?.message}`);
  criadosUsers.push(user.user.id);
  await admin.from("staff_profiles").insert({ user_id: user.user.id, full_name: `Caixa ${nome}`, role: "cashier", active: true });
  await admin.from("staff_stores").insert({ user_id: user.user.id, store_id: loja });
  const cliente = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: loginError } = await cliente.auth.signInWithPassword({ email, password: PASSWORD });
  if (loginError) throw new Error(`Setup 1128: sessão — ${loginError.message}`);
  return cliente;
}

async function lancarNaMesa(tableId = mesaId) {
  const { data, error } = await caixa.rpc("launch_table_order", {
    p_payload: {
      clientSaleId: crypto.randomUUID(),
      deviceId,
      tableId,
      items: [{ menuItemId: classicId, qty: 1, variantId: hawId }],
    },
  });
  if (error) throw new Error(`launch_table_order — ${error.message}`);
  criadosPedidos.push(data.order_id as string);
  return data.order_id as string;
}

async function pagarAMesa() {
  const { data: visao } = await caixa.rpc("pos_table_overview", { p_device_id: deviceId });
  const mesa = (visao.tables as Array<{ id: string; orders: Array<{ total_cents: number }> }>).find((m) => m.id === mesaId)!;
  const total = mesa.orders.reduce((soma, o) => soma + o.total_cents, 0);
  const { error } = await caixa.rpc("close_table_bill", {
    p_payload: {
      clientCloseId: crypto.randomUUID(),
      deviceId,
      tableId: mesaId,
      expectedTotalCents: total,
      payments: [{ method: "mpesa", amountCents: total }],
    },
  });
  if (error) throw new Error(`close_table_bill — ${error.message}`);
}

async function abrirTurno() {
  const { data, error } = await caixa.rpc("open_cash_session", { p_store: matola, p_float: 0 });
  if (error) throw new Error(`open_cash_session — ${error.message}`);
  return data as string;
}

const fecharTurno = () => caixa.rpc("close_cash_session", { p_store: matola, p_counted: 0, p_reason: null });
const fecharDia = () => caixa.rpc("close_cash_day", { p_store: matola, p_request_id: crypto.randomUUID() });
const lerDia = () => caixa.rpc("get_cash_day", { p_store: matola });

/** Um turno fechado que abriu ontem: a noite em que a caixa se esqueceu do dia. */
async function turnoFechadoOntem() {
  const id = await abrirTurno();
  const { error } = await fecharTurno();
  if (error) throw new Error(`close_cash_session — ${error.message}`);
  await admin.from("cash_sessions").update({ opened_at: ontem() }).eq("id", id);
  return id;
}

beforeAll(async () => {
  admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: lojas } = await admin.from("stores").select("id,slug,tabs_carry_from").in("slug", ["matola", "maputo"]);
  matola = lojas!.find((l) => l.slug === "matola")!.id as string;
  maputo = lojas!.find((l) => l.slug === "maputo")!.id as string;
  corteAntes = Object.fromEntries(lojas!.map((l) => [l.id as string, l.tabs_carry_from as string]));

  const { data: classic } = await admin.from("menu_items").select("id").eq("name", "Classic Smash").single();
  classicId = classic!.id as string;
  const { data: haw } = await admin
    .from("menu_item_variants")
    .select("id,price_cents")
    .eq("menu_item_id", classicId)
    .eq("name", "HAW")
    .single();
  hawId = haw!.id as string;
  precoHaw = haw!.price_cents as number;

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

  const { data: mesas, error: mesasError } = await admin
    .from("tables")
    .insert([
      { store_id: matola, number: MESA },
      { store_id: maputo, number: MESA },
    ])
    .select("id,store_id");
  if (mesasError || !mesas) throw new Error(`Setup 1128: mesas — ${mesasError?.message}`);
  criadasMesas.push(...mesas.map((m) => m.id as string));
  mesaId = mesas.find((m) => m.store_id === matola)!.id as string;
  mesaMaputoId = mesas.find((m) => m.store_id === maputo)!.id as string;

  caixa = await novoCaixa(matola, "matola");
  caixaMaputo = await novoCaixa(maputo, "maputo");

  const { data: device, error: deviceError } = await admin
    .from("devices")
    .insert({ store_id: matola, kind: "pos", label: `POS fecho ${sufixo}`, device_key_hash: `fecho-${sufixo}` })
    .select("id")
    .single();
  if (deviceError || !device) throw new Error(`Setup 1128: terminal — ${deviceError?.message}`);
  deviceId = device.id as string;
}, 90_000);

beforeEach(async () => {
  await limparMesas();
  await limparCaixa();
  await admin.from("settings").update({ cash_diff_tolerance_cents: 1000 }).eq("id", 1);
});

afterAll(async () => {
  if (!admin) return;
  await limparCaixa();
  for (const [id, corte] of Object.entries(corteAntes)) {
    await admin.from("stores").update({ tabs_carry_from: corte }).eq("id", id);
  }
  for (const linha of ingredientesAntes) {
    await admin.from("store_ingredients").update({ qty: linha.qty }).eq("store_id", matola).eq("ingredient_id", linha.ingredient_id);
  }
  if (stockAntes) {
    await admin.from("store_items").update(stockAntes).eq("store_id", matola).eq("menu_item_id", classicId);
  }
  if (criadosPedidos.length > 0) {
    const { data: contas } = await admin.from("orders").select("table_bill_id").in("id", criadosPedidos);
    const idsContas = [...new Set((contas ?? []).map((c) => c.table_bill_id as string | null).filter(Boolean))] as string[];
    await admin.from("print_jobs").delete().in("order_id", criadosPedidos);
    if (idsContas.length > 0) await admin.from("print_jobs").delete().in("request_id", idsContas);
    await admin.from("stock_movements").delete().in("order_id", criadosPedidos);
    await admin.from("event_log").delete().in("order_id", criadosPedidos);
    await admin.from("orders").delete().in("id", criadosPedidos);
    if (idsContas.length > 0) await admin.from("table_bills").delete().in("id", idsContas);
  }
  await admin.from("event_log").delete().in("actor_user_id", criadosUsers);
  if (criadasMesas.length > 0) await admin.from("tables").delete().in("id", criadasMesas);
  if (deviceId) await admin.from("devices").delete().eq("id", deviceId);
  for (const id of criadosUsers) {
    await admin.from("staff_stores").delete().eq("user_id", id);
    await admin.from("staff_profiles").delete().eq("user_id", id);
    await admin.auth.admin.deleteUser(id);
  }
});

describe("1128 · o caixa não fecha com mesa aberta", () => {
  it("o turno recusa fechar e diz que mesas faltam; paga a mesa, fecha", async () => {
    await abrirTurno();
    await lancarNaMesa();

    const recusado = await fecharTurno();
    expect(recusado.error?.message).toBe(`tables_open:${MESA}`);

    await pagarAMesa();
    const { data, error } = await fecharTurno();
    expect(error).toBeNull();
    // A mesa paga neste turno conta neste turno: é o que o bloqueio garante.
    expect(data.payments.mpesa).toBe(precoHaw);
  });

  it("o dia recusa fechar se uma mesa abriu depois do último turno", async () => {
    await abrirTurno();
    expect((await fecharTurno()).error).toBeNull();
    await lancarNaMesa();

    const recusado = await fecharDia();
    expect(recusado.error?.message).toBe(`tables_open:${MESA}`);
    const { count } = await admin.from("cash_day_closes").select("id", { count: "exact", head: true }).eq("store_id", matola);
    expect(count).toBe(0);
  });

  it("repetir um fecho do dia já feito devolve o mesmo, mesmo com mesa nova (Regra 4)", async () => {
    await abrirTurno();
    expect((await fecharTurno()).error).toBeNull();
    const chave = crypto.randomUUID();
    const feito = await caixa.rpc("close_cash_day", { p_store: matola, p_request_id: chave });
    expect(feito.error).toBeNull();

    await lancarNaMesa();
    const repetido = await caixa.rpc("close_cash_day", { p_store: matola, p_request_id: chave });
    expect(repetido.error).toBeNull();
    expect(repetido.data.duplicate).toBe(true);
  });

  it("uma mesa aberta na Matola não trava Maputo (Regra 3)", async () => {
    await lancarNaMesa();
    const { error: abrir } = await caixaMaputo.rpc("open_cash_session", { p_store: maputo, p_float: 0 });
    expect(abrir).toBeNull();
    const { error } = await caixaMaputo.rpc("close_cash_session", { p_store: maputo, p_counted: 0, p_reason: null });
    expect(error).toBeNull();
  });

  it("uma conta a zero, que não se pode cobrar, não prende o caixa", async () => {
    await abrirTurno();
    const id = await lancarNaMesa();
    await admin.from("orders").update({ subtotal_cents: 0, total_cents: 0 }).eq("id", id);
    const { error } = await fecharTurno();
    expect(error).toBeNull();
  });

  it("o get_cash_day diz que mesas estão abertas, com o total", async () => {
    await lancarNaMesa();
    await lancarNaMesa();
    const { data, error } = await lerDia();
    expect(error).toBeNull();
    expect(data.open_tables).toEqual([{ number: MESA, total_cents: 2 * precoHaw }]);
  });
});

describe("1128 · o dia só muda com o fecho do dia", () => {
  it("não abre turno novo por cima de um dia por fechar; fechado o dia, abre", async () => {
    await turnoFechadoOntem();

    const recusado = await caixa.rpc("open_cash_session", { p_store: matola, p_float: 0 });
    expect(recusado.error?.message).toBe("day_close_required");

    expect((await fecharDia()).error).toBeNull();
    const aberto = await caixa.rpc("open_cash_session", { p_store: matola, p_float: 0 });
    expect(aberto.error).toBeNull();
  });

  it("a troca de turno no mesmo dia continua a funcionar", async () => {
    await abrirTurno();
    expect((await fecharTurno()).error).toBeNull();
    const seguinte = await caixa.rpc("open_cash_session", { p_store: matola, p_float: 0 });
    expect(seguinte.error).toBeNull();
  });

  it("a venda nunca pára: com o dia por fechar, o auto-open continua (Regra 1)", async () => {
    await turnoFechadoOntem();
    const { data, error } = await caixa.rpc("create_counter_sale", {
      p_payload: {
        clientSaleId: crypto.randomUUID(),
        deviceId,
        items: [{ menuItemId: classicId, qty: 1, variantId: hawId }],
        payments: [{ method: "cash", amountCents: precoHaw }],
        cashReceivedCents: precoHaw,
      },
    });
    expect(error).toBeNull();
    criadosPedidos.push(data.order_id as string);

    const { data: abertos } = await admin
      .from("cash_sessions")
      .select("id")
      .eq("store_id", matola)
      .is("closed_at", null);
    expect(abertos).toHaveLength(1);

    // O turno que a venda abriu trava o fecho do dia até se contar a gaveta.
    expect((await fecharDia()).error?.message).toBe("session_open");
  });

  it("a conta da mesa de ontem paga-se de manhã, com o dia por fechar", async () => {
    await turnoFechadoOntem();
    await lancarNaMesa();
    await pagarAMesa();
    const { data: abertos } = await admin
      .from("cash_sessions")
      .select("id")
      .eq("store_id", matola)
      .is("closed_at", null);
    expect(abertos).toHaveLength(1);
  });

  it("o dia de trabalho fica na data do primeiro turno e diz-se atrasado", async () => {
    const id = await turnoFechadoOntem();
    const { data: turno } = await admin.from("cash_sessions").select("opened_at").eq("id", id).single();
    const dataMaputo = new Date(turno!.opened_at as string).toLocaleDateString("en-CA", { timeZone: "Africa/Maputo" });

    const { data } = await lerDia();
    expect(data.business_date).toBe(dataMaputo);
    expect(data.day_overdue).toBe(true);

    expect((await fecharDia()).error).toBeNull();
    const depois = await lerDia();
    expect(depois.data.day_overdue).toBe(false);
    expect(depois.data.business_date).toBe(
      new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Maputo" }),
    );
  });

  it("um turno aberto desde ontem só se diz esquecido a partir das 06:00", async () => {
    const id = await abrirTurno();
    await admin.from("cash_sessions").update({ opened_at: ontem() }).eq("id", id);
    const horaMaputo = Number(
      new Date().toLocaleTimeString("en-GB", { timeZone: "Africa/Maputo", hour: "2-digit", hour12: false }),
    );
    const { data } = await lerDia();
    expect(data.day_overdue).toBe(horaMaputo >= 6);
  });

  it("um turno de hoje, por fechar ou fechado, não está atrasado", async () => {
    await abrirTurno();
    expect((await lerDia()).data.day_overdue).toBe(false);
    expect((await fecharTurno()).error).toBeNull();
    expect((await lerDia()).data.day_overdue).toBe(false);
  });
});

describe("1128 · a conta da mesa vive até ao fecho do dia", () => {
  it("o pedido de ontem por pagar continua na conta depois da meia-noite", async () => {
    await admin.from("stores").update({ tabs_carry_from: new Date(Date.now() - 3 * UM_DIA).toISOString() }).eq("id", matola);
    const id = await lancarNaMesa();
    await admin.from("orders").update({ created_at: ontem() }).eq("id", id);

    const { data: visao } = await caixa.rpc("pos_table_overview", { p_device_id: deviceId });
    const mesa = (visao.tables as Array<{ id: string; orders: Array<{ id: string }> }>).find((m) => m.id === mesaId)!;
    expect(mesa.orders.map((o) => o.id)).toEqual([id]);

    await abrirTurno();
    expect((await fecharTurno()).error?.message).toBe(`tables_open:${MESA}`);
  });

  it("o que ficou antes do corte da migration não reaparece nem prende o caixa", async () => {
    await admin.from("stores").update({ tabs_carry_from: new Date().toISOString() }).eq("id", matola);
    const id = await lancarNaMesa();
    await admin.from("orders").update({ created_at: ontem() }).eq("id", id);

    const { data: visao } = await caixa.rpc("pos_table_overview", { p_device_id: deviceId });
    const mesa = (visao.tables as Array<{ id: string; orders: unknown[] }>).find((m) => m.id === mesaId)!;
    expect(mesa.orders).toHaveLength(0);

    await abrirTurno();
    expect((await fecharTurno()).error).toBeNull();
  });

  it("depois do fecho do dia, a conta começa do zero", async () => {
    await admin.from("stores").update({ tabs_carry_from: new Date(Date.now() - 3 * UM_DIA).toISOString() }).eq("id", matola);
    const id = await lancarNaMesa();
    await admin.from("orders").update({ created_at: new Date(Date.now() - 2 * UM_DIA).toISOString() }).eq("id", id);

    // Um fecho do dia posterior ao pedido: o corte passa a ser esse fecho.
    await admin.from("cash_day_closes").insert({
      store_id: matola,
      business_date: new Date(Date.now() - UM_DIA).toISOString().slice(0, 10),
      request_id: crypto.randomUUID(),
      closed_at: ontem(),
      report: {},
    });

    const { data: visao } = await caixa.rpc("pos_table_overview", { p_device_id: deviceId });
    const mesa = (visao.tables as Array<{ id: string; orders: unknown[] }>).find((m) => m.id === mesaId)!;
    expect(mesa.orders).toHaveLength(0);
  });

  it("uma mesa de Maputo fica fora do que a Matola vê", async () => {
    await lancarNaMesa();
    const { data } = await lerDia();
    expect((data.open_tables as unknown[]).length).toBe(1);
    expect(mesaMaputoId).not.toBe(mesaId);
    const { error } = await caixaMaputo.rpc("get_cash_day", { p_store: matola });
    expect(error?.message).toContain("store_access_denied");
  });
});
