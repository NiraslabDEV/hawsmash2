/**
 * Gate do quadro de pedidos do POS — o que o caixa tem de conseguir fazer
 * sozinho, sem sair do balcão e sem chamar o dono.
 *
 * O pedido é o do §13 visto do outro lado: chega uma encomenda pela internet,
 * o cliente anexou o comprovativo do M-Pesa, e quem está ao balcão tem de
 * **ver esse comprovativo** e **aprovar** — e a comanda tem de sair na cozinha.
 *
 * O que isto protege, e que falhou a sério: o quadro lia os pedidos por ordem
 * de entrada com um tecto de 120 linhas. Com 355 pedidos activos na loja, o
 * tecto cortava pelo lado errado — o caixa via os 120 mais **antigos** e a
 * encomenda que acabava de entrar não aparecia em lado nenhum. Sem erro, sem
 * aviso: um quadro cheio de pedidos velhos e o do cliente que está à espera
 * invisível. Por isso o primeiro teste aqui cria um pedido e exige vê-lo.
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

/** As mesmas colunas e o mesmo tecto que o quadro do POS usa. */
const SELECT =
  "id,daily_number,order_number,status,channel,fulfillment_type," +
  "customer_name,customer_phone,total_cents,scheduled_for,created_at," +
  "payment_method,payment_proof_path,flow,address,delivery_zone_id,delivery_fee_cents";
const ACTIVE = [
  "awaiting_approval",
  "awaiting_payment",
  "approved",
  "paid",
  "in_preparation",
  "ready",
];
const LIMITE = 120;

let admin: SupabaseClient;
let anon: SupabaseClient;
let caixa: SupabaseClient;
let maputoStoreId: string;
let orderId: string;
let proofPath: string;

const sufixo = `${Date.now()}`;
const PASSWORD = "Quadro-POS-Teste-2026!";
const TELEFONE = `84${sufixo.slice(-7)}`;
const NOME = `Quadro POS ${sufixo}`;
const criados: string[] = [];

/** PNG de 1×1 — é o que o cliente carrega no checkout, em ponto pequeno. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

beforeAll(async () => {
  admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  anon = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: loja, error: lojaError } = await admin
    .from("stores")
    .select("id")
    .eq("slug", "maputo")
    .single();
  if (lojaError || !loja) throw new Error(`Setup quadro: loja — ${lojaError?.message}`);
  maputoStoreId = loja.id as string;

  // O caixa é quem este teste representa: perfil mais baixo que mexe em pedidos.
  const email = `quadro-caixa-${sufixo}@delivery.test`;
  const { data: user, error: userError } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (userError || !user.user) throw new Error(`Setup quadro: conta — ${userError?.message}`);
  criados.push(user.user.id);
  await admin
    .from("staff_profiles")
    .insert({ user_id: user.user.id, full_name: "Caixa do quadro", role: "cashier", active: true });
  await admin.from("staff_stores").insert({ user_id: user.user.id, store_id: maputoStoreId });

  caixa = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: loginError } = await caixa.auth.signInWithPassword({ email, password: PASSWORD });
  if (loginError) throw new Error(`Setup quadro: sessão — ${loginError.message}`);

  // A encomenda entra pelo caminho público, como a de um cliente a sério.
  const { data: menu } = await anon.rpc("get_menu", { p_store_slug: "maputo" });
  const item = (menu as { categories: Array<{ items: Array<{ id: string; available: boolean }> }> })
    .categories.flatMap((c) => c.items)
    .find((i) => i.available);
  if (!item) throw new Error("Setup quadro: a loja não tem nenhum item disponível");

  const { data: novoId, error: orderError } = await anon.rpc("create_order", {
    p_store_slug: "maputo",
    p_payload: {
      items: [{ menuItemId: item.id, qty: 1 }],
      customerName: NOME,
      customerPhone: TELEFONE,
      fulfillmentType: "pickup",
      paymentMethod: "mpesa",
    },
  });
  if (orderError) throw new Error(`Setup quadro: create_order — ${orderError.message}`);
  orderId = novoId as string;

  // Comprovativo: o anónimo só tem INSERT no bucket, por isso nada de upsert.
  proofPath = `${orderId}/comprovativo-${sufixo}.png`;
  const { error: upError } = await anon.storage
    .from("payment-proofs")
    .upload(proofPath, PNG, { contentType: "image/png" });
  if (upError) throw new Error(`Setup quadro: upload — ${upError.message}`);
  const { error: attachError } = await anon.rpc("attach_payment_proof", {
    p_order_id: orderId,
    p_path: proofPath,
  });
  if (attachError) throw new Error(`Setup quadro: anexar — ${attachError.message}`);
}, 90_000);

afterAll(async () => {
  if (!admin) return;
  if (orderId) {
    await admin.storage.from("payment-proofs").remove([proofPath]);
    await admin.from("print_jobs").delete().eq("order_id", orderId);
    await admin.from("event_log").delete().eq("order_id", orderId);
    await admin.from("order_items").delete().eq("order_id", orderId);
    await admin.from("orders").delete().eq("id", orderId);
  }
  await admin.from("customers").delete().eq("phone", TELEFONE);
  for (const userId of criados) {
    await admin.from("staff_stores").delete().eq("user_id", userId);
    await admin.from("staff_profiles").delete().eq("user_id", userId);
    await admin.auth.admin.deleteUser(userId);
  }
});

describe("quadro do POS · o pedido que vem da internet", () => {
  it("aparece ao caixa mesmo com a loja cheia de pedidos activos", async () => {
    const { data, error } = await caixa
      .from("orders")
      .select(SELECT)
      .eq("store_id", maputoStoreId)
      .in("status", ACTIVE)
      .order("created_at", { ascending: false })
      .limit(LIMITE);

    expect(error).toBeNull();
    const encontrado = (data ?? []).find((o) => o.id === orderId);
    expect(encontrado, "a encomenda acabada de entrar tem de caber na janela do quadro").toBeTruthy();
    expect(encontrado!.status).toBe("awaiting_approval");
  });

  it("traz o que o caixa precisa para decidir: forma de pagamento e comprovativo", async () => {
    const { data } = await caixa.from("orders").select(SELECT).eq("id", orderId).single();

    expect(data!.flow).toBe("manual");
    expect(data!.payment_method).toBe("mpesa");
    expect(data!.payment_proof_path).toBe(proofPath);
  });

  it("deixa o caixa abrir o comprovativo por url assinado", async () => {
    const { data, error } = await caixa.storage
      .from("payment-proofs")
      .createSignedUrl(proofPath, 3600);

    expect(error).toBeNull();
    expect(data?.signedUrl).toContain(proofPath.split("/").pop());
  });

  it("deixa o caixa ver os itens do pedido", async () => {
    const { data, error } = await caixa
      .from("order_items")
      .select("name_snapshot,qty,unit_price_cents")
      .eq("order_id", orderId);

    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0);
  });

  it("deixa o caixa aprovar — e é isso que manda a comanda para a cozinha", async () => {
    const { error } = await caixa.rpc("advance_order", {
      p_order_id: orderId,
      p_event: "APPROVE",
    });
    expect(error).toBeNull();

    const { data: depois } = await admin
      .from("orders")
      .select("status,store_id")
      .eq("id", orderId)
      .single();
    expect(depois!.status).toBe("approved");

    const { data: papel } = await admin
      .from("print_jobs")
      .select("station,kind,status,store_id,payload")
      .eq("order_id", orderId);

    const comanda = (papel ?? []).find((j) => j.kind === "order" && j.station === "kitchen");
    expect(comanda, "aprovar tem de deixar uma comanda na fila da cozinha").toBeTruthy();
    // A comanda é da loja do pedido — a bridge da outra loja ignora-a (regra 3).
    expect(comanda!.store_id).toBe(maputoStoreId);
    // E é a comanda HAWSMASH, a mesma do balcão — não o formato antigo (1062).
    expect((papel ?? []).every((j) => j.kind !== "order" || (j as { payload?: { template?: string } }).payload?.template === "kitchen")).toBe(true);
  });
});
