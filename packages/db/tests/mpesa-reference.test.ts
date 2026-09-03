/**
 * Gate de integração da 1043 — a referência de pagamento do M-Pesa.
 *
 * É a peça que impede a dupla cobrança, e por isso é testada contra a base de
 * dados a sério e não só em memória. A regra que aqui se fixa:
 *
 *   **A referência só muda quando temos a certeza de que a tentativa anterior
 *   não levou dinheiro.**
 *
 * Chamar outra vez sem rodar tem de devolver exactamente a mesma referência —
 * é isso que faz o M-Pesa recusar a repetição como duplicada em vez de cobrar
 * segunda vez.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://localhost:54731";
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz";

const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";

let admin: SupabaseClient;
let anon: SupabaseClient;
let storeSlug: string;
let menuItemId: string;
const createdOrderIds: string[] = [];

/** Pelo caminho a sério: `create_order`, como a loja o faz. */
async function criarPedido(): Promise<string> {
  const { data: orderId, error } = await anon.rpc("create_order", {
    p_store_slug: storeSlug,
    p_payload: {
      items: [{ menuItemId, qty: 1 }],
      customerName: "Teste M-Pesa",
      customerPhone: "841234567",
      fulfillmentType: "pickup",
      paymentMethod: "mpesa",
      flow: "digital",
    },
  });
  if (error || !orderId) throw new Error(`Setup 1043: pedido — ${error?.message}`);
  createdOrderIds.push(orderId as string);
  return orderId as string;
}

beforeAll(async () => {
  admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  anon = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: stores, error } = await admin.from("stores").select("slug").limit(1);
  if (error || !stores?.length) throw new Error(`Setup 1043: lojas — ${error?.message}`);
  storeSlug = stores[0].slug;

  const { data: items } = await admin.from("menu_items").select("id").limit(1);
  if (!items?.length) throw new Error("Setup 1043: sem itens de cardápio");
  menuItemId = items[0].id;
});

afterAll(async () => {
  if (!admin) return;
  for (const id of createdOrderIds) {
    await admin.from("event_log").delete().eq("order_id", id);
    await admin.from("orders").delete().eq("id", id);
  }
});

describe("1043 — referência de pagamento", () => {
  it("devolve sempre a mesma referência enquanto não se mandar rodar", async () => {
    const orderId = await criarPedido();

    const primeira = await admin.rpc("ensure_payment_reference", { p_order_id: orderId });
    const segunda = await admin.rpc("ensure_payment_reference", { p_order_id: orderId });
    const terceira = await admin.rpc("ensure_payment_reference", {
      p_order_id: orderId,
      p_rotate: false,
    });

    expect(primeira.error).toBeNull();
    expect(primeira.data).toBeTruthy();
    // Um duplo clique, um retry automático e uma reconciliação repetem a MESMA
    // tentativa. Se a referência mudasse, seria uma cobrança nova.
    expect(segunda.data).toBe(primeira.data);
    expect(terceira.data).toBe(primeira.data);
  });

  it("cabe nos 20 caracteres que o M-Pesa aceita, e é alfanumérica", async () => {
    const orderId = await criarPedido();
    const { data } = await admin.rpc("ensure_payment_reference", { p_order_id: orderId });

    expect(String(data).length).toBeLessThanOrEqual(20);
    expect(String(data)).toMatch(/^[A-Z0-9]+$/);
  });

  it("roda quando se pede — e só então", async () => {
    const orderId = await criarPedido();
    const antes = await admin.rpc("ensure_payment_reference", { p_order_id: orderId });
    const depois = await admin.rpc("ensure_payment_reference", {
      p_order_id: orderId,
      p_rotate: true,
    });

    // Rodar é o que permite ao cliente que cancelou tentar outra vez: com a
    // referência antiga, o M-Pesa recusaria a segunda tentativa.
    expect(depois.data).not.toBe(antes.data);
    expect(String(depois.data).length).toBeLessThanOrEqual(20);
  });

  it("cada pedido tem a sua — duas encomendas nunca partilham referência", async () => {
    const [a, b] = [await criarPedido(), await criarPedido()];
    const refA = await admin.rpc("ensure_payment_reference", { p_order_id: a });
    const refB = await admin.rpc("ensure_payment_reference", { p_order_id: b });

    expect(refA.data).not.toBe(refB.data);
  });

  it("põe um tecto nas tentativas em vez de deixar insistir para sempre", async () => {
    const orderId = await criarPedido();
    let ultimoErro: string | null = null;

    for (let i = 0; i < 12; i += 1) {
      const { error } = await admin.rpc("ensure_payment_reference", {
        p_order_id: orderId,
        p_rotate: true,
      });
      if (error) {
        ultimoErro = error.message;
        break;
      }
    }

    // Alguém a insistir doze vezes não é um cliente com dificuldades — é um
    // problema que ninguém está a olhar.
    expect(ultimoErro).toContain("too_many_payment_attempts");
  });

  it("recusa um pedido que não existe, em vez de inventar uma referência", async () => {
    const { error } = await admin.rpc("ensure_payment_reference", {
      p_order_id: "00000000-0000-0000-0000-000000000000",
    });
    expect(error?.message ?? "").toContain("order_not_found");
  });
});
