/**
 * Gate de integração da 1040 — a marca em runtime.
 *
 * O que este ficheiro protege: a identidade passou a ser dado, e dado que a
 * loja pública lê. Se `anon` conseguir escrever aqui, qualquer pessoa muda o
 * nome e o número de WhatsApp da montra de um restaurante. Se `get_brand()`
 * devolver segredo ou o gerente conseguir escrever, é o mesmo problema mais
 * pequeno. Por isso o perfil é testado, não assumido (CLAUDE.md §11.4).
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

let maputoStoreId: string;
let brandBefore: Record<string, unknown> | null = null;

const createdUserIds: string[] = [];
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const PASSWORD = "Marca-1040-Teste-2026!";
// Nome único por corrida: o `changed` do event_log só lista o que MUDOU, e um
// nome fixo deixava o teste a depender de a corrida anterior não o ter posto lá.
const NOME_TESTE = `Marca de Teste ${suffix.slice(0, 12)}`;

async function createUser(
  label: string,
  role: "owner" | "manager",
  storeIds: string[],
): Promise<SupabaseClient> {
  const email = `marca-${label}-${suffix}@delivery.test`;
  const { data: user, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !user.user) throw new Error(`Setup marca: ${label} — ${error?.message}`);
  createdUserIds.push(user.user.id);

  const { error: profileError } = await admin.from("staff_profiles").insert({
    user_id: user.user.id,
    full_name: `Equipa Marca ${label}`,
    role,
    active: true,
  });
  if (profileError) throw new Error(`Setup marca: perfil ${label} — ${profileError.message}`);

  if (storeIds.length > 0) {
    const { error: storeError } = await admin
      .from("staff_stores")
      .insert(storeIds.map((storeId) => ({ user_id: user.user!.id, store_id: storeId })));
    if (storeError) throw new Error(`Setup marca: acesso ${label} — ${storeError.message}`);
  }

  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: loginError } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (loginError) throw new Error(`Setup marca: login ${label} — ${loginError.message}`);
  return client;
}

beforeAll(async () => {
  admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  anon = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: stores, error } = await admin.from("stores").select("id,slug").eq("slug", "maputo");
  if (error || !stores?.length) throw new Error(`Setup marca: lojas — ${error?.message}`);
  maputoStoreId = stores[0].id;

  // Guarda o estado real para o repor no fim: este teste corre contra a mesma
  // base que os outros e não pode deixar a marca trocada atrás de si.
  const { data: current } = await admin.from("brand_settings").select("*").eq("id", 1).maybeSingle();
  brandBefore = current ?? null;

  owner = await createUser("dono", "owner", []);
  manager = await createUser("gerente", "manager", [maputoStoreId]);
});

afterAll(async () => {
  if (!admin) return;
  await admin.from("event_log").delete().eq("type", "brand.updated").in("actor_user_id", createdUserIds);
  if (brandBefore) {
    await admin.from("brand_settings").upsert(brandBefore);
  } else {
    await admin.from("brand_settings").delete().eq("id", 1);
  }
  for (const userId of createdUserIds) {
    await admin.auth.admin.deleteUser(userId);
  }
});

describe("1040 — marca em runtime", () => {
  it("não deixa anon ler nem escrever a tabela, mas responde por get_brand()", async () => {
    const direct = await anon.from("brand_settings").select("name");
    expect(direct.data ?? []).toEqual([]);

    const write = await anon.from("brand_settings").upsert({ id: 1, name: "Invasor" });
    expect(write.error).not.toBeNull();

    const rpc = await anon.rpc("update_brand", { p_patch: { name: "Invasor" } });
    expect(rpc.error).not.toBeNull();

    // A porta pública existe e não rebenta — mesmo sem linha nenhuma.
    const read = await anon.rpc("get_brand");
    expect(read.error).toBeNull();
  });

  it("recusa a escrita a quem não é dono", async () => {
    const denied = await manager.rpc("update_brand", { p_patch: { name: "Gerente a mandar" } });
    expect(denied.error?.message ?? "").toContain("forbidden");
  });

  it("deixa o dono gravar, devolve o resultado e regista quem mudou o quê", async () => {
    const saved = await owner.rpc("update_brand", {
      p_patch: {
        name: NOME_TESTE,
        tagline: "Tagline de teste",
        theme: { gold: "#123456" },
        social: { instagram: "https://instagram.com/teste" },
      },
    });
    expect(saved.error).toBeNull();
    expect(saved.data).toMatchObject({ name: NOME_TESTE, tagline: "Tagline de teste" });

    const publicRead = await anon.rpc("get_brand");
    expect(publicRead.data).toMatchObject({ name: NOME_TESTE });
    // Segredo nenhum sai por aqui, e nem sequer quem gravou.
    expect(Object.keys(publicRead.data as object)).not.toContain("updated_by");

    const { data: events } = await admin
      .from("event_log")
      .select("type,store_id,actor_user_id,payload")
      .eq("type", "brand.updated")
      .order("id", { ascending: false })
      .limit(1);
    expect(events?.[0]).toMatchObject({ type: "brand.updated", store_id: null });
    expect(events?.[0]?.payload?.changed).toContain("name");
  });

  it("patch parcial não apaga o que não veio", async () => {
    await owner.rpc("update_brand", {
      p_patch: { name: NOME_TESTE, tagline: "Fica", theme: { gold: "#abcdef" } },
    });
    const partial = await owner.rpc("update_brand", { p_patch: { tagline: "Mudou" } });

    expect(partial.error).toBeNull();
    expect(partial.data).toMatchObject({
      name: NOME_TESTE,
      tagline: "Mudou",
      theme: { gold: "#abcdef" },
    });
  });
});
