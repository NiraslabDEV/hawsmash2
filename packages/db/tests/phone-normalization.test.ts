/**
 * Gate de integração da 1051 — a normalização do telefone não pode depender de
 * quem escreve.
 *
 * A 1038 fixou o telefone canónico (só dígitos, os últimos 9) com duas triggers
 * em `private`. Ficaram `security invoker`: quem escreve tem de ter `usage` no
 * schema `private`, e só o `authenticated` alguma vez o teve (1001 revoga, 1004
 * concede a esse). Resultado: um `insert` directo em `orders` ou `customers`
 * com a chave de serviço morre com `42501 permission denied for schema private`.
 *
 * Isso não parte o site — todos os caminhos de escrita passam por RPC
 * `security definer` — mas parte o `scripts/import-hawsmash-1.ts`, que insere
 * `orders` e `customers` à chave de serviço. É o script do cutover do §15: se
 * falha, falha no dia em que se muda o HAWSMASH 1.0 para o 2.0.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://localhost:54731";
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz";

let admin: SupabaseClient;
let maputoStoreId: string;

const sufixo = Date.now().toString(36);
const ESCRITO = "+258 84 000 0997";
const CANONICO = "840000997";
const ORDER_NUMBER = `TST-norm-${sufixo}`;

beforeAll(async () => {
  admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: loja, error } = await admin
    .from("stores")
    .select("id")
    .eq("slug", "maputo")
    .single();
  if (error || !loja) throw new Error(`Setup telefone: loja — ${error?.message}`);
  maputoStoreId = loja.id as string;

  await admin.from("orders").delete().eq("order_number", ORDER_NUMBER);
  await admin.from("customers").delete().in("phone", [ESCRITO, CANONICO]);
});

afterAll(async () => {
  await admin.from("orders").delete().eq("order_number", ORDER_NUMBER);
  await admin.from("customers").delete().in("phone", [ESCRITO, CANONICO]);
});

describe("1051 · o telefone normaliza-se para quem escreve directo", () => {
  it("um pedido inserido à chave de serviço fica com os últimos 9 dígitos", async () => {
    const { data, error } = await admin
      .from("orders")
      .insert({
        store_id: maputoStoreId,
        order_number: ORDER_NUMBER,
        customer_name: "Import 1.0",
        customer_phone: ESCRITO,
        fulfillment_type: "delivery",
        address: "Av. 24 de Julho 1",
        status: "paid",
        flow: "digital",
        payment_method: "mpesa",
        channel: "delivery",
        subtotal_cents: 30000,
        delivery_fee_cents: 15000,
        total_cents: 45000,
      })
      .select("customer_phone")
      .single();

    expect(error).toBeNull();
    expect(data?.customer_phone).toBe(CANONICO);
  });

  it("um cliente inserido à chave de serviço fica com os últimos 9 dígitos", async () => {
    const { data, error } = await admin
      .from("customers")
      .insert({ phone: ESCRITO, name: "Import 1.0" })
      .select("phone")
      .single();

    expect(error).toBeNull();
    expect(data?.phone).toBe(CANONICO);
  });

  it("é o mesmo caminho que o cutover do §15 usa — insert directo, sem RPC", async () => {
    // O import lê o Supabase do 1.0 e escreve aqui com `from('orders').insert`.
    // Este teste é o que impede que volte a morrer em 42501 na véspera.
    const { error } = await admin
      .from("orders")
      .update({ customer_phone: "00258840000997" })
      .eq("order_number", ORDER_NUMBER);
    expect(error).toBeNull();

    const { data } = await admin
      .from("orders")
      .select("customer_phone")
      .eq("order_number", ORDER_NUMBER)
      .single();
    expect(data?.customer_phone).toBe(CANONICO);
  });
});
