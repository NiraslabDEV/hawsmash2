/**
 * Isolamento entre "equipa" e "qualquer sessao autenticada".
 *
 * O sistema so tem um tipo de login hoje — o da equipa — o que faz com que
 * `to authenticated using (true)` pareca inofensivo: os dois conjuntos
 * coincidem. Deixam de coincidir no dia em que existir conta de cliente
 * (login social ou nao), porque a sessao do cliente chega ao Postgres com o
 * mesmo papel `authenticated`. Foi assim que `ingredients` e `recipe_items`
 * ficaram abertas na 1024 (corrigido pela 1031).
 *
 * Este ficheiro fecha a porta de duas maneiras:
 *   (a) estrutural — nenhuma policy de `authenticated` pode ser `using (true)`;
 *   (b) comportamental — um utilizador autenticado SEM `staff_profile` nao le
 *       o catalogo de ingredientes, a ficha tecnica, nem o `list_recipes()`.
 *
 * Requer `supabase start` + `pnpm db:migrate`.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://localhost:54731";

// Chaves padrao do Supabase local — sem segredo real, seguras para commitar
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz";

let admin: SupabaseClient;
let cliente: SupabaseClient;   // autenticado, sem staff_profile
let owner: SupabaseClient;     // controlo: o painel tem de continuar a funcionar
const testUserIds: string[] = [];

async function createUser(email: string, staffRole: "owner" | null): Promise<SupabaseClient> {
  const password = "Rls-Permissive-2026!";
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !created.user) throw new Error(`Setup: ${email} — ${error?.message}`);
  testUserIds.push(created.user.id);

  if (staffRole) {
    const { error: profileError } = await admin.from("staff_profiles").insert({
      user_id: created.user.id,
      full_name: `Teste ${staffRole}`,
      role: staffRole,
      active: true,
    });
    if (profileError) throw new Error(`Setup: staff_profile — ${profileError.message}`);
  }

  const client = createClient(SUPABASE_URL, ANON_KEY);
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`Setup: login ${email} — ${signInError.message}`);
  return client;
}

beforeAll(async () => {
  admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  cliente = await createUser(`cliente-${suffix}@delivery.test`, null);
  owner = await createUser(`owner-perm-${suffix}@delivery.test`, "owner");
});

afterAll(async () => {
  for (const id of testUserIds) {
    await admin.auth.admin.deleteUser(id);
  }
});

describe("policies permissivas", () => {
  it("nenhuma policy de authenticated e `using (true)`", async () => {
    const { data, error } = await admin.rpc("audit_permissive_policies");
    expect(error).toBeNull();
    // Mensagem util no CI: diz logo qual tabela e policy reabriram a porta.
    expect(data ?? []).toEqual([]);
  });
});

describe("autenticado sem perfil de equipa", () => {
  it("nao le o catalogo de ingredientes (custo da casa)", async () => {
    const { data, error } = await cliente.from("ingredients").select("id, name, cost_cents");
    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });

  it("nao le a ficha tecnica", async () => {
    const { data, error } = await cliente.from("recipe_items").select("id, menu_item_id, qty");
    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });

  it("nao contorna a RLS por `list_recipes()`", async () => {
    const { data, error } = await cliente.rpc("list_recipes");
    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });

  it("nao chama a funcao de auditoria", async () => {
    const { error } = await cliente.rpc("audit_permissive_policies");
    expect(error).not.toBeNull();
  });
});

describe("o painel continua a funcionar", () => {
  it("owner le ingredientes e a ficha tecnica", async () => {
    const { data: ings, error: ingsError } = await owner
      .from("ingredients")
      .select("id, name, cost_cents");
    expect(ingsError).toBeNull();
    expect((ings ?? []).length).toBeGreaterThan(0);

    const { data: recipes, error: recipesError } = await owner.rpc("list_recipes");
    expect(recipesError).toBeNull();
    expect(Array.isArray(recipes)).toBe(true);
    expect((recipes as unknown[]).length).toBeGreaterThan(0);
  });
});
