/**
 * Gate de integração da 1067 — definições do POS por loja.
 *
 * O que este ficheiro protege: as definições são por loja (Regra 3). Um
 * gerente da Matola não pode ler nem mudar o POS de Maputo, o operador do
 * balcão lê mas não escreve, e `anon` não toca em nada. Cada alteração fica
 * no `event_log` com quem a fez e o que mudou (§6).
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
let managerMatola: SupabaseClient;
let cashierMaputo: SupabaseClient;

let maputoId: string;
let matolaId: string;
let before: Array<{ store_id: string; config: unknown }> = [];

const createdUserIds: string[] = [];
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const PASSWORD = "Pos-1067-Teste-2026!";

async function createUser(
  label: string,
  role: "owner" | "manager" | "cashier",
  storeIds: string[],
): Promise<SupabaseClient> {
  const email = `pos-cfg-${label}-${suffix}@delivery.test`;
  const { data: user, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !user.user) throw new Error(`Setup POS: ${label} — ${error?.message}`);
  createdUserIds.push(user.user.id);

  const { error: profileError } = await admin.from("staff_profiles").insert({
    user_id: user.user.id,
    full_name: `Equipa POS ${label}`,
    role,
    active: true,
  });
  if (profileError) throw new Error(`Setup POS: perfil ${label} — ${profileError.message}`);

  if (storeIds.length > 0) {
    const { error: storeError } = await admin
      .from("staff_stores")
      .insert(storeIds.map((storeId) => ({ user_id: user.user!.id, store_id: storeId })));
    if (storeError) throw new Error(`Setup POS: acesso ${label} — ${storeError.message}`);
  }

  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: loginError } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (loginError) throw new Error(`Setup POS: login ${label} — ${loginError.message}`);
  return client;
}

beforeAll(async () => {
  admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  anon = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: stores, error } = await admin
    .from("stores")
    .select("id,slug")
    .in("slug", ["maputo", "matola"]);
  if (error || !stores || stores.length < 2) throw new Error(`Setup POS: lojas — ${error?.message}`);
  maputoId = stores.find((s) => s.slug === "maputo")!.id;
  matolaId = stores.find((s) => s.slug === "matola")!.id;

  // Guarda o que lá está para repor: corre contra a mesma base que os outros.
  const { data: atuais, error: readError } = await admin
    .from("store_pos_settings")
    .select("store_id,config")
    .in("store_id", [maputoId, matolaId]);
  // Falhar aqui é obrigatório: sem o estado real, o afterAll não repõe nada e
  // o teste deixa as lojas com as definições dele (aconteceu na 1ª corrida).
  if (readError) throw new Error(`Setup POS: ler definições — ${readError.message}`);
  before = atuais ?? [];

  owner = await createUser("dono", "owner", []);
  managerMatola = await createUser("gerente-matola", "manager", [matolaId]);
  cashierMaputo = await createUser("caixa-maputo", "cashier", [maputoId]);
});

afterAll(async () => {
  if (!admin) return;
  const { error: deleteError } = await admin
    .from("store_pos_settings")
    .delete()
    .in("store_id", [maputoId, matolaId]);
  if (deleteError) throw new Error(`Limpeza POS: ${deleteError.message}`);
  if (before.length > 0) {
    const { error: restoreError } = await admin.from("store_pos_settings").insert(before);
    if (restoreError) throw new Error(`Limpeza POS: repor — ${restoreError.message}`);
  }
  await admin
    .from("event_log")
    .delete()
    .eq("type", "store.pos_settings_changed")
    .in("actor_user_id", createdUserIds);
  for (const userId of createdUserIds) {
    await admin.auth.admin.deleteUser(userId);
  }
});

describe("1067 — definições do POS por loja", () => {
  it("anon não lê nem escreve", async () => {
    const direct = await anon.from("store_pos_settings").select("config");
    expect(direct.data ?? []).toEqual([]);

    const read = await anon.rpc("get_pos_settings", { p_store_id: maputoId });
    expect(read.error).not.toBeNull();

    const write = await anon.rpc("save_pos_settings", { p_store_id: maputoId, p_config: {} });
    expect(write.error).not.toBeNull();
  });

  it("o gerente da Matola não lê nem escreve o POS de Maputo", async () => {
    const read = await managerMatola.rpc("get_pos_settings", { p_store_id: maputoId });
    expect(read.error?.message ?? "").toContain("pos_settings_denied");

    const write = await managerMatola.rpc("save_pos_settings", {
      p_store_id: maputoId,
      p_config: { quickNotes: ["INVASOR"] },
    });
    expect(write.error?.message ?? "").toContain("pos_settings_denied");

    // Tem de ser a policy a esconder, não um erro de permissão a disfarçar.
    const direct = await managerMatola
      .from("store_pos_settings")
      .select("store_id")
      .eq("store_id", maputoId);
    expect(direct.error).toBeNull();
    expect(direct.data).toEqual([]);

    const propria = await managerMatola
      .from("store_pos_settings")
      .select("store_id")
      .eq("store_id", matolaId);
    expect(propria.error).toBeNull();
  });

  it("o gerente grava o POS da sua loja e fica registado quem mudou o quê", async () => {
    const saved = await managerMatola.rpc("save_pos_settings", {
      p_store_id: matolaId,
      p_config: { quickNotes: ["SEM SAL"], sale: { confirmationSeconds: 5 } },
    });
    expect(saved.error).toBeNull();
    expect((saved.data as { config: { quickNotes: string[] } }).config.quickNotes).toEqual(["SEM SAL"]);

    const { data: log } = await admin
      .from("event_log")
      .select("store_id,payload")
      .eq("type", "store.pos_settings_changed")
      .in("actor_user_id", createdUserIds)
      .order("created_at", { ascending: false })
      .limit(1);
    expect(log?.[0]?.store_id).toBe(matolaId);
    expect((log?.[0]?.payload as { changed: string[] }).changed).toContain("quickNotes");
  });

  it("o operador do balcão lê as definições da sua loja mas não as muda", async () => {
    const read = await cashierMaputo.rpc("get_pos_settings", { p_store_id: maputoId });
    expect(read.error).toBeNull();

    const write = await cashierMaputo.rpc("save_pos_settings", {
      p_store_id: maputoId,
      p_config: { quickNotes: ["CAIXA A MANDAR"] },
    });
    expect(write.error?.message ?? "").toContain("pos_settings_denied");

    const direct = await cashierMaputo
      .from("store_pos_settings")
      .upsert({ store_id: maputoId, config: {} });
    expect(direct.error).not.toBeNull();
  });

  it("o dono grava em qualquer loja e o payload tem de ser um objecto", async () => {
    const ok = await owner.rpc("save_pos_settings", { p_store_id: maputoId, p_config: { quickNotes: [] } });
    expect(ok.error).toBeNull();

    const bad = await owner.rpc("save_pos_settings", { p_store_id: maputoId, p_config: ["lista"] });
    expect(bad.error?.message ?? "").toContain("invalid_payload");
  });
});
