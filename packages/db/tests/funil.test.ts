/**
 * Funil por origem (migration 1066) — contra Supabase local.
 * Requer `supabase start` + `pnpm db:migrate` antes de correr.
 *
 * O que isto tranca:
 *   (a) isolamento entre lojas — as views antigas eram SECURITY DEFINER e um
 *       gerente da Matola lia o funil de Maputo (regra 3 do CLAUDE.md);
 *   (b) quem pode ler: dono e gerente; caixa, cozinha e anon não;
 *   (c) a normalização dos anúncios do Meta no histórico já gravado;
 *   (d) eventos 'unknown' (antes do cookie de sessão) fora do funil.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://localhost:54731";
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ?? "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? "sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz";

/** Marca desta corrida: as campanhas de teste levam-na, a limpeza apaga por ela. */
const RUN = `funil-${randomUUID().slice(0, 8)}`;
const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();

let anon: SupabaseClient;
let admin: SupabaseClient;
let owner: SupabaseClient;
let maputoManager: SupabaseClient;
let matolaManager: SupabaseClient;
let maputoCashier: SupabaseClient;
let maputoStoreId: string;
let matolaStoreId: string;
const testUserIds: string[] = [];
const sessionIds: string[] = [];

async function createStaffClient(
  email: string,
  role: "owner" | "manager" | "cashier",
  storeIds: string[],
): Promise<SupabaseClient> {
  const password = "Funil-1066-Teste!";
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`Setup: ${email} — ${error?.message}`);
  testUserIds.push(data.user.id);

  const { error: pErr } = await admin
    .from("staff_profiles")
    .insert({ user_id: data.user.id, full_name: `Teste ${role}`, role, active: true });
  if (pErr) throw new Error(`Setup: staff_profile — ${pErr.message}`);

  if (storeIds.length) {
    const { error: sErr } = await admin
      .from("staff_stores")
      .insert(storeIds.map((store_id) => ({ user_id: data.user.id, store_id })));
    if (sErr) throw new Error(`Setup: staff_stores — ${sErr.message}`);
  }

  const client = createClient(SUPABASE_URL, ANON_KEY);
  const { error: loginErr } = await client.auth.signInWithPassword({ email, password });
  if (loginErr) throw new Error(`Setup: login ${email} — ${loginErr.message}`);
  return client;
}

function session(): string {
  const id = randomUUID();
  sessionIds.push(id);
  return id;
}

interface SourceRow {
  channel: string;
  source: string;
  medium: string;
  campaign: string | null;
  sessions: number;
  carts: number;
  purchases: number;
  revenue_cents: number;
}

function rowsOfRun(data: { by_source: SourceRow[] }): SourceRow[] {
  return data.by_source.filter((r) => r.campaign?.startsWith(RUN));
}

beforeAll(async () => {
  anon = createClient(SUPABASE_URL, ANON_KEY);
  admin = createClient(SUPABASE_URL, SERVICE_KEY);

  const { data: stores, error } = await admin.from("stores").select("id, slug");
  if (error || !stores) throw new Error(`Setup: lojas — ${error?.message}`);
  maputoStoreId = stores.find((s) => s.slug === "maputo")!.id;
  matolaStoreId = stores.find((s) => s.slug === "matola")!.id;

  owner = await createStaffClient(`${RUN}-owner@test.local`, "owner", []);
  maputoManager = await createStaffClient(`${RUN}-mpt@test.local`, "manager", [maputoStoreId]);
  matolaManager = await createStaffClient(`${RUN}-mtl@test.local`, "manager", [matolaStoreId]);
  maputoCashier = await createStaffClient(`${RUN}-cx@test.local`, "cashier", [maputoStoreId]);

  // Maputo: anúncio do Meta com os UTM podres que se viram no SLICE — nome
  // da campanha no meio, gravado pela classificação antiga (canal 'direct').
  const metaSess = session();
  // Matola: Instagram orgânico com carrinho e compra.
  const igSess = session();
  // Sem loja: tráfego antes da escolha — só o dono o vê.
  const noStoreSess = session();

  const events = [
    { session_id: metaSess, store_id: maputoStoreId, type: "view_menu",
      channel: "direct", source: "metaads", medium: `${RUN}-pizza`, campaign: null },
    { session_id: metaSess, store_id: maputoStoreId, type: "add_to_cart",
      channel: "direct", source: "metaads", medium: `${RUN}-pizza`, campaign: null },

    { session_id: igSess, store_id: matolaStoreId, type: "view_menu",
      channel: "organic_social", source: "instagram", medium: "social", campaign: `${RUN}-bio` },
    { session_id: igSess, store_id: matolaStoreId, type: "add_to_cart",
      channel: "organic_social", source: "instagram", medium: "social", campaign: `${RUN}-bio` },
    { session_id: igSess, store_id: matolaStoreId, type: "purchase", value_cents: 45000,
      channel: "organic_social", source: "instagram", medium: "social", campaign: `${RUN}-bio` },

    { session_id: noStoreSess, store_id: null, type: "view_menu",
      channel: "referral", source: "folheto", medium: "referral", campaign: `${RUN}-sem-loja` },

    // Anterior ao cookie de sessão: não pode aparecer em lado nenhum.
    { session_id: "unknown", store_id: maputoStoreId, type: "purchase", value_cents: 99900,
      channel: "direct", source: "direto", medium: "(nenhum)", campaign: `${RUN}-unknown` },
  ].map((e) => ({ utm: {}, payload: {}, ...e }));

  const { error: insErr } = await admin.from("analytics_events").insert(events);
  if (insErr) throw new Error(`Setup: eventos — ${insErr.message}`);
});

afterAll(async () => {
  if (admin) {
    await admin.from("analytics_events").delete().in("session_id", sessionIds);
    await admin.from("analytics_events").delete().eq("session_id", "unknown").like("campaign", `${RUN}%`);
    for (const id of testUserIds) await admin.auth.admin.deleteUser(id);
  }
});

describe("(a) isolamento entre lojas", () => {
  it("o gerente da Matola não lê o funil de Maputo", async () => {
    const { error } = await matolaManager.rpc("get_funnel_metrics", { p_from: since, p_store_id: maputoStoreId });
    expect(error?.message).toContain("funnel_access_denied");
  });

  it("o gerente não pede o consolidado — 'Todas' é só do dono", async () => {
    const { error } = await matolaManager.rpc("get_funnel_metrics", { p_from: since });
    expect(error?.message).toContain("funnel_access_denied");
  });

  it("na sua loja, o gerente da Matola só vê as sessões da Matola", async () => {
    const { data, error } = await matolaManager.rpc("get_funnel_metrics", { p_from: since, p_store_id: matolaStoreId });
    expect(error).toBeNull();
    const rows = rowsOfRun(data);
    expect(rows.map((r) => r.campaign)).toEqual([`${RUN}-bio`]);
  });

  it("a view por sessão respeita a RLS de quem lê (security_invoker)", async () => {
    const { data, error } = await matolaManager
      .from("analytics_sessions")
      .select("session_id, store_id")
      .in("session_id", sessionIds);
    expect(error).toBeNull();
    expect(data!.every((s) => s.store_id === matolaStoreId)).toBe(true);
    expect(data!.length).toBe(1);
  });

  it("o dono vê tudo, incluindo o tráfego antes da escolha de loja", async () => {
    const { data, error } = await owner.rpc("get_funnel_metrics", { p_from: since });
    expect(error).toBeNull();
    const campaigns = rowsOfRun(data).map((r) => r.campaign).sort();
    expect(campaigns).toEqual([`${RUN}-bio`, `${RUN}-pizza`, `${RUN}-sem-loja`].sort());
  });
});

describe("(b) quem pode ler", () => {
  it("anon não chama a RPC nem lê a view", async () => {
    const rpc = await anon.rpc("get_funnel_metrics", { p_from: since });
    expect(rpc.error).not.toBeNull();
    const view = await anon.from("analytics_sessions").select("session_id").limit(1);
    expect(view.data ?? []).toEqual([]);
  });

  it("o caixa não lê o funil — é leitura de gestão", async () => {
    const { error } = await maputoCashier.rpc("get_funnel_metrics", { p_from: since, p_store_id: maputoStoreId });
    expect(error?.message).toContain("funnel_access_denied");
  });
});

describe("(c) normalização do histórico", () => {
  it("MetaAds com o nome da campanha no meio vira facebook / cpc / campanha", async () => {
    const { data } = await maputoManager.rpc("get_funnel_metrics", { p_from: since, p_store_id: maputoStoreId });
    const [row] = rowsOfRun(data);
    expect(row).toMatchObject({
      channel: "paid_social",
      source: "facebook",
      medium: "cpc",
      campaign: `${RUN}-pizza`,
      sessions: 1,
      carts: 1,
      purchases: 0,
    });
  });

  it("a etapa do carrinho conta", async () => {
    const { data } = await matolaManager.rpc("get_funnel_metrics", { p_from: since, p_store_id: matolaStoreId });
    expect(data.funnel.step_cart).toBeGreaterThanOrEqual(1);
    const [row] = rowsOfRun(data);
    expect(row).toMatchObject({ carts: 1, purchases: 1, revenue_cents: 45000 });
  });
});

describe("(d) sessões 'unknown'", () => {
  it("nunca entram no funil", async () => {
    const { data } = await owner.rpc("get_funnel_metrics", { p_from: since });
    expect(rowsOfRun(data).some((r) => r.campaign === `${RUN}-unknown`)).toBe(false);
  });
});
