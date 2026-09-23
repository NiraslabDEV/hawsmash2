/**
 * Gate da 1062 — a mesma comanda em todos os canais, nas vias que a loja pede.
 *
 * O que falhou a 23 Set: um pedido da internet, aprovado, saía na cozinha no
 * formato antigo do motor herdado — sem o número do dia em grande, sem a loja
 * — porque a aprovação não passava pela peça que monta a comanda HAWSMASH.
 * E o dono quer duas vias: uma de reserva, outra para a cozinha que depois se
 * cola no saco do cliente.
 *
 * Corre na Matola de propósito: aprovar põe comandas na fila, e é preciso que
 * nenhuma impressora a sério as imprima. Se um dia houver bridge viva na
 * Matola do staging, o travão da suite pára antes disto.
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

type Job = { station: string; kind: string; reprint_seq: number; payload: Record<string, unknown> };

let admin: SupabaseClient;
let anon: SupabaseClient;
let caixa: SupabaseClient;
let matolaStoreId: string;
let itemId: string;
let viasAntes: number;

const sufixo = `${Date.now()}`;
const PASSWORD = "Comanda-1062-Teste-2026!";
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
  if (error) throw new Error(`Setup comanda: create_order — ${error.message}`);
  criadosPedidos.push(data as string);
  return data as string;
}

async function comandas(orderId: string): Promise<Job[]> {
  const { data } = await admin
    .from("print_jobs")
    .select("station,kind,reprint_seq,payload")
    .eq("order_id", orderId)
    .eq("kind", "order")
    .order("reprint_seq");
  return (data ?? []) as Job[];
}

beforeAll(async () => {
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

  const { data: menu } = await anon.rpc("get_menu", { p_store_slug: "matola" });
  const item = (menu as { categories: Array<{ items: Array<{ id: string }> }> }).categories.flatMap(
    (c) => c.items,
  )[0];
  if (!item) throw new Error("Setup comanda: a Matola não tem nenhum item à venda");
  itemId = item.id;

  const email = `comanda-caixa-${sufixo}@delivery.test`;
  const { data: user } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  criadosUsers.push(user.user!.id);
  await admin
    .from("staff_profiles")
    .insert({ user_id: user.user!.id, full_name: "Caixa da comanda", role: "cashier", active: true });
  await admin.from("staff_stores").insert({ user_id: user.user!.id, store_id: matolaStoreId });
  caixa = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await caixa.auth.signInWithPassword({ email, password: PASSWORD });
}, 90_000);

afterAll(async () => {
  if (!admin) return;
  await admin.from("stores").update({ kitchen_ticket_copies: viasAntes }).eq("id", matolaStoreId);
  if (criadosPedidos.length > 0) {
    await admin.from("event_log").delete().in("order_id", criadosPedidos);
    await admin.from("orders").delete().in("id", criadosPedidos);
  }
  for (const id of criadosUsers) {
    await admin.from("staff_stores").delete().eq("user_id", id);
    await admin.from("staff_profiles").delete().eq("user_id", id);
    await admin.auth.admin.deleteUser(id);
  }
});

describe("1062/1063 · talão do pedido online", () => {
  it("aprovar um pedido online deixa o talão completo em duas vias: controlo e cliente", async () => {
    const orderId = await pedidoOnline(`Talão duas vias ${sufixo}`);
    const { error } = await caixa.rpc("advance_order", { p_order_id: orderId, p_event: "APPROVE" });
    expect(error).toBeNull();

    const vias = await comandas(orderId);
    expect(vias.map((v) => v.reprint_seq)).toEqual([0, 1]);
    expect(vias.map((v) => v.payload.via)).toEqual(["controlo", "cliente"]);
    for (const via of vias) {
      expect(via.station).toBe("kitchen");
      // `template: 'kitchen'` fica: uma bridge antiga imprime a comanda e não
      // o formato herdado; a nova vê `formato` e imprime o talão.
      expect(via.payload).toMatchObject({
        template: "kitchen",
        formato: "talao_completo",
        store_short_name: "Matola",
        payment_method: "mpesa",
      });
      expect(typeof via.payload.daily_number).toBe("number");
      expect(typeof via.payload.total_cents).toBe("number");
      const itens = via.payload.items as Array<{ line_total_cents?: number }>;
      expect(itens.length).toBeGreaterThan(0);
      expect(itens.every((i) => typeof i.line_total_cents === "number")).toBe(true);
    }
  });

  it("não sobra nenhuma comanda no formato antigo", async () => {
    const orderId = criadosPedidos[0];
    const vias = await comandas(orderId);
    expect(vias.every((v) => v.payload.template === "kitchen")).toBe(true);
  });

  it("o número de vias é da loja, não do código", async () => {
    await admin.from("stores").update({ kitchen_ticket_copies: 1 }).eq("id", matolaStoreId);

    const orderId = await pedidoOnline(`Talão uma via ${sufixo}`);
    const { error } = await caixa.rpc("advance_order", { p_order_id: orderId, p_event: "APPROVE" });
    expect(error).toBeNull();

    const vias = await comandas(orderId);
    expect(vias.map((v) => v.reprint_seq)).toEqual([0]);
    expect(vias[0].payload.via).toBeNull();
  });
});
