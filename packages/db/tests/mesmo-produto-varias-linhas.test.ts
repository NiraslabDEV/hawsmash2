/**
 * Gate da 1080: o mesmo produto em várias linhas da venda de balcão.
 *
 * Caso real, 24 Set: 6 Classic — 5 HAW e 1 WAGYU — pagos por e-Mola, recusados
 * duas vezes com `duplicate_item`. O carrinho do POS separa HAW de WAGYU (preços
 * diferentes) e um "sem cebola" de um normal (cozinha diferente); o servidor
 * recusava o mesmo produto em duas linhas e a venda inteira caía — sem pedido,
 * sem pagamento registado, sem talão.
 *
 * Corre na Matola pela razão do comanda-padrao: vender põe papel na fila, e
 * nenhuma impressora a sério o pode imprimir.
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

type Linha = { menuItemId: string; qty: number; variantId?: string; notes?: string };
type ArtigoDoPapel = { name: string; variant?: string | null; quantity: number };

let admin: SupabaseClient;
let caixa: SupabaseClient;
let matolaStoreId: string;
let deviceId: string;
let classicId: string;
let hawId: string;
let wagyuId: string;
let precoHaw: number;
let precoWagyu: number;
let inicio: string;
let stockAntes: { available: boolean; track_stock: boolean; stock_qty: number } | null = null;
let ingredientesAntes: Array<{ ingredient_id: string; qty: number }> = [];

const sufixo = `${Date.now()}`;
const PASSWORD = "Mesmo-Produto-1080-Teste!";
const criadosUsers: string[] = [];
const criadosPedidos: string[] = [];

/** O pedido do dia: 5 HAW e 1 WAGYU do mesmo Classic. */
function cincoHawUmWagyu(): Linha[] {
  return [
    { menuItemId: classicId, qty: 5, variantId: hawId },
    { menuItemId: classicId, qty: 1, variantId: wagyuId },
  ];
}

function vender(items: Linha[], amountCents: number, clientSaleId = crypto.randomUUID()) {
  return caixa.rpc("create_counter_sale", {
    p_payload: {
      clientSaleId,
      deviceId,
      items,
      payments: [{ method: "emola", amountCents }],
    },
  });
}

/** O que a cozinha lê: o nome, e a variante quando vem num campo à parte (1077). */
function noPapel(artigo: ArtigoDoPapel): string {
  return `${artigo.quantity}x ${[artigo.name, artigo.variant].filter(Boolean).join(" ")}`;
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
  admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: loja } = await admin.from("stores").select("id").eq("slug", "matola").single();
  if (!loja) throw new Error("Setup 1080: loja Matola não encontrada");
  matolaStoreId = loja.id as string;

  const { data: classic } = await admin
    .from("menu_items")
    .select("id")
    .eq("name", "Classic Smash")
    .single();
  if (!classic) throw new Error("Setup 1080: Classic Smash não encontrado");
  classicId = classic.id as string;

  const { data: variantes } = await admin
    .from("menu_item_variants")
    .select("id,name,price_cents")
    .eq("menu_item_id", classicId);
  const haw = variantes?.find((v) => v.name === "HAW");
  const wagyu = variantes?.find((v) => v.name === "WAGYU");
  if (!haw || !wagyu) throw new Error("Setup 1080: faltam as variantes HAW/WAGYU do Classic");
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
  if (!stock) throw new Error("Setup 1080: o Classic não tem linha de stock na Matola");
  stockAntes = stock;
  await admin
    .from("store_items")
    .update({ available: true, track_stock: false })
    .eq("store_id", matolaStoreId)
    .eq("menu_item_id", classicId);

  // Cada venda aqui são 6 carnes pela ficha técnica. Guardar e encher, e repor
  // no fim: o teste não depende do que outros deixaram nem gasta o do staging.
  const { data: ingredientes } = await admin
    .from("store_ingredients")
    .select("ingredient_id,qty")
    .eq("store_id", matolaStoreId);
  ingredientesAntes = (ingredientes ?? []) as Array<{ ingredient_id: string; qty: number }>;
  await admin.from("store_ingredients").update({ qty: 100000 }).eq("store_id", matolaStoreId);

  const email = `mesmo-produto-${sufixo}@delivery.test`;
  const { data: user } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  criadosUsers.push(user.user!.id);
  await admin
    .from("staff_profiles")
    .insert({ user_id: user.user!.id, full_name: "Caixa 1080", role: "cashier", active: true });
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
      label: `POS 1080 ${sufixo}`,
      device_key_hash: `mesmo-produto-${sufixo}`,
    })
    .select("id")
    .single();
  if (deviceError || !device) throw new Error(`Setup 1080: terminal — ${deviceError?.message}`);
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
  if (stockAntes) {
    await admin
      .from("store_items")
      .update(stockAntes)
      .eq("store_id", matolaStoreId)
      .eq("menu_item_id", classicId);
  }
  if (criadosPedidos.length > 0) {
    await admin.from("stock_movements").delete().in("order_id", criadosPedidos);
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

describe("1080 · o mesmo produto em várias linhas", () => {
  let vendaId: string;

  it("5 HAW e 1 WAGYU do mesmo Classic, pagos por e-Mola, são uma venda com duas linhas", async () => {
    const total = 5 * precoHaw + precoWagyu;
    const { data, error } = await vender(cincoHawUmWagyu(), total);
    expect(error).toBeNull();
    vendaId = data.order_id as string;
    criadosPedidos.push(vendaId);
    expect(data.total_cents).toBe(total);

    const { data: linhas } = await admin
      .from("order_items")
      .select("qty,unit_price_cents,variant_name_snapshot")
      .eq("order_id", vendaId)
      .order("qty", { ascending: false });
    expect(linhas).toEqual([
      { qty: 5, unit_price_cents: precoHaw, variant_name_snapshot: "HAW" },
      { qty: 1, unit_price_cents: precoWagyu, variant_name_snapshot: "WAGYU" },
    ]);

    const { data: pagamentos } = await admin
      .from("payments")
      .select("method,amount_cents,status")
      .eq("order_id", vendaId);
    expect(pagamentos).toEqual([{ method: "emola", amount_cents: total, status: "confirmed" }]);
  });

  it("o talão diz à cozinha qual é o WAGYU, nas duas vias", async () => {
    const { data: vias } = await admin
      .from("print_jobs")
      .select("payload")
      .eq("order_id", vendaId)
      .eq("kind", "order");
    expect(vias?.length).toBeGreaterThan(0);
    for (const via of vias ?? []) {
      const artigos = (via.payload as { items: ArtigoDoPapel[] }).items;
      expect(artigos.map(noPapel).sort()).toEqual([
        "1x Classic Smash WAGYU",
        "5x Classic Smash HAW",
      ]);
    }
  });

  it("um 'sem cebola' e um normal do mesmo produto também são duas linhas", async () => {
    const { data, error } = await vender(
      [
        { menuItemId: classicId, qty: 1, variantId: hawId, notes: "Sem cebola" },
        { menuItemId: classicId, qty: 1, variantId: hawId },
      ],
      2 * precoHaw,
    );
    expect(error).toBeNull();
    criadosPedidos.push(data.order_id as string);

    const { data: linhas } = await admin
      .from("order_items")
      .select("notes")
      .eq("order_id", data.order_id);
    expect((linhas ?? []).map((l) => l.notes).sort()).toEqual(["Sem cebola", null]);
  });

  it("o stock conta as duas linhas, e se não chegar para as duas a venda inteira reverte", async () => {
    await admin
      .from("store_items")
      .update({ track_stock: true, stock_qty: 6 })
      .eq("store_id", matolaStoreId)
      .eq("menu_item_id", classicId);

    const total = 5 * precoHaw + precoWagyu;
    const certa = await vender(cincoHawUmWagyu(), total);
    expect(certa.error).toBeNull();
    criadosPedidos.push(certa.data.order_id as string);
    expect(await stockDoClassic()).toBe(0);

    // Uma entrada no livro por linha, cada uma com o que a anterior deixou.
    const { data: movimentos } = await admin
      .from("stock_movements")
      .select("delta,qty_after")
      .eq("order_id", certa.data.order_id)
      .eq("reason", "sale")
      .order("delta");
    expect(movimentos).toEqual([
      { delta: -5, qty_after: 1 },
      { delta: -1, qty_after: 0 },
    ]);

    // Cinco em stock para seis Classic: a segunda linha vê o que a primeira
    // deixou, e não fica meia venda para trás.
    await admin
      .from("store_items")
      .update({ stock_qty: 5 })
      .eq("store_id", matolaStoreId)
      .eq("menu_item_id", classicId);
    const clientSaleId = crypto.randomUUID();
    const curta = await vender(cincoHawUmWagyu(), total, clientSaleId);
    expect(curta.error?.message).toContain("out_of_stock");
    expect(await stockDoClassic()).toBe(5);
    const { data: pedidos } = await admin
      .from("orders")
      .select("id")
      .eq("client_sale_id", clientSaleId);
    expect(pedidos ?? []).toHaveLength(0);

    await admin
      .from("store_items")
      .update({ track_stock: false })
      .eq("store_id", matolaStoreId)
      .eq("menu_item_id", classicId);
  });

  it("vendida sem rede, a mesma venda sincroniza em vez de ficar presa na fila", async () => {
    const total = 5 * precoHaw + precoWagyu;
    const { data, error } = await caixa.rpc("sync_counter_sale", {
      p_payload: {
        clientSaleId: crypto.randomUUID(),
        deviceId,
        items: cincoHawUmWagyu(),
        payments: [{ method: "emola", amountCents: total }],
        offlineTotalCents: total,
      },
      p_local_print: { receipt: true, drawer: false, stations: ["kitchen"] },
    });
    expect(error).toBeNull();
    criadosPedidos.push(data.order_id as string);
    expect(data.total_cents).toBe(total);

    const { count } = await admin
      .from("order_items")
      .select("id", { count: "exact", head: true })
      .eq("order_id", data.order_id);
    expect(count).toBe(2);
  });
});
