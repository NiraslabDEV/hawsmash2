/**
 * Gate do talão da casa (1062–1064): um só papel para todos os pedidos.
 *
 * Decisão do dono, 23 Set: balcão, levantamento ou entrega saem sempre em dois
 * talões completos — o do HAWSMASH 1.0 — com VIA DE CONTROLO (fica na loja) e
 * VIA DO CLIENTE (vai para a cozinha e depois cola-se no saco). Reimprimir sai
 * um talão só, marcado REIMPRESSÃO.
 *
 * Corre na Matola de propósito: vender e aprovar põem papel na fila, e é
 * preciso que nenhuma impressora a sério o imprima. Se um dia houver bridge
 * viva na Matola do staging, o travão da suite pára antes disto.
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

type Job = {
  station: string;
  kind: string;
  reprint_seq: number;
  payload: Record<string, unknown>;
};

let admin: SupabaseClient;
let anon: SupabaseClient;
let caixa: SupabaseClient;
let matolaStoreId: string;
let itemId: string;
let precoItem: number;
let deviceId: string;
let viasAntes: number;
let inicio: string;

/**
 * A matéria-prima da Matola antes deste ficheiro. Aprovar e vender descontam a
 * ficha técnica, e apagar os pedidos no fim não a devolve: sem repor, cada
 * corrida gastava ~5 fatias de cheddar do staging, até as vendas pararem.
 */
let ingredientesAntes: Array<{ ingredient_id: string; qty: number }> = [];

const sufixo = `${Date.now()}`;
const PASSWORD = "Comanda-1064-Teste-2026!";
const criadosUsers: string[] = [];
const criadosPedidos: string[] = [];

async function pedidoOnline(nome: string): Promise<string> {
  const { data, error } = await anon.rpc("create_order", {
    p_store_slug: "matola",
    p_payload: {
      items: [{ menuItemId: itemId, qty: 1 }],
      customerName: nome,
      fulfillmentType: "pickup",
      paymentMethod: "mpesa",
    },
  });
  if (error) throw new Error(`Setup talão: create_order — ${error.message}`);
  criadosPedidos.push(data as string);
  return data as string;
}

async function papel(orderId: string, kind = "order"): Promise<Job[]> {
  const { data } = await admin
    .from("print_jobs")
    .select("station,kind,reprint_seq,payload")
    .eq("order_id", orderId)
    .eq("kind", kind)
    .order("reprint_seq");
  return (data ?? []) as Job[];
}

beforeAll(async () => {
  inicio = new Date(Date.now() - 60_000).toISOString();
  admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  anon = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: loja } = await admin
    .from("stores")
    .select("id,kitchen_ticket_copies")
    .eq("slug", "matola")
    .single();
  matolaStoreId = loja!.id as string;
  viasAntes = (loja as { kitchen_ticket_copies?: number }).kitchen_ticket_copies ?? 2;

  // Guardar e encher: o teste não pode depender do que outros deixaram, nem
  // gastar o que é do staging.
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
  if (!item) throw new Error("Setup talão: a Matola não tem nenhum item à venda");
  itemId = item.id;
  precoItem = item.price_cents;

  const email = `talao-caixa-${sufixo}@delivery.test`;
  const { data: user } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  criadosUsers.push(user.user!.id);
  await admin
    .from("staff_profiles")
    .insert({ user_id: user.user!.id, full_name: "Caixa do talão", role: "cashier", active: true });
  await admin.from("staff_stores").insert({ user_id: user.user!.id, store_id: matolaStoreId });
  caixa = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await caixa.auth.signInWithPassword({ email, password: PASSWORD });

  const { data: device, error: deviceError } = await admin
    .from("devices")
    .insert({
      store_id: matolaStoreId,
      kind: "pos",
      label: `POS talão ${sufixo}`,
      device_key_hash: `talao-${sufixo}`,
    })
    .select("id")
    .single();
  if (deviceError || !device) throw new Error(`Setup talão: terminal — ${deviceError?.message}`);
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
  await admin.from("stores").update({ kitchen_ticket_copies: viasAntes }).eq("id", matolaStoreId);
  if (criadosPedidos.length > 0) {
    await admin.from("event_log").delete().in("order_id", criadosPedidos);
    await admin.from("orders").delete().in("id", criadosPedidos);
  }
  // A venda de balcão abre caixa sozinha: a que este teste abriu não fica.
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

describe("talão da casa · pedido online", () => {
  it("aprovar deixa dois talões completos: controlo ao balcão, cliente na cozinha", async () => {
    const orderId = await pedidoOnline(`Talão online ${sufixo}`);
    const { error } = await caixa.rpc("advance_order", { p_order_id: orderId, p_event: "APPROVE" });
    expect(error).toBeNull();

    const vias = await papel(orderId);
    expect(vias.map((v) => [v.reprint_seq, v.station, v.payload.via])).toEqual([
      [0, "counter", "controlo"],
      [1, "kitchen", "cliente"],
    ]);
    for (const via of vias) {
      // `template: 'kitchen'` fica: uma bridge antiga imprime a comanda e não
      // o formato herdado; a nova vê `formato` e imprime o talão.
      expect(via.payload).toMatchObject({
        template: "kitchen",
        formato: "talao_completo",
        store_short_name: "Matola",
        payment_method: "mpesa",
      });
      expect(typeof via.payload.total_cents).toBe("number");
      const itens = via.payload.items as Array<{ line_total_cents?: number }>;
      expect(itens.every((i) => typeof i.line_total_cents === "number")).toBe(true);
    }
  });

  it("reimprimir a cozinha sai um talão completo marcado REIMPRESSÃO", async () => {
    const orderId = criadosPedidos[0];
    const { data, error } = await caixa.rpc("reprint", {
      p_order_id: orderId,
      p_kind: "order",
      p_request_id: crypto.randomUUID(),
    });
    expect(error).toBeNull();

    const reimpressa = (await papel(orderId)).find((v) => v.reprint_seq === data.reprint_seq);
    expect(reimpressa).toMatchObject({
      station: "kitchen",
      payload: { formato: "talao_completo", via: "reimpressao" },
    });
  });
});

describe("talão da casa · venda de balcão", () => {
  let vendaId: string;

  it("vender deixa dois talões completos e nenhum talão curto", async () => {
    const { data, error } = await caixa.rpc("create_counter_sale", {
      p_payload: {
        clientSaleId: crypto.randomUUID(),
        deviceId,
        items: [{ menuItemId: itemId, qty: 1 }],
        // Os pagamentos somam o total; o dinheiro entregue vai à parte.
        payments: [{ method: "cash", amountCents: precoItem }],
        cashReceivedCents: 100000,
      },
    });
    expect(error).toBeNull();
    vendaId = data.order_id as string;
    criadosPedidos.push(vendaId);

    const vias = await papel(vendaId);
    expect(vias.map((v) => [v.station, v.payload.via])).toEqual([
      ["counter", "controlo"],
      ["kitchen", "cliente"],
    ]);
    expect(await papel(vendaId, "receipt")).toEqual([]);
  });

  it("o talão do balcão leva o pagamento, o recebido e o troco, e não inventa cliente", async () => {
    const [controlo] = await papel(vendaId);
    const total = controlo.payload.total_cents as number;
    expect(controlo.payload).toMatchObject({
      channel: "counter",
      customer_name: null,
      cash_received_cents: 100000,
      change_cents: 100000 - total,
      payments: [{ method: "cash", amount_cents: total }],
    });
  });

  it("a gaveta continua a abrir numa venda em dinheiro", async () => {
    expect((await papel(vendaId, "drawer")).length).toBe(1);
  });

  it("a 2.ª via do cliente sai ao balcão, como talão completo marcado", async () => {
    const { error } = await caixa.rpc("reprint", {
      p_order_id: vendaId,
      p_kind: "receipt",
      p_request_id: crypto.randomUUID(),
    });
    expect(error).toBeNull();

    const [segunda] = await papel(vendaId, "receipt");
    expect(segunda).toMatchObject({
      station: "counter",
      payload: { formato: "talao_completo", via: "reimpressao" },
    });
  });
});

describe("talão da casa · venda offline", () => {
  it("o que o POS já imprimiu sem rede não volta a sair — nem a via de controlo", async () => {
    const { data, error } = await caixa.rpc("sync_counter_sale", {
      p_payload: {
        clientSaleId: crypto.randomUUID(),
        deviceId,
        items: [{ menuItemId: itemId, qty: 1 }],
        payments: [{ method: "cash", amountCents: precoItem }],
        cashReceivedCents: precoItem,
        offlineTotalCents: precoItem,
      },
      // Sem rede, o POS imprimiu o talão ao balcão, a comanda na cozinha e abriu a gaveta.
      p_local_print: { receipt: true, drawer: true, stations: ["kitchen"] },
    });
    expect(error).toBeNull();
    criadosPedidos.push(data.order_id as string);

    const { data: fila } = await admin
      .from("print_jobs")
      .select("kind,station,status")
      .eq("order_id", data.order_id);
    expect((fila ?? []).length).toBeGreaterThanOrEqual(3);
    expect((fila ?? []).filter((j) => j.status !== "printed")).toEqual([]);
  });
});

describe("talão da casa · vias por loja", () => {
  it("o número de vias é da loja, não do código", async () => {
    await admin.from("stores").update({ kitchen_ticket_copies: 1 }).eq("id", matolaStoreId);

    const orderId = await pedidoOnline(`Talão uma via ${sufixo}`);
    const { error } = await caixa.rpc("advance_order", { p_order_id: orderId, p_event: "APPROVE" });
    expect(error).toBeNull();

    const vias = await papel(orderId);
    expect(vias.map((v) => [v.reprint_seq, v.station, v.payload.via])).toEqual([[0, "kitchen", null]]);
  });
});
