/**
 * Gate da 1081: mesas por loja, pedido lançado na mesa e a conta da mesa.
 *
 * Pedido do dono (24 Set): quem está na mesa 2 pede pelo QR ou ao balcão, vai
 * tudo para a mesma mesa, e a mesa paga no fim, tudo junto. Aqui prova-se o
 * dinheiro (preço da loja, contas que não cobram duas vezes nem cobram o que o
 * caixa não viu), o papel (comanda da mesa, talão da conta, gaveta) e a Regra 3
 * (a mesa é de uma loja).
 *
 * Corre na Matola pela razão do comanda-padrao: vender e fechar contas põem
 * papel na fila, e nenhuma impressora a sério o pode imprimir.
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

type Mesa = {
  id: string;
  number: number;
  active: boolean;
  orders: Array<{
    id: string;
    origin: "qr" | "pos";
    status: string;
    total_cents: number;
    customer_name: string;
    items: Array<{ name: string; variant: string | null; qty: number }>;
  }>;
};

let admin: SupabaseClient;
let anon: SupabaseClient;
let caixa: SupabaseClient;
let caixaMaputo: SupabaseClient;
let matolaStoreId: string;
let maputoStoreId: string;
let deviceId: string;
let classicId: string;
let hawId: string;
let wagyuId: string;
let precoHaw: number;
let precoWagyu: number;
let mesaId: string;
let mesaToken: string;
let mesaMaputoId: string;
let inicio: string;
let stockAntes: { available: boolean; track_stock: boolean; stock_qty: number } | null = null;
let dineInAntes: boolean | null = null;
let ingredientesAntes: Array<{ ingredient_id: string; qty: number }> = [];

const MESA = 97;
const sufixo = `${Date.now()}`;
const PASSWORD = "Mesas-1081-Teste-2026!";
const criadosUsers: string[] = [];
const criadosPedidos: string[] = [];
const criadasContas: string[] = [];
const criadasMesas: string[] = [];

function lancar(items: unknown[], clientSaleId = crypto.randomUUID(), tableId = mesaId) {
  return caixa.rpc("launch_table_order", {
    p_payload: { clientSaleId, deviceId, tableId, items },
  });
}

async function mesaNoPos(): Promise<Mesa | undefined> {
  const { data, error } = await caixa.rpc("pos_table_overview", { p_device_id: deviceId });
  if (error) throw new Error(`pos_table_overview — ${error.message}`);
  return (data.tables as Mesa[]).find((mesa) => mesa.id === mesaId);
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

async function novoCaixa(loja: string, nome: string): Promise<SupabaseClient> {
  const email = `mesas-${nome}-${sufixo}@delivery.test`;
  const { data: user } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  criadosUsers.push(user.user!.id);
  await admin
    .from("staff_profiles")
    .insert({ user_id: user.user!.id, full_name: `Caixa ${nome}`, role: "cashier", active: true });
  await admin.from("staff_stores").insert({ user_id: user.user!.id, store_id: loja });
  const cliente = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await cliente.auth.signInWithPassword({ email, password: PASSWORD });
  return cliente;
}

beforeAll(async () => {
  inicio = new Date(Date.now() - 60_000).toISOString();
  admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  anon = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: lojas } = await admin.from("stores").select("id,slug").in("slug", ["matola", "maputo"]);
  matolaStoreId = lojas!.find((l) => l.slug === "matola")!.id as string;
  maputoStoreId = lojas!.find((l) => l.slug === "maputo")!.id as string;

  const { data: classic } = await admin
    .from("menu_items")
    .select("id,available_dine_in")
    .eq("name", "Classic Smash")
    .single();
  if (!classic) throw new Error("Setup mesas: Classic Smash não encontrado");
  classicId = classic.id as string;
  dineInAntes = classic.available_dine_in as boolean;
  // O QR só vende o que está marcado para a mesa.
  await admin.from("menu_items").update({ available_dine_in: true }).eq("id", classicId);

  const { data: variantes } = await admin
    .from("menu_item_variants")
    .select("id,name,price_cents")
    .eq("menu_item_id", classicId);
  const haw = variantes?.find((v) => v.name === "HAW");
  const wagyu = variantes?.find((v) => v.name === "WAGYU");
  if (!haw || !wagyu) throw new Error("Setup mesas: faltam as variantes HAW/WAGYU do Classic");
  hawId = haw.id as string;
  precoHaw = haw.price_cents as number;
  wagyuId = wagyu.id as string;
  precoWagyu = wagyu.price_cents as number;

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

  const { data: ingredientes } = await admin
    .from("store_ingredients")
    .select("ingredient_id,qty")
    .eq("store_id", matolaStoreId);
  ingredientesAntes = (ingredientes ?? []) as Array<{ ingredient_id: string; qty: number }>;
  await admin.from("store_ingredients").update({ qty: 100000 }).eq("store_id", matolaStoreId);

  const { data: mesas, error: mesasError } = await admin
    .from("tables")
    .insert([
      { store_id: matolaStoreId, number: MESA },
      { store_id: maputoStoreId, number: MESA },
    ])
    .select("id,store_id,token");
  if (mesasError || !mesas) throw new Error(`Setup mesas: mesas — ${mesasError?.message}`);
  criadasMesas.push(...mesas.map((m) => m.id as string));
  const daMatola = mesas.find((m) => m.store_id === matolaStoreId)!;
  mesaId = daMatola.id as string;
  mesaToken = daMatola.token as string;
  mesaMaputoId = mesas.find((m) => m.store_id === maputoStoreId)!.id as string;

  caixa = await novoCaixa(matolaStoreId, "matola");
  caixaMaputo = await novoCaixa(maputoStoreId, "maputo");

  const { data: device, error: deviceError } = await admin
    .from("devices")
    .insert({
      store_id: matolaStoreId,
      kind: "pos",
      label: `POS mesas ${sufixo}`,
      device_key_hash: `mesas-${sufixo}`,
    })
    .select("id")
    .single();
  if (deviceError || !device) throw new Error(`Setup mesas: terminal — ${deviceError?.message}`);
  deviceId = device.id as string;
}, 90_000);

afterAll(async () => {
  if (!admin) return;
  if (dineInAntes !== null) {
    await admin.from("menu_items").update({ available_dine_in: dineInAntes }).eq("id", classicId);
  }
  for (const linha of ingredientesAntes) {
    await admin
      .from("store_ingredients")
      .update({ qty: linha.qty })
      .eq("store_id", matolaStoreId)
      .eq("ingredient_id", linha.ingredient_id);
  }
  if (stockAntes) {
    await admin
      .from("store_items")
      .update(stockAntes)
      .eq("store_id", matolaStoreId)
      .eq("menu_item_id", classicId);
  }
  if (criadasContas.length > 0) {
    await admin.from("print_jobs").delete().in("request_id", criadasContas);
  }
  if (criadosPedidos.length > 0) {
    await admin.from("stock_movements").delete().in("order_id", criadosPedidos);
    await admin.from("event_log").delete().in("order_id", criadosPedidos);
    await admin.from("orders").delete().in("id", criadosPedidos);
  }
  if (criadasContas.length > 0) {
    await admin.from("table_bills").delete().in("id", criadasContas);
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
  if (criadasMesas.length > 0) await admin.from("tables").delete().in("id", criadasMesas);
  if (deviceId) await admin.from("devices").delete().eq("id", deviceId);
  for (const id of criadosUsers) {
    await admin.from("staff_stores").delete().eq("user_id", id);
    await admin.from("staff_profiles").delete().eq("user_id", id);
    await admin.auth.admin.deleteUser(id);
  }
});

describe("1081 · a mesa é de uma loja", () => {
  it("o QR diz a loja da mesa, e o anon não lê a tabela", async () => {
    const { data, error } = await anon.rpc("get_table_by_token", { p_token: mesaToken });
    expect(error).toBeNull();
    expect(data).toMatchObject({ id: mesaId, number: MESA, store_slug: "matola" });

    const { data: linhas } = await anon.from("tables").select("id").eq("id", mesaId);
    expect(linhas ?? []).toHaveLength(0);
  });

  it("o mesmo número pode existir noutra loja, mas não duas vezes na mesma", async () => {
    const { error } = await admin.from("tables").insert({ store_id: matolaStoreId, number: MESA });
    expect(error?.code).toBe("23505");
  });

  it("o POS não lança numa mesa de outra loja", async () => {
    const venda = await lancar([{ menuItemId: classicId, qty: 1 }], crypto.randomUUID(), mesaMaputoId);
    expect(venda.error?.message).toContain("invalid_table");
  });

  it("um caixa de Maputo não usa o terminal da Matola", async () => {
    const { error } = await caixaMaputo.rpc("launch_table_order", {
      p_payload: {
        clientSaleId: crypto.randomUUID(),
        deviceId,
        tableId: mesaId,
        items: [{ menuItemId: classicId, qty: 1 }],
      },
    });
    expect(error?.message).toContain("invalid_or_unauthorised_device");
  });
});

describe("1081 · a conta da mesa", () => {
  let lancadoId: string;
  let qrId: string;
  let totalQr: number;
  let totalDaMesa: number;

  it("o balcão lança na mesa: vai para a cozinha por pagar, a preço da loja", async () => {
    const clientSaleId = crypto.randomUUID();
    const { data, error } = await lancar(
      [
        { menuItemId: classicId, qty: 2, variantId: hawId, notes: "Sem cebola" },
        { menuItemId: classicId, qty: 1, variantId: wagyuId },
      ],
      clientSaleId,
    );
    expect(error).toBeNull();
    lancadoId = data.order_id as string;
    criadosPedidos.push(lancadoId);
    expect(data).toMatchObject({ table_number: MESA, total_cents: 2 * precoHaw + precoWagyu });

    const { data: pedido } = await admin
      .from("orders")
      .select("status,fulfillment_type,channel,payment_method,customer_name,table_id,order_number")
      .eq("id", lancadoId)
      .single();
    expect(pedido).toMatchObject({
      status: "in_preparation",
      fulfillment_type: "dine_in",
      channel: "dine_in",
      payment_method: "no_payment",
      customer_name: `Mesa ${MESA}`,
      table_id: mesaId,
    });

    const { count: pagamentos } = await admin
      .from("payments")
      .select("id", { count: "exact", head: true })
      .eq("order_id", lancadoId);
    expect(pagamentos).toBe(0);

    // Stock do produto: as três carnes saem já, na mesma transacção.
    expect(await stockDoClassic()).toBe(47);

    // A comanda da mesa: formato herdado, MESA e o número da loja.
    const { data: comandas } = await admin
      .from("print_jobs")
      .select("station,payload")
      .eq("order_id", lancadoId)
      .eq("kind", "order");
    expect(comandas).toHaveLength(1);
    expect(comandas![0]).toMatchObject({
      station: "kitchen",
      payload: {
        fulfillment_type: "dine_in",
        table_number: MESA,
        order_number: pedido!.order_number,
        payment_method: "no_payment",
      },
    });
    expect(comandas![0].payload.template).toBeUndefined();

    // Repetir o lançamento devolve o mesmo pedido (Regra 4).
    const repetido = await lancar([{ menuItemId: classicId, qty: 9 }], clientSaleId);
    expect(repetido.error).toBeNull();
    expect(repetido.data).toMatchObject({ order_id: lancadoId, duplicate: true });
  });

  it("o pedido pelo QR cai na mesma mesa, com o número da loja e stock descontado", async () => {
    const { data, error } = await anon.rpc("create_order", {
      p_store_slug: "matola",
      p_payload: {
        fulfillmentType: "dine_in",
        tableId: mesaId,
        customerName: "Ana",
        items: [{ menuItemId: classicId, qty: 1 }],
      },
    });
    expect(error).toBeNull();
    qrId = data as string;
    criadosPedidos.push(qrId);

    const { data: pedido } = await admin
      .from("orders")
      .select("customer_name,channel,order_number,status,table_id,total_cents")
      .eq("id", qrId)
      .single();
    expect(pedido).toMatchObject({
      customer_name: `Mesa ${MESA} · Ana`,
      channel: "dine_in",
      status: "in_preparation",
      table_id: mesaId,
    });
    expect(pedido!.order_number).not.toMatch(/^ENC-/);
    totalQr = pedido!.total_cents as number;
    expect(await stockDoClassic()).toBe(46);

    const { data: comandas } = await admin
      .from("print_jobs")
      .select("payload")
      .eq("order_id", qrId)
      .eq("kind", "order");
    expect(comandas).toHaveLength(1);
    expect(comandas![0].payload).toMatchObject({
      order_number: pedido!.order_number,
      table_number: MESA,
    });
  });

  it("um QR de uma mesa de Maputo não entra como pedido da Matola", async () => {
    const { error } = await anon.rpc("create_order", {
      p_store_slug: "matola",
      p_payload: {
        fulfillmentType: "dine_in",
        tableId: mesaMaputoId,
        items: [{ menuItemId: classicId, qty: 1 }],
      },
    });
    expect(error?.message).toContain("invalid_table");
  });

  it("a aba Mesas mostra a conta: os dois pedidos, do QR e do balcão", async () => {
    const mesa = await mesaNoPos();
    expect(mesa?.orders.map((o) => o.origin).sort()).toEqual(["pos", "qr"]);
    totalDaMesa = mesa!.orders.reduce((soma, o) => soma + o.total_cents, 0);
    expect(totalDaMesa).toBe(2 * precoHaw + precoWagyu + totalQr);
  });

  it("a conta não fecha pelo total antigo se entrou um pedido entretanto", async () => {
    const novo = await lancar([{ menuItemId: classicId, qty: 1, variantId: hawId }]);
    expect(novo.error).toBeNull();
    criadosPedidos.push(novo.data.order_id as string);

    const { error } = await caixa.rpc("close_table_bill", {
      p_payload: {
        clientCloseId: crypto.randomUUID(),
        deviceId,
        tableId: mesaId,
        expectedTotalCents: totalDaMesa,
        payments: [{ method: "emola", amountCents: totalDaMesa }],
      },
    });
    expect(error?.message).toContain("table_bill_changed");

    const mesa = await mesaNoPos();
    expect(mesa?.orders).toHaveLength(3);
    totalDaMesa += precoHaw;
  });

  it("fechar a conta cobra tudo de uma vez: misto, troco, gaveta e talão, e liberta a mesa", async () => {
    const clientCloseId = crypto.randomUUID();
    const emola = 50000;
    const dinheiro = totalDaMesa - emola;
    const payload = {
      clientCloseId,
      deviceId,
      tableId: mesaId,
      expectedTotalCents: totalDaMesa,
      payments: [
        { method: "cash", amountCents: dinheiro },
        { method: "emola", amountCents: emola },
      ],
      cashReceivedCents: dinheiro + 20000,
    };
    const { data, error } = await caixa.rpc("close_table_bill", { p_payload: payload });
    expect(error).toBeNull();
    criadasContas.push(data.bill_id as string);
    expect(data).toMatchObject({
      table_number: MESA,
      total_cents: totalDaMesa,
      change_cents: 20000,
      order_count: 3,
      duplicate: false,
    });

    // Cada pedido fica pago por inteiro, e a soma por método é a cobrada.
    const ids = [...criadosPedidos];
    const { data: pedidos } = await admin
      .from("orders")
      .select("id,total_cents,table_bill_id")
      .in("id", ids);
    const { data: pagamentos } = await admin
      .from("payments")
      .select("order_id,method,amount_cents,status")
      .in("order_id", ids);
    for (const pedido of pedidos ?? []) {
      expect(pedido.table_bill_id).toBe(data.bill_id);
      const pago = (pagamentos ?? [])
        .filter((p) => p.order_id === pedido.id)
        .reduce((soma, p) => soma + (p.amount_cents as number), 0);
      expect(pago).toBe(pedido.total_cents);
    }
    const porMetodo = (metodo: string) =>
      (pagamentos ?? []).filter((p) => p.method === metodo).reduce((s, p) => s + (p.amount_cents as number), 0);
    expect(porMetodo("cash")).toBe(dinheiro);
    expect(porMetodo("emola")).toBe(emola);
    expect((pagamentos ?? []).every((p) => p.status === "confirmed")).toBe(true);

    // O talão da conta e a gaveta, na impressora do balcão.
    const { data: papel } = await admin
      .from("print_jobs")
      .select("kind,station,payload")
      .eq("request_id", data.bill_id);
    const talao = papel?.find((p) => p.kind === "order");
    expect(talao).toMatchObject({
      station: "counter",
      payload: {
        formato: "talao_completo",
        order_number: `CONTA MESA ${MESA}`,
        total_cents: totalDaMesa,
        change_cents: 20000,
      },
    });
    expect(papel?.some((p) => p.kind === "drawer")).toBe(true);

    // A mesa fica livre.
    expect((await mesaNoPos())?.orders).toEqual([]);

    // Repetir o fecho devolve a mesma conta e não cobra outra vez.
    const repetido = await caixa.rpc("close_table_bill", { p_payload: payload });
    expect(repetido.data).toMatchObject({ bill_id: data.bill_id, duplicate: true });
    const { count } = await admin
      .from("payments")
      .select("id", { count: "exact", head: true })
      .in("order_id", ids);
    expect(count).toBe((pagamentos ?? []).length);
  });

  it("fechar uma mesa sem nada por pagar é recusado", async () => {
    const { error } = await caixa.rpc("close_table_bill", {
      p_payload: {
        clientCloseId: crypto.randomUUID(),
        deviceId,
        tableId: mesaId,
        expectedTotalCents: 1000,
        payments: [{ method: "cash", amountCents: 1000 }],
        cashReceivedCents: 1000,
      },
    });
    expect(error?.message).toContain("table_has_no_open_orders");
  });

  it("pelo QR, o WAGYU é cobrado ao preço do WAGYU e sai no papel como WAGYU", async () => {
    const { data, error } = await anon.rpc("create_order", {
      p_store_slug: "matola",
      p_payload: {
        fulfillmentType: "dine_in",
        tableId: mesaId,
        items: [{ menuItemId: classicId, qty: 1, variantId: wagyuId }],
      },
    });
    expect(error).toBeNull();
    criadosPedidos.push(data as string);

    const { data: pedido } = await admin
      .from("orders")
      .select("total_cents")
      .eq("id", data as string)
      .single();
    expect(pedido?.total_cents).toBe(precoWagyu);

    const { data: comandas } = await admin
      .from("print_jobs")
      .select("payload")
      .eq("order_id", data as string)
      .eq("kind", "order");
    expect(comandas![0].payload.items).toEqual([
      expect.objectContaining({ name: "Classic Smash", variant: "WAGYU", quantity: 1 }),
    ]);
  });

  it("sem stock para o pedido todo, o lançamento reverte inteiro", async () => {
    await admin
      .from("store_items")
      .update({ stock_qty: 1 })
      .eq("store_id", matolaStoreId)
      .eq("menu_item_id", classicId);
    const clientSaleId = crypto.randomUUID();
    const { error } = await lancar([{ menuItemId: classicId, qty: 2, variantId: hawId }], clientSaleId);
    expect(error?.message).toContain("out_of_stock");
    const { data: pedidos } = await admin.from("orders").select("id").eq("client_sale_id", clientSaleId);
    expect(pedidos ?? []).toHaveLength(0);
    expect(await stockDoClassic()).toBe(1);
  });
});
