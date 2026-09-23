/**
 * Gate da alteração de morada e hora pelo balcão (1072).
 *
 * "O cliente ligou: afinal é para o prédio ao lado, e só às 20h." Até aqui o
 * caixa não tinha onde o escrever — anulava e refazia, ou riscava o papel à
 * mão, e em nenhum dos casos ficava registado quem mudou o quê.
 *
 * O que isto protege:
 *   · o dinheiro não se mexe: mudar de zona só passa se a taxa for a mesma.
 *     Com taxa diferente o total mudava, e o pedido pode já estar pago (regra 2);
 *   · o papel acompanha: se a comanda já saiu, sai uma via nova marcada
 *     ALTERADO — é a do saco que o entregador lê;
 *   · repetir o toque não imprime duas vezes (regra 4);
 *   · a Matola não mexe num pedido de Maputo, e a cozinha não mexe em nada (regra 3);
 *   · toda a alteração fica em event_log com antes, depois e quem.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://localhost:54731";
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz";

const sufixo = `${Date.now()}`;
const PASSWORD = "Alterar-Pedido-Teste-2026!";
const TELEFONE = `84${sufixo.slice(-7)}`;

let admin: SupabaseClient;
let anon: SupabaseClient;
let caixa: SupabaseClient;
let cozinha: SupabaseClient;
let caixaMatola: SupabaseClient;
let maputoStoreId: string;
let matolaStoreId: string;
let itemId: string;

/** Zonas próprias do teste: a do pedido, uma com a mesma taxa, uma mais cara, uma da Matola. */
let zonaPedido: string;
let zonaMesmaTaxa: string;
let zonaMaisCara: string;
let zonaMatola: string;

const criadosUsers: string[] = [];
const criadosOrders: string[] = [];

type Resultado = {
  changed: string[];
  reprinted: boolean;
  job_id: string | null;
  duplicate: boolean;
};

async function conta(role: string, storeId: string, nome: string): Promise<SupabaseClient> {
  const email = `alterar-${nome}-${sufixo}@delivery.test`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`Setup alterar: conta ${nome} — ${error?.message}`);
  criadosUsers.push(data.user.id);
  await admin
    .from("staff_profiles")
    .insert({ user_id: data.user.id, full_name: `Teste ${nome}`, role, active: true });
  await admin.from("staff_stores").insert({ user_id: data.user.id, store_id: storeId });

  const cliente = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: loginError } = await cliente.auth.signInWithPassword({ email, password: PASSWORD });
  if (loginError) throw new Error(`Setup alterar: sessão ${nome} — ${loginError.message}`);
  return cliente;
}

async function zona(storeId: string, nome: string, fee: number): Promise<string> {
  const { data, error } = await admin
    .from("delivery_zones")
    .insert({ store_id: storeId, name: `${nome} ${sufixo}`, fee_cents: fee, active: true, sort: 999 })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Setup alterar: zona ${nome} — ${error?.message}`);
  return data.id as string;
}

/** Uma encomenda online a sério, pelo caminho público. */
async function encomenda(tipo: "delivery" | "pickup"): Promise<string> {
  const { data, error } = await anon.rpc("create_order", {
    p_store_slug: "maputo",
    p_payload: {
      items: [{ menuItemId: itemId, qty: 1 }],
      customerName: `Alterar ${sufixo}`,
      customerPhone: TELEFONE,
      fulfillmentType: tipo,
      paymentMethod: "mpesa",
      ...(tipo === "delivery"
        ? { deliveryZoneId: zonaPedido, address: "Av. Julius Nyerere 100" }
        : {}),
    },
  });
  if (error) throw new Error(`Setup alterar: create_order — ${error.message}`);
  criadosOrders.push(data as string);
  return data as string;
}

function alterar(
  quem: SupabaseClient,
  orderId: string,
  changes: Record<string, unknown>,
  requestId: string = randomUUID(),
) {
  return quem.rpc("update_order_details", {
    p_order_id: orderId,
    p_changes: changes,
    p_request_id: requestId,
  });
}

async function pedido(orderId: string) {
  const { data } = await admin
    .from("orders")
    .select("address,delivery_zone_id,delivery_fee_cents,total_cents,scheduled_for,status")
    .eq("id", orderId)
    .single();
  return data!;
}

async function trabalhosAlteracao(orderId: string) {
  const { data } = await admin
    .from("print_jobs")
    .select("id,station,kind,payload,store_id")
    .eq("order_id", orderId)
    .eq("kind", "order");
  return (data ?? []).filter(
    (j) => (j.payload as { via?: string } | null)?.via === "alteracao",
  );
}

/** Daqui a `horas`, arredondado à meia hora — como sai do seletor do POS. */
function daquiA(horas: number): string {
  const d = new Date(Date.now() + horas * 3_600_000);
  d.setUTCMinutes(d.getUTCMinutes() < 30 ? 30 : 60, 0, 0);
  return d.toISOString();
}

beforeAll(async () => {
  admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  anon = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: lojas } = await admin.from("stores").select("id,slug").in("slug", ["maputo", "matola"]);
  maputoStoreId = lojas!.find((l) => l.slug === "maputo")!.id as string;
  matolaStoreId = lojas!.find((l) => l.slug === "matola")!.id as string;

  zonaPedido = await zona(maputoStoreId, "Alterar A", 15000);
  zonaMesmaTaxa = await zona(maputoStoreId, "Alterar B", 15000);
  zonaMaisCara = await zona(maputoStoreId, "Alterar C", 25000);
  zonaMatola = await zona(matolaStoreId, "Alterar Matola", 15000);

  const { data: menu } = await anon.rpc("get_menu", { p_store_slug: "maputo" });
  const item = (menu as { categories: Array<{ items: Array<{ id: string; available: boolean }> }> })
    .categories.flatMap((c) => c.items)
    .find((i) => i.available);
  if (!item) throw new Error("Setup alterar: a loja não tem nenhum item disponível");
  itemId = item.id;

  caixa = await conta("cashier", maputoStoreId, "caixa");
  cozinha = await conta("kitchen", maputoStoreId, "cozinha");
  caixaMatola = await conta("cashier", matolaStoreId, "matola");
}, 120_000);

afterAll(async () => {
  if (!admin) return;
  for (const orderId of criadosOrders) {
    await admin.from("print_jobs").delete().eq("order_id", orderId);
    await admin.from("event_log").delete().eq("order_id", orderId);
    await admin.from("order_items").delete().eq("order_id", orderId);
    await admin.from("orders").delete().eq("id", orderId);
  }
  await admin.from("customers").delete().eq("phone", TELEFONE);
  await admin
    .from("delivery_zones")
    .delete()
    .in("id", [zonaPedido, zonaMesmaTaxa, zonaMaisCara, zonaMatola].filter(Boolean));
  for (const userId of criadosUsers) {
    await admin.from("staff_stores").delete().eq("user_id", userId);
    await admin.from("staff_profiles").delete().eq("user_id", userId);
    await admin.auth.admin.deleteUser(userId);
  }
});

describe("alterar pedido · morada", () => {
  it("o caixa muda a morada, e fica registado quem, antes e depois", async () => {
    const orderId = await encomenda("delivery");

    const { data, error } = await alterar(caixa, orderId, { address: "  Rua da Resistência 45, 3.º andar  " });
    expect(error).toBeNull();
    const r = data as Resultado;
    expect(r.changed).toEqual(["address"]);
    // Ainda por aprovar: a comanda não saiu, não há papel a corrigir.
    expect(r.reprinted).toBe(false);

    expect((await pedido(orderId)).address).toBe("Rua da Resistência 45, 3.º andar");

    const { data: log } = await admin
      .from("event_log")
      .select("type,actor_user_id,store_id,payload")
      .eq("order_id", orderId)
      .eq("type", "order.address_changed");
    expect(log).toHaveLength(1);
    expect(log![0].actor_user_id).toBe(criadosUsers[0]);
    expect(log![0].store_id).toBe(maputoStoreId);
    expect(log![0].payload).toMatchObject({
      before: { address: "Av. Julius Nyerere 100" },
      after: { address: "Rua da Resistência 45, 3.º andar" },
    });
  });

  it("mudar para uma zona com a mesma taxa passa — o total não mexe", async () => {
    const orderId = await encomenda("delivery");
    const antes = await pedido(orderId);

    const { error } = await alterar(caixa, orderId, { deliveryZoneId: zonaMesmaTaxa });
    expect(error).toBeNull();

    const depois = await pedido(orderId);
    expect(depois.delivery_zone_id).toBe(zonaMesmaTaxa);
    expect(depois.delivery_fee_cents).toBe(antes.delivery_fee_cents);
    expect(depois.total_cents).toBe(antes.total_cents);
  });

  it("mudar para uma zona com outra taxa é recusado — e nada muda", async () => {
    const orderId = await encomenda("delivery");

    const { error } = await alterar(caixa, orderId, {
      deliveryZoneId: zonaMaisCara,
      address: "Outra morada qualquer",
    });
    expect(error?.message).toContain("delivery_fee_would_change");

    const depois = await pedido(orderId);
    expect(depois.delivery_zone_id).toBe(zonaPedido);
    expect(depois.address).toBe("Av. Julius Nyerere 100");
  });

  it("não aceita uma zona de outra loja", async () => {
    const orderId = await encomenda("delivery");
    const { error } = await alterar(caixa, orderId, { deliveryZoneId: zonaMatola });
    expect(error?.message).toContain("invalid_delivery_zone");
  });

  it("não aceita morada vazia", async () => {
    const orderId = await encomenda("delivery");
    const { error } = await alterar(caixa, orderId, { address: "   " });
    expect(error?.message).toContain("address_required");
  });

  it("num levantamento não há morada para mudar", async () => {
    const orderId = await encomenda("pickup");
    const { error } = await alterar(caixa, orderId, { address: "Rua X" });
    expect(error?.message).toContain("not_a_delivery");
  });
});

describe("alterar pedido · hora", () => {
  it("o caixa muda a hora marcada, e volta a pôr 'agora'", async () => {
    const orderId = await encomenda("pickup");
    const hora = daquiA(2);

    const { data, error } = await alterar(caixa, orderId, { scheduledFor: hora });
    expect(error).toBeNull();
    expect((data as Resultado).changed).toEqual(["scheduled_for"]);
    expect(new Date((await pedido(orderId)).scheduled_for!).toISOString()).toBe(hora);

    const { error: agoraError } = await alterar(caixa, orderId, { scheduledFor: null });
    expect(agoraError).toBeNull();
    expect((await pedido(orderId)).scheduled_for).toBeNull();

    const { data: log } = await admin
      .from("event_log")
      .select("payload")
      .eq("order_id", orderId)
      .eq("type", "order.schedule_changed");
    expect(log).toHaveLength(2);
  });

  it("não aceita uma hora que já passou", async () => {
    const orderId = await encomenda("pickup");
    const { error } = await alterar(caixa, orderId, { scheduledFor: daquiA(-2) });
    expect(error?.message).toContain("scheduled_for_in_past");
  });

  it("repetir os mesmos valores não regista nada", async () => {
    const orderId = await encomenda("pickup");
    const { data, error } = await alterar(caixa, orderId, { scheduledFor: null });
    expect(error).toBeNull();
    expect((data as Resultado).changed).toEqual([]);

    const { data: log } = await admin
      .from("event_log")
      .select("id")
      .eq("order_id", orderId)
      .like("type", "order.%_changed");
    expect(log).toHaveLength(0);
  });
});

describe("alterar pedido · o papel acompanha", () => {
  it("com a comanda já impressa, sai uma via ALTERADO na cozinha com a morada nova", async () => {
    const orderId = await encomenda("delivery");
    const { error: aprovarError } = await caixa.rpc("advance_order", {
      p_order_id: orderId,
      p_event: "APPROVE",
    });
    expect(aprovarError).toBeNull();

    const pedidoId = randomUUID();
    const { data, error } = await alterar(
      caixa,
      orderId,
      { address: "Bairro Central, casa 12", scheduledFor: daquiA(3) },
      pedidoId,
    );
    expect(error).toBeNull();
    const r = data as Resultado;
    expect(r.changed.sort()).toEqual(["address", "scheduled_for"]);
    expect(r.reprinted).toBe(true);

    const vias = await trabalhosAlteracao(orderId);
    expect(vias).toHaveLength(1);
    expect(vias[0].station).toBe("kitchen");
    expect(vias[0].store_id).toBe(maputoStoreId);
    const payload = vias[0].payload as { address: string; alteracoes: string[]; scheduled_for: string };
    expect(payload.address).toBe("Bairro Central, casa 12");
    expect(payload.alteracoes.sort()).toEqual(["address", "scheduled_for"]);
    expect(payload.scheduled_for).toBeTruthy();

    // O mesmo toque outra vez (rede lenta, dedo nervoso): nada de segunda via.
    const { data: repetido, error: repetidoError } = await alterar(
      caixa,
      orderId,
      { address: "Bairro Central, casa 12" },
      pedidoId,
    );
    expect(repetidoError).toBeNull();
    expect((repetido as Resultado).duplicate).toBe(true);
    expect(await trabalhosAlteracao(orderId)).toHaveLength(1);
  });

  it("com o pedido pronto, a morada ainda muda mas a hora já não", async () => {
    const orderId = await encomenda("delivery");
    for (const evento of ["APPROVE", "START_PREPARATION", "MARK_READY"]) {
      const { error } = await caixa.rpc("advance_order", { p_order_id: orderId, p_event: evento });
      expect(error, evento).toBeNull();
    }

    const { error: moradaError } = await alterar(caixa, orderId, { address: "Rua pronta 1" });
    expect(moradaError).toBeNull();

    const { error: horaError } = await alterar(caixa, orderId, { scheduledFor: daquiA(2) });
    expect(horaError?.message).toContain("schedule_not_editable");
  });

  it("um pedido entregue já não se altera", async () => {
    const orderId = await encomenda("delivery");
    for (const evento of ["APPROVE", "START_PREPARATION", "MARK_READY", "DELIVER"]) {
      const { error } = await caixa.rpc("advance_order", { p_order_id: orderId, p_event: evento });
      expect(error, evento).toBeNull();
    }
    const { error } = await alterar(caixa, orderId, { address: "Tarde demais" });
    expect(error?.message).toContain("order_not_editable");
  });
});

describe("alterar pedido · quem pode", () => {
  it("a cozinha não altera pedidos", async () => {
    const orderId = await encomenda("delivery");
    const { error } = await alterar(cozinha, orderId, { address: "Rua da cozinha" });
    expect(error?.message).toContain("order_edit_access_denied");
  });

  it("o caixa da Matola não mexe num pedido de Maputo", async () => {
    const orderId = await encomenda("delivery");
    const { error } = await alterar(caixaMatola, orderId, { address: "Rua da Matola" });
    expect(error?.message).toContain("order_not_found_or_unauthorised");
    expect((await pedido(orderId)).address).toBe("Av. Julius Nyerere 100");
  });

  it("o anónimo não chega à função", async () => {
    const orderId = await encomenda("delivery");
    const { error } = await alterar(anon, orderId, { address: "Rua anónima" });
    expect(error).not.toBeNull();
    expect((await pedido(orderId)).address).toBe("Av. Julius Nyerere 100");
  });
});
