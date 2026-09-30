/**
 * Gate da 1108 — reimprimir o fecho de um turno.
 *
 * Corre na Matola, como o gate da 1100: abre um turno, vende, fecha e
 * reimprime. Só apaga o que ele próprio cria, pelos ids. Recusa correr fora
 * de localhost: cria vendas e papel numa loja, e a base remota é a do LIVE.
 * Os mesmos cenários foram provados numa BD local (PGlite) antes do código.
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

const BASE_LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(SUPABASE_URL);

const sufixo = `${Date.now()}`;
const PASSWORD = "Reimprimir-1108-Teste-2026!";

let admin: SupabaseClient;
let anon: SupabaseClient;
let caixa: SupabaseClient;
let cozinha: SupabaseClient;
let matolaStoreId: string;
let deviceId: string;
let sessionId: string;
let ingredientesAntes: Array<{ ingredient_id: string; qty: number }> = [];
const criadosUsers: string[] = [];
const criadosPedidos: string[] = [];

async function conta(role: string): Promise<SupabaseClient> {
  const email = `reprint-turno-${role}-${sufixo}@delivery.test`;
  const { data: user, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error || !user.user) throw new Error(`Setup reimpressão do turno: conta ${role} — ${error?.message}`);
  criadosUsers.push(user.user.id);
  await admin.from("staff_profiles").insert({ user_id: user.user.id, full_name: `Teste ${role}`, role, active: true });
  await admin.from("staff_stores").insert({ user_id: user.user.id, store_id: matolaStoreId });
  const cliente = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: loginError } = await cliente.auth.signInWithPassword({ email, password: PASSWORD });
  if (loginError) throw new Error(`Setup reimpressão do turno: sessão ${role} — ${loginError.message}`);
  return cliente;
}

beforeAll(async () => {
  if (!BASE_LOCAL) throw new Error(`Recusado: ${SUPABASE_URL} não é uma base local.`);
  admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: loja } = await admin.from("stores").select("id").eq("slug", "matola").single();
  matolaStoreId = loja!.id as string;

  const { data: aberto } = await admin
    .from("cash_sessions").select("id").eq("store_id", matolaStoreId).is("closed_at", null).maybeSingle();
  if (aberto) throw new Error("Setup reimpressão do turno: a Matola tem um turno aberto — não corre por cima dele");

  const { data: ingredientes } = await admin
    .from("store_ingredients").select("ingredient_id,qty").eq("store_id", matolaStoreId);
  ingredientesAntes = (ingredientes ?? []) as Array<{ ingredient_id: string; qty: number }>;
  await admin.from("store_ingredients").update({ qty: 1000 }).eq("store_id", matolaStoreId);

  caixa = await conta("cashier");
  cozinha = await conta("kitchen");
  const { data: device } = await admin
    .from("devices")
    .insert({ store_id: matolaStoreId, kind: "pos", label: `POS reimpressão turno ${sufixo}`, device_key_hash: `reprint-turno-${sufixo}` })
    .select("id").single();
  deviceId = device!.id as string;

  const { data: menu } = await anon.rpc("get_menu", { p_store_slug: "matola" });
  const item = (menu as { categories: Array<{ items: Array<{ id: string; price_cents: number }> }> })
    .categories.flatMap((c) => c.items)[0];

  const abrir = await caixa.rpc("open_cash_session", { p_store: matolaStoreId, p_float: 0 });
  if (abrir.error) throw new Error(`Setup reimpressão do turno: abrir turno — ${abrir.error.message}`);
  const { data: venda, error: vendaError } = await caixa.rpc("create_counter_sale", {
    p_payload: {
      clientSaleId: crypto.randomUUID(), deviceId, items: [{ menuItemId: item.id, qty: 2 }],
      payments: [{ method: "cash", amountCents: item.price_cents * 2 }], cashReceivedCents: item.price_cents * 2,
    },
  });
  if (vendaError) throw new Error(`Setup reimpressão do turno: venda — ${vendaError.message}`);
  criadosPedidos.push(venda.order_id as string);

  const fecho = await caixa.rpc("close_cash_session", { p_store: matolaStoreId, p_counted: item.price_cents * 2, p_reason: "teste" });
  if (fecho.error) throw new Error(`Setup reimpressão do turno: fechar turno — ${fecho.error.message}`);
  sessionId = (fecho.data as { session_id: string }).session_id;
}, 120_000);

afterAll(async () => {
  if (!admin || !BASE_LOCAL) return;
  for (const linha of ingredientesAntes) {
    await admin.from("store_ingredients").update({ qty: linha.qty })
      .eq("store_id", matolaStoreId).eq("ingredient_id", linha.ingredient_id);
  }
  if (criadosPedidos.length > 0) {
    await admin.from("print_jobs").delete().in("order_id", criadosPedidos);
    await admin.from("event_log").delete().in("order_id", criadosPedidos);
    await admin.from("orders").delete().in("id", criadosPedidos);
  }
  if (sessionId) {
    await admin.from("print_jobs").delete().eq("kind", "cash_close").eq("payload->>session_id", sessionId);
    await admin.from("event_log").delete().eq("payload->>session_id", sessionId);
    await admin.from("cash_movements").delete().eq("session_id", sessionId);
    await admin.from("cash_sessions").delete().eq("id", sessionId);
  }
  await admin.from("event_log").delete().in("actor_user_id", criadosUsers);
  if (deviceId) await admin.from("devices").delete().eq("id", deviceId);
  for (const id of criadosUsers) {
    await admin.from("staff_stores").delete().eq("user_id", id);
    await admin.from("staff_profiles").delete().eq("user_id", id);
    await admin.auth.admin.deleteUser(id);
  }
});

describe("1108 · reimprimir o fecho do turno", () => {
  it("o caixa reimprime: um talão novo no balcão, marcado REIMPRESSÃO, com os artigos", async () => {
    const chave = crypto.randomUUID();
    const { data, error } = await caixa.rpc("reprint_cash_session", { p_session_id: sessionId, p_request_id: chave });
    expect(error).toBeNull();
    const { data: job } = await admin.from("print_jobs").select("station,reprint_seq,payload").eq("id", data.job_id).single();
    expect(job!.station).toBe("counter");
    expect(job!.reprint_seq).toBe(1);
    expect(job!.payload.reprint).toBe(true);
    expect(String(job!.payload.shift_label)).toMatch(/^REIMPRESSÃO - Turno/);
    expect(job!.payload.sold.items[0].qty).toBe(2);

    const repetido = await caixa.rpc("reprint_cash_session", { p_session_id: sessionId, p_request_id: chave });
    expect(repetido.data.duplicate).toBe(true);
    expect(repetido.data.job_id).toBe(data.job_id);
  });

  it("a cozinha não reimprime", async () => {
    const { error } = await cozinha.rpc("reprint_cash_session", { p_session_id: sessionId, p_request_id: crypto.randomUUID() });
    expect(error?.message).toContain("cash_access_denied");
  });

  it("anon não chega à função", async () => {
    const { error } = await anon.rpc("reprint_cash_session", { p_session_id: sessionId, p_request_id: crypto.randomUUID() });
    expect(error).not.toBeNull();
  });

  it("fica no event_log com quem reimprimiu", async () => {
    const { data } = await admin
      .from("event_log").select("actor_user_id").eq("type", "cash.session_close_reprinted").eq("payload->>session_id", sessionId);
    expect(data?.length).toBe(1);
    expect(data?.[0].actor_user_id).toBe(criadosUsers[0]);
  });
});
