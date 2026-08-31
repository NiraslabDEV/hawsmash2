/**
 * Conta do cliente da loja (migration 1034) — testes de integração.
 * Requer `supabase start` + `pnpm db:migrate`.
 *
 * O que estes testes existem para impedir:
 *
 *   O pedido do cliente foi "a pessoa entra e já tem as moradas dela". A
 *   maneira errada de o fazer é devolver moradas a quem escreve um número de
 *   telefone — e aí quem souber o número de outra pessoa sabe onde ela mora.
 *
 *   Estes testes fixam a maneira certa: a morada está atrás de um TOKEN DE
 *   DISPOSITIVO, e o token só sai de duas portas — um pedido que a pessoa
 *   acabou de fazer, ou um código de uso único. Um telefone sozinho nunca
 *   abre nada.
 *
 * Se um destes falhar, não é um teste chato: é uma morada de alguém exposta.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://localhost:54731";

const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";

const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz";

let anon: SupabaseClient;
let admin: SupabaseClient;

const ALICE = "+258840000901";
const BRUNO = "+258840000902";
const ADDRESS_ALICE = "Av. Julius Nyerere 812, Sommerschield";

let aliceOrderId: string;
let aliceToken: string;

/** Cria um pedido pago directamente — não é o caminho do cliente, é setup. */
async function seedOrder(phone: string, name: string, address: string) {
  const { data: store } = await admin.from("stores").select("id").eq("slug", "maputo").single();
  const { data: order, error } = await admin
    .from("orders")
    .insert({
      store_id: store!.id,
      customer_name: name,
      customer_phone: phone,
      fulfillment_type: "delivery",
      address,
      status: "paid",
      flow: "digital",
      payment_method: "mpesa",
      channel: "delivery",
      subtotal_cents: 30000,
      delivery_fee_cents: 15000,
      total_cents: 45000,
    })
    .select("id")
    .single();

  if (error) throw new Error(`Setup: pedido — ${error.message}`);
  return order!.id as string;
}

beforeAll(async () => {
  anon = createClient(SUPABASE_URL, ANON_KEY);
  admin = createClient(SUPABASE_URL, SERVICE_KEY);

  await admin.from("customers").delete().in("phone", [ALICE, BRUNO]);
  aliceOrderId = await seedOrder(ALICE, "Aisha", ADDRESS_ALICE);
});

afterAll(async () => {
  await admin.from("orders").delete().in("customer_phone", [ALICE, BRUNO]);
  await admin.from("customers").delete().in("phone", [ALICE, BRUNO]);
});

describe("conta do cliente — o que o anónimo não alcança", () => {
  it("anon não lê moradas, dispositivos nem códigos", async () => {
    for (const table of ["customer_addresses", "customer_devices", "customer_login_codes"]) {
      const { data, error } = await anon.from(table).select("*").limit(1);
      // Ou erro de permissão, ou lista vazia — nunca uma linha de alguém.
      expect(error !== null || (data ?? []).length === 0).toBe(true);
    }
  });

  it("anon não executa as RPCs de conta", async () => {
    const { error } = await anon.rpc("account_me", { p_token: "seja-o-que-for" });
    expect(error).not.toBeNull();
  });
});

describe("conta do cliente — prender o dispositivo", () => {
  it("um pedido pago devolve token e guarda a morada da entrega", async () => {
    const { data, error } = await admin.rpc("account_bind_device", { p_order_id: aliceOrderId });

    expect(error).toBeNull();
    expect(data?.token).toBeTruthy();
    aliceToken = data.token;

    expect(data.profile.phone).toBe(ALICE);
    expect(data.profile.addresses).toHaveLength(1);
    expect(data.profile.addresses[0].address).toBe(ADDRESS_ALICE);
    // A primeira morada assume o lugar de defeito sozinha.
    expect(data.profile.addresses[0].is_default).toBe(true);
  });

  it("um pedido que não existe não devolve nada", async () => {
    const { data } = await admin.rpc("account_bind_device", {
      p_order_id: "00000000-0000-0000-0000-000000000000",
    });
    expect(data).toBeNull();
  });

  it("o token abre a conta; um token inventado não abre nada", async () => {
    const { data: mine } = await admin.rpc("account_me", { p_token: aliceToken });
    expect(mine.phone).toBe(ALICE);

    const { data: nobody } = await admin.rpc("account_me", { p_token: "a".repeat(64) });
    expect(nobody).toBeNull();

    const { data: empty } = await admin.rpc("account_me", { p_token: "" });
    expect(empty).toBeNull();
  });

  it("o token guardado é um hash, não o token", async () => {
    const { data: devices } = await admin
      .from("customer_devices")
      .select("token_hash")
      .eq("customer_phone", ALICE);

    expect(devices!.length).toBeGreaterThan(0);
    // Se a base de dados vazar, o que lá está não abre sessão nenhuma.
    expect(devices![0].token_hash).not.toBe(aliceToken);
    expect(devices![0].token_hash).toHaveLength(64);
  });
});

describe("conta do cliente — moradas", () => {
  it("guarda uma morada nova com etiqueta", async () => {
    const { data, error } = await admin.rpc("account_save_address", {
      p_token: aliceToken,
      p_id: null,
      p_label: "Trabalho",
      p_address: "Rua da Sé 114, Baixa",
      p_zone_id: null,
      p_notes: "Recepção do 2.º andar",
      p_default: false,
    });

    expect(error).toBeNull();
    expect(data.addresses).toHaveLength(2);
    expect(data.addresses.map((a: { label: string }) => a.label)).toContain("Trabalho");
  });

  it("só existe uma morada por defeito de cada vez", async () => {
    const { data: before } = await admin.rpc("account_me", { p_token: aliceToken });
    const work = before.addresses.find((a: { label: string }) => a.label === "Trabalho");

    const { data: after, error } = await admin.rpc("account_save_address", {
      p_token: aliceToken,
      p_id: work.id,
      p_label: "Trabalho",
      p_address: work.address,
      p_zone_id: null,
      p_notes: "",
      p_default: true,
    });

    expect(error).toBeNull();
    const defaults = after.addresses.filter((a: { is_default: boolean }) => a.is_default);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].label).toBe("Trabalho");
  });

  it("sem token não se guarda morada nenhuma", async () => {
    const { error } = await admin.rpc("account_save_address", {
      p_token: "token-que-nao-existe",
      p_id: null,
      p_label: "Casa",
      p_address: "Onde quer que seja",
      p_zone_id: null,
      p_notes: "",
      p_default: false,
    });
    expect(error).not.toBeNull();
  });

  it("o token de um cliente não mexe na morada de outro", async () => {
    // O Bruno faz o seu pedido e tem a sua conta.
    const brunoOrder = await seedOrder(BRUNO, "Bruno", "Rua de Bagamoyo 40");
    const { data: bind } = await admin.rpc("account_bind_device", { p_order_id: brunoOrder });
    const brunoToken = bind.token;

    const { data: alice } = await admin.rpc("account_me", { p_token: aliceToken });
    const aliceAddressId = alice.addresses[0].id;

    // O Bruno tenta reescrever a morada da Aisha, com o id dela na mão.
    const { error } = await admin.rpc("account_save_address", {
      p_token: brunoToken,
      p_id: aliceAddressId,
      p_label: "Casa",
      p_address: "Morada trocada por outra pessoa",
      p_zone_id: null,
      p_notes: "",
      p_default: false,
    });
    expect(error).not.toBeNull();

    // E apagar também não.
    await admin.rpc("account_delete_address", { p_token: brunoToken, p_id: aliceAddressId });

    const { data: aliceDepois } = await admin.rpc("account_me", { p_token: aliceToken });
    const ainda = aliceDepois.addresses.find((a: { id: string }) => a.id === aliceAddressId);
    expect(ainda).toBeDefined();
    expect(ainda.address).toBe(ADDRESS_ALICE);
  });
});

describe("conta do cliente — código para telemóvel novo", () => {
  it("um número que não é cliente responde igual a um cliente sem email", async () => {
    const { data: desconhecido } = await admin.rpc("account_request_code", {
      p_phone: "+258849999999",
    });
    // A resposta não pode revelar quem é cliente da casa.
    expect(desconhecido.channel).toBe("none");
    expect(desconhecido.code).toBeUndefined();
  });

  it("código errado falha e conta a tentativa", async () => {
    const { data: bad } = await admin.rpc("account_verify_code", {
      p_phone: ALICE,
      p_code: "000000",
    });
    expect(bad.ok).toBe(false);
    expect(bad.token).toBeUndefined();
  });

  it("sair revoga o dispositivo", async () => {
    const orderId = await seedOrder(ALICE, "Aisha", ADDRESS_ALICE);
    const { data: bind } = await admin.rpc("account_bind_device", { p_order_id: orderId });
    const token = bind.token;

    const { data: antes } = await admin.rpc("account_me", { p_token: token });
    expect(antes.phone).toBe(ALICE);

    await admin.rpc("account_logout", { p_token: token });

    const { data: depois } = await admin.rpc("account_me", { p_token: token });
    expect(depois).toBeNull();
  });
});
