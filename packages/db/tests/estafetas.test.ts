/**
 * Gate de integração da 1115 — estafetas.
 *
 * O que tem de ser verdade, contra um Supabase a sério (RLS, grants,
 * `security definer`):
 *
 *  - o estafeta entra com telefone + PIN e só vê as entregas DELE; o token é a
 *    única chave, e as RPCs do telemóvel não abrem a `anon` nem a `authenticated`;
 *  - "Levantei" faz o que o "Enviar" do balcão fazia (o pedido passa a `delivered`)
 *    e "Entregue" credita a taxa uma só vez, por mais toques que leve (regra 4);
 *  - estafeta de Maputo não leva pedido da Matola; caixa de Maputo não vê os da Matola (regra 3);
 *  - o pagamento em dinheiro sai da gaveta como despesa do turno, e repetir o
 *    pedido não paga duas vezes;
 *  - o cliente vê só o primeiro nome, e só enquanto vem a caminho.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://localhost:54731";
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!ANON_KEY || !SERVICE_KEY) {
  throw new Error(
    "1115: define SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY (supabase status) para correr este teste.",
  );
}

const suffix = `${Date.now()}`;
const PASSWORD = "Estafetas-1115-Teste-2026!";
const PIN = "4821";

let admin: SupabaseClient;
let anon: SupabaseClient;
let gerente: SupabaseClient;
let caixa: SupabaseClient;
let caixaMaputo: SupabaseClient;
let matolaStoreId: string;
let maputoStoreId: string;
let matolaZoneId: string;
let itemId: string;
let inicio: string;

const criadosUsers: string[] = [];
const criadosPedidos: string[] = [];
const criadosEstafetas: string[] = [];

// Telefones de teste: 9 dígitos, prefixo 80 (não atribuído a operadora em MZ).
const telefone = (n: number) => `80${suffix.slice(-5)}${String(n).padStart(2, "0")}`;

async function conta(role: string, loja: string, nome: string): Promise<SupabaseClient> {
  const email = `estafetas-${role}-${nome}-${suffix}@delivery.test`;
  const { data: user, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error || !user.user) throw new Error(`Setup 1115: conta ${role} — ${error?.message}`);
  criadosUsers.push(user.user.id);
  await admin.from("staff_profiles").insert({ user_id: user.user.id, full_name: `Teste ${role}`, role, active: true });
  await admin.from("staff_stores").insert({ user_id: user.user.id, store_id: loja });
  const cliente = createClient(SUPABASE_URL, ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: loginError } = await cliente.auth.signInWithPassword({ email, password: PASSWORD });
  if (loginError) throw new Error(`Setup 1115: sessão ${role} — ${loginError.message}`);
  return cliente;
}

/** Pedido de entrega da Matola, já na cozinha. O estado é fixture, não o que se testa. */
async function entregaEmPreparo(): Promise<string> {
  const { data, error } = await anon.rpc("create_order", {
    p_store_slug: "matola",
    p_payload: {
      items: [{ menuItemId: itemId, qty: 1 }],
      customerName: `Cliente Estafeta ${suffix}`,
      customerPhone: "840000000",
      fulfillmentType: "pickup",
      paymentMethod: "mpesa",
    },
  });
  if (error) throw new Error(`Setup 1115: create_order — ${error.message}`);
  const orderId = data as string;
  criadosPedidos.push(orderId);
  const { error: upd } = await admin.from("orders").update({
    fulfillment_type: "delivery",
    delivery_zone_id: matolaZoneId,
    address: "Rua de Teste, 1",
    delivery_fee_cents: 15000,
    status: "in_preparation",
  }).eq("id", orderId);
  if (upd) throw new Error(`Setup 1115: preparar pedido — ${upd.message}`);
  return orderId;
}

async function novoEstafeta(loja: string, n: number, quem: SupabaseClient = gerente) {
  const phone = telefone(n);
  const { data: id, error } = await quem.rpc("save_courier", {
    p_courier_id: null, p_store_id: loja, p_full_name: `Estafeta Teste ${n}`, p_phone: phone, p_active: true,
  });
  if (error) throw new Error(`Setup 1115: save_courier — ${error.message}`);
  criadosEstafetas.push(id as string);
  return { id: id as string, phone };
}

async function entrar(phone: string, pin = PIN): Promise<string> {
  const { data, error } = await admin.rpc("courier_login", { p_phone: phone, p_pin: pin });
  if (error) throw new Error(`courier_login — ${error.message}`);
  if (!data.ok) throw new Error(`courier_login recusou: ${data.reason}`);
  return data.token as string;
}

beforeAll(async () => {
  inicio = new Date(Date.now() - 60_000).toISOString();
  admin = createClient(SUPABASE_URL, SERVICE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  anon = createClient(SUPABASE_URL, ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: lojas } = await admin.from("stores").select("id,slug").in("slug", ["matola", "maputo"]);
  matolaStoreId = lojas!.find((l) => l.slug === "matola")!.id as string;
  maputoStoreId = lojas!.find((l) => l.slug === "maputo")!.id as string;

  const { data: zona } = await admin.from("delivery_zones").select("id").eq("store_id", matolaStoreId).limit(1).single();
  matolaZoneId = zona!.id as string;

  const { data: menu } = await anon.rpc("get_menu", { p_store_slug: "matola" });
  const item = (menu as { categories: Array<{ items: Array<{ id: string }> }> })
    .categories.flatMap((c) => c.items)[0];
  if (!item) throw new Error("Setup 1115: a Matola não tem nenhum item à venda");
  itemId = item.id;

  gerente = await conta("manager", matolaStoreId, "mtl");
  caixa = await conta("cashier", matolaStoreId, "mtl");
  caixaMaputo = await conta("cashier", maputoStoreId, "mpt");

  // Regra da casa de fábrica para o teste: 100% da taxa de entrega.
  await admin.from("stores").update({ courier_fee_fixed_cents: null, courier_fee_pct: 100 }).eq("id", matolaStoreId);
}, 120_000);

afterAll(async () => {
  if (!admin) return;
  if (criadosEstafetas.length > 0) {
    await admin.from("courier_ledger").delete().in("courier_id", criadosEstafetas);
    await admin.from("deliveries").delete().in("courier_id", criadosEstafetas);
    await admin.from("courier_positions").delete().in("courier_id", criadosEstafetas);
    await admin.from("courier_sessions").delete().in("courier_id", criadosEstafetas);
    await admin.from("courier_credentials").delete().in("courier_id", criadosEstafetas);
    await admin.from("couriers").delete().in("id", criadosEstafetas);
  }
  if (criadosPedidos.length > 0) {
    await admin.from("print_jobs").delete().in("order_id", criadosPedidos);
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
  await admin.from("event_log").delete().like("type", "courier.%").gte("created_at", inicio);
  for (const id of criadosUsers) {
    await admin.from("staff_stores").delete().eq("user_id", id);
    await admin.from("staff_profiles").delete().eq("user_id", id);
    await admin.auth.admin.deleteUser(id);
  }
});

describe("1115 · quem gere estafetas", () => {
  it("o caixa não cria estafeta nem lhe define o PIN", async () => {
    const { error } = await caixa.rpc("save_courier", {
      p_courier_id: null, p_store_id: matolaStoreId, p_full_name: "Não Devia", p_phone: telefone(9), p_active: true,
    });
    expect(error?.message).toContain("courier_access_denied");
  });

  it("o telefone fica normalizado e não se repete entre estafetas activos", async () => {
    const { id, phone } = await novoEstafeta(matolaStoreId, 1);
    const { data } = await admin.from("couriers").select("phone").eq("id", id).single();
    expect(data!.phone).toBe(phone);
    const { error } = await gerente.rpc("save_courier", {
      p_courier_id: null, p_store_id: matolaStoreId, p_full_name: "Duplicado", p_phone: `+258 ${phone}`, p_active: true,
    });
    expect(error?.message).toContain("courier_phone_taken");
  });

  it("o PIN não se lê pela API, nem pelo gerente", async () => {
    const { id } = await novoEstafeta(matolaStoreId, 2);
    await gerente.rpc("set_courier_pin", { p_courier_id: id, p_pin: PIN });
    const { data, error } = await gerente.from("courier_credentials").select("*").eq("courier_id", id);
    expect(error !== null || (data ?? []).length === 0).toBe(true);
  });
});

describe("1115 · o telemóvel do estafeta", () => {
  it("as RPCs do telemóvel não abrem a anon nem a sessão da equipa", async () => {
    const { error: e1 } = await anon.rpc("courier_login", { p_phone: "840000000", p_pin: "1234" });
    const { error: e2 } = await caixa.rpc("courier_state", { p_token: "x".repeat(64) });
    expect(e1).not.toBeNull();
    expect(e2).not.toBeNull();
  });

  it("PIN errado não entra, e token inventado não lê nada", async () => {
    const { id, phone } = await novoEstafeta(matolaStoreId, 3);
    await gerente.rpc("set_courier_pin", { p_courier_id: id, p_pin: PIN });
    const { data } = await admin.rpc("courier_login", { p_phone: phone, p_pin: "0000" });
    expect(data.ok).toBe(false);
    const { error } = await admin.rpc("courier_state", { p_token: "f".repeat(64) });
    expect(error?.message).toContain("courier_session_invalid");
  });

  it("levantar → entregar: o pedido sai, a taxa entra uma vez, os dados do cliente saem do ecrã", async () => {
    const { id, phone } = await novoEstafeta(matolaStoreId, 4);
    await gerente.rpc("set_courier_pin", { p_courier_id: id, p_pin: PIN });
    const orderId = await entregaEmPreparo();

    const { data: deliveryId, error: assignError } = await caixa.rpc("assign_courier", {
      p_order_id: orderId, p_courier_id: id,
    });
    expect(assignError).toBeNull();

    const token = await entrar(phone);
    const { data: antes } = await admin.rpc("courier_state", { p_token: token });
    expect(antes.jobs).toHaveLength(1);
    expect(antes.jobs[0].address).toBe("Rua de Teste, 1");
    expect(antes.jobs[0].fee_cents).toBe(15000);

    const { error: pickError } = await admin.rpc("courier_pickup", { p_token: token, p_delivery_id: deliveryId });
    expect(pickError).toBeNull();
    const { data: pedido } = await admin.from("orders").select("status").eq("id", orderId).single();
    expect(pedido!.status).toBe("delivered");

    const { data: aCaminho } = await anon.rpc("get_order_status", { p_order_id: orderId });
    expect(aCaminho.delivery.status).toBe("picked_up");
    expect(aCaminho.delivery.courier_first_name).toBe("Estafeta");

    for (let i = 0; i < 2; i++) {
      const { error } = await admin.rpc("courier_deliver", {
        p_token: token, p_delivery_id: deliveryId, p_lat: -25.96, p_lng: 32.58,
      });
      expect(error).toBeNull();
    }
    const { data: linhas } = await admin.from("courier_ledger").select("amount_cents,kind").eq("courier_id", id);
    expect(linhas).toEqual([{ amount_cents: 15000, kind: "delivery_fee" }]);

    const { data: depois } = await admin.rpc("courier_state", { p_token: token });
    expect(depois.jobs).toHaveLength(0);
    expect(depois.balance_cents).toBe(15000);
    expect(depois.today.deliveries).toBe(1);

    const { data: entregue } = await anon.rpc("get_order_status", { p_order_id: orderId });
    expect(entregue.delivery.status).toBe("delivered");
    expect(entregue.delivery.courier_first_name).toBeNull();
  });

  it("não levanta pedido que a cozinha ainda não começou", async () => {
    const { id, phone } = await novoEstafeta(matolaStoreId, 5);
    await gerente.rpc("set_courier_pin", { p_courier_id: id, p_pin: PIN });
    const orderId = await entregaEmPreparo();
    await admin.from("orders").update({ status: "approved" }).eq("id", orderId);
    const { data: deliveryId } = await caixa.rpc("assign_courier", { p_order_id: orderId, p_courier_id: id });
    const token = await entrar(phone);
    const { error } = await admin.rpc("courier_pickup", { p_token: token, p_delivery_id: deliveryId });
    expect(error?.message).toContain("order_not_ready");
  });

  it("um estafeta não mexe na entrega de outro", async () => {
    const a = await novoEstafeta(matolaStoreId, 6);
    const b = await novoEstafeta(matolaStoreId, 7);
    await gerente.rpc("set_courier_pin", { p_courier_id: b.id, p_pin: PIN });
    const orderId = await entregaEmPreparo();
    const { data: deliveryId } = await caixa.rpc("assign_courier", { p_order_id: orderId, p_courier_id: a.id });
    const tokenB = await entrar(b.phone);
    const { error } = await admin.rpc("courier_deliver", { p_token: tokenB, p_delivery_id: deliveryId });
    expect(error?.message).toContain("delivery_not_found");
  });

  it("posição só fica guardada com o estafeta de serviço, e desaparece ao sair", async () => {
    const { id, phone } = await novoEstafeta(matolaStoreId, 8);
    await gerente.rpc("set_courier_pin", { p_courier_id: id, p_pin: PIN });
    const token = await entrar(phone);
    const { data: fora } = await admin.rpc("courier_ping", { p_token: token, p_lat: -25.9, p_lng: 32.5 });
    expect(fora.stored).toBe(false);
    await admin.rpc("courier_set_shift", { p_token: token, p_on: true });
    const { data: dentro } = await admin.rpc("courier_ping", { p_token: token, p_lat: -25.9, p_lng: 32.5, p_accuracy_m: 12 });
    expect(dentro.stored).toBe(true);
    const { data: vista } = await caixa.from("courier_positions").select("lat").eq("courier_id", id);
    expect(vista).toHaveLength(1);
    await admin.rpc("courier_set_shift", { p_token: token, p_on: false });
    const { count } = await admin.from("courier_positions").select("courier_id", { count: "exact", head: true }).eq("courier_id", id);
    expect(count).toBe(0);
  });
});

describe("1115 · isolamento entre lojas", () => {
  it("estafeta de Maputo não leva pedido da Matola", async () => {
    const { data: gerenteMaputoId } = await admin.from("stores").select("id").eq("id", maputoStoreId).single();
    expect(gerenteMaputoId).not.toBeNull();
    const { data: idMaputo, error: e } = await admin.from("couriers")
      .insert({ store_id: maputoStoreId, full_name: "Estafeta Maputo", phone: telefone(0) })
      .select("id").single();
    if (e) throw e;
    criadosEstafetas.push(idMaputo!.id as string);
    const orderId = await entregaEmPreparo();
    const { error } = await gerente.rpc("assign_courier", { p_order_id: orderId, p_courier_id: idMaputo!.id });
    expect(error?.message).toContain("courier_wrong_store");
  });

  it("o caixa de Maputo não vê estafetas nem entregas da Matola", async () => {
    const { data: estafetas } = await caixaMaputo.from("couriers").select("id").eq("store_id", matolaStoreId);
    const { data: entregas } = await caixaMaputo.from("deliveries").select("id").eq("store_id", matolaStoreId);
    expect(estafetas ?? []).toHaveLength(0);
    expect(entregas ?? []).toHaveLength(0);
    const { error } = await caixaMaputo.rpc("get_couriers_board", { p_store_id: matolaStoreId });
    expect(error?.message).toContain("courier_access_denied");
  });

  it("o caixa vê o quadro mas não o saldo; a conta-corrente é do gerente", async () => {
    const { data } = await caixa.rpc("get_couriers_board", { p_store_id: matolaStoreId });
    expect(data.couriers.length).toBeGreaterThan(0);
    expect(data.couriers.every((c: { balance_cents: number | null }) => c.balance_cents === null)).toBe(true);
    const { data: ledger } = await caixa.from("courier_ledger").select("id");
    expect(ledger ?? []).toHaveLength(0);
  });
});

describe("1115 · pagar ao estafeta", () => {
  it("em dinheiro: sai da gaveta como despesa, uma só vez", async () => {
    const { id } = await novoEstafeta(matolaStoreId, 10);
    // Turno aberto na Matola, como o balcão o teria.
    const { data: aberto } = await admin.from("cash_sessions").select("id")
      .eq("store_id", matolaStoreId).is("closed_at", null).maybeSingle();
    if (!aberto) {
      const { error } = await gerente.rpc("open_cash_session", { p_store: matolaStoreId, p_float: 0 });
      if (error) throw new Error(`Setup 1115: abrir caixa — ${error.message}`);
    }

    const requestId = crypto.randomUUID();
    for (let i = 0; i < 2; i++) {
      const { error } = await gerente.rpc("courier_payout", {
        p_courier_id: id, p_amount_cents: 30000, p_method: "cash", p_note: "Semana", p_request_id: requestId,
      });
      expect(error).toBeNull();
    }
    const { data: linhas } = await admin.from("courier_ledger").select("amount_cents").eq("courier_id", id);
    expect(linhas).toEqual([{ amount_cents: -30000 }]);
    const { data: movimentos } = await admin.from("cash_movements").select("type,amount_cents")
      .eq("store_id", matolaStoreId).eq("request_id", requestId);
    expect(movimentos).toEqual([{ type: "despesa", amount_cents: 30000 }]);
  });

  it("o caixa não paga ao estafeta", async () => {
    const { id } = await novoEstafeta(matolaStoreId, 11);
    const { error } = await caixa.rpc("courier_payout", {
      p_courier_id: id, p_amount_cents: 100, p_method: "mpesa", p_note: null, p_request_id: crypto.randomUUID(),
    });
    expect(error?.message).toContain("courier_access_denied");
  });
});
