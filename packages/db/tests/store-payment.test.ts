/**
 * Gate de integração da 1044 — configurar o pagamento da loja pelo painel.
 *
 * Duas coisas a proteger, e a segunda é a que se esquece:
 *
 * 1. **Só o dono escreve.** Quem configura para onde vai o dinheiro decide
 *    quem o recebe.
 * 2. **Um segredo que entra nunca mais sai.** Não há leitura de credenciais —
 *    nem para o dono, nem no `event_log`. Um painel capaz de mostrar a chave
 *    é uma fuga à espera de acontecer.
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

let admin: SupabaseClient;
let anon: SupabaseClient;
let owner: SupabaseClient;
let manager: SupabaseClient;
let storeId: string;

const createdUserIds: string[] = [];
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const PASSWORD = "Pagamento-1044-Teste-2026!";
const SEGREDO = "SEGREDO_QUE_NUNCA_DEVE_SAIR_1044";

async function createUser(label: string, role: "owner" | "manager"): Promise<SupabaseClient> {
  const email = `pagamento-${label}-${suffix}@delivery.test`;
  const { data: user, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !user.user) throw new Error(`Setup 1044: ${label} — ${error?.message}`);
  createdUserIds.push(user.user.id);

  await admin.from("staff_profiles").insert({
    user_id: user.user.id,
    full_name: `Equipa ${label}`,
    role,
    active: true,
  });
  if (role !== "owner") {
    await admin.from("staff_stores").insert({ user_id: user.user.id, store_id: storeId });
  }

  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: loginError } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (loginError) throw new Error(`Setup 1044: login ${label} — ${loginError.message}`);
  return client;
}

beforeAll(async () => {
  admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  anon = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: stores, error } = await admin.from("stores").select("id").limit(1);
  if (error || !stores?.length) throw new Error(`Setup 1044: lojas — ${error?.message}`);
  storeId = stores[0].id;

  owner = await createUser("dono", "owner");
  manager = await createUser("gerente", "manager");
});

afterAll(async () => {
  if (!admin) return;
  await admin
    .from("stores")
    .update({
      payment_provider: "manual",
      mpesa_api_key: null,
      mpesa_public_key: null,
      mpesa_service_provider_code: null,
      mpesa_session_base_url: null,
      mpesa_charge_base_url: null,
      mpesa_query_base_url: null,
    })
    .eq("id", storeId);
  await admin.from("event_log").delete().eq("type", "store.payment_changed");
  for (const userId of createdUserIds) await admin.auth.admin.deleteUser(userId);
});

describe("1044 — pagamento da loja pelo painel", () => {
  it("recusa a quem não é dono, e a anon", async () => {
    const doGerente = await manager.rpc("save_store_payment", {
      p_store_id: storeId,
      p_payload: { payment_provider: "mpesa" },
    });
    expect(doGerente.error?.message ?? "").toContain("forbidden");

    const leituraGerente = await manager.rpc("get_store_payment_status", { p_store_id: storeId });
    expect(leituraGerente.error?.message ?? "").toContain("forbidden");

    const deAnon = await anon.rpc("save_store_payment", {
      p_store_id: storeId,
      p_payload: { payment_provider: "mpesa" },
    });
    expect(deAnon.error).not.toBeNull();
  });

  it("o dono grava, e o que volta diz o que está preenchido — nunca o valor", async () => {
    const gravado = await owner.rpc("save_store_payment", {
      p_store_id: storeId,
      p_payload: {
        payment_provider: "mpesa",
        mpesa_api_key: SEGREDO,
        mpesa_public_key: "chave-publica",
        mpesa_service_provider_code: "171717",
      },
    });

    expect(gravado.error).toBeNull();
    expect(gravado.data.payment_provider).toBe("mpesa");
    expect(gravado.data.mpesa.api_key).toBe(true);
    expect(gravado.data.mpesa.charge_base_url).toBe(false);

    // O segredo não pode estar em lado nenhum do que voltou.
    expect(JSON.stringify(gravado.data)).not.toContain(SEGREDO);

    const lido = await owner.rpc("get_store_payment_status", { p_store_id: storeId });
    expect(JSON.stringify(lido.data)).not.toContain(SEGREDO);
  });

  it("o segredo também não fica no registo de auditoria", async () => {
    // Um event_log com uma chave de API dentro é a mesma fuga, noutro sítio.
    const { data: eventos } = await admin
      .from("event_log")
      .select("payload")
      .eq("type", "store.payment_changed")
      .order("id", { ascending: false })
      .limit(3);

    expect(JSON.stringify(eventos ?? [])).not.toContain(SEGREDO);
    expect(JSON.stringify(eventos ?? [])).toContain("mpesa_api_key");
  });

  it("nem o dono autenticado lê as colunas de segredo directamente", async () => {
    const { data, error } = await owner.from("stores").select("mpesa_api_key").eq("id", storeId);
    // Ou a coluna é recusada, ou não vem — o que não pode é devolver o valor.
    expect(error !== null || JSON.stringify(data ?? []) === "[]" || !JSON.stringify(data).includes(SEGREDO)).toBe(true);
    expect(JSON.stringify(data ?? [])).not.toContain(SEGREDO);
  });

  it("campo ausente não mexe; string vazia apaga", async () => {
    await owner.rpc("save_store_payment", {
      p_store_id: storeId,
      p_payload: { mpesa_charge_base_url: "https://exemplo:1002" },
    });

    const semMexer = await owner.rpc("save_store_payment", {
      p_store_id: storeId,
      p_payload: { mpesa_public_key: "outra-chave" },
    });
    expect(semMexer.data.mpesa.charge_base_url).toBe(true);

    // Sem isto não haveria como tirar uma credencial errada sem ir à BD.
    const apagado = await owner.rpc("save_store_payment", {
      p_store_id: storeId,
      p_payload: { mpesa_charge_base_url: "" },
    });
    expect(apagado.data.mpesa.charge_base_url).toBe(false);
  });

  it("recusa um provider que não existe", async () => {
    const { error } = await owner.rpc("save_store_payment", {
      p_store_id: storeId,
      p_payload: { payment_provider: "bitcoin" },
    });
    expect(error?.message ?? "").toContain("invalid_payment_provider");
  });
});
