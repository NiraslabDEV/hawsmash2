/**
 * Gate de integração da 1050 — o alerta automático tem de chegar ao cron.
 *
 * O §11.5 promete que o sistema avisa sozinho, e é isso que substitui o
 * telefonema de sábado à noite. O cron corre com a chave de serviço e sem
 * sessão: a porta que ele usa não pode exigir `auth.uid()`, e tem de ver as
 * duas lojas, porque é ele que decide a que dono manda cada aviso.
 *
 * O que aqui se prova, e que só se prova contra um Supabase a sério: a porta do
 * cron abre à chave de serviço, vê a empresa inteira, e continua fechada ao
 * browser — anónimo ou com sessão de equipa. O painel não muda: quem entra
 * continua a ver só a sua loja (regra 3).
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

type Alerta = {
  store_id: string;
  store_name: string;
  kind: string;
  severity: string;
  message: string;
};

let admin: SupabaseClient;
let anon: SupabaseClient;
let gerenteMaputo: SupabaseClient;
let maputoStoreId: string;
let matolaStoreId: string;

const createdUserIds: string[] = [];
const createdDeviceIds: string[] = [];
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const PASSWORD = "Alertas-1050-Teste-2026!";

/** Cria uma pessoa da equipa com sessão própria, ligada às lojas indicadas. */
async function criarEquipa(
  label: string,
  role: "owner" | "manager" | "cashier",
  storeIds: string[],
): Promise<SupabaseClient> {
  const email = `alertas-${label}-${suffix}@delivery.test`;
  const { data: user, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !user.user) throw new Error(`Setup alertas: ${label} — ${error?.message}`);
  createdUserIds.push(user.user.id);

  const { error: perfilError } = await admin.from("staff_profiles").insert({
    user_id: user.user.id,
    full_name: `Alertas 1050 ${label}`,
    role,
    active: true,
  });
  if (perfilError) throw new Error(`Setup alertas: perfil ${label} — ${perfilError.message}`);

  if (storeIds.length > 0) {
    const { error: lojaError } = await admin
      .from("staff_stores")
      .insert(storeIds.map((storeId) => ({ user_id: user.user!.id, store_id: storeId })));
    if (lojaError) throw new Error(`Setup alertas: lojas ${label} — ${lojaError.message}`);
  }

  const sessao = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: loginError } = await sessao.auth.signInWithPassword({ email, password: PASSWORD });
  if (loginError) throw new Error(`Setup alertas: sessão ${label} — ${loginError.message}`);
  return sessao;
}

/** Um dispositivo calado há muito: é o alerta `device_silent` do §11.5. */
async function criarDispositivoCalado(storeId: string, label: string): Promise<void> {
  const { data, error } = await admin
    .from("devices")
    .insert({
      store_id: storeId,
      kind: "bridge",
      label,
      device_key_hash: `alertas-${label}`,
      active: true,
      last_seen_at: new Date(Date.now() - 60 * 60_000).toISOString(),
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Setup alertas: dispositivo ${label} — ${error?.message}`);
  createdDeviceIds.push(data.id as string);
}

beforeAll(async () => {
  admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  anon = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: lojas, error } = await admin.from("stores").select("id,slug");
  if (error || !lojas) throw new Error(`Setup alertas: lojas — ${error?.message}`);
  maputoStoreId = lojas.find((l) => l.slug === "maputo")!.id as string;
  matolaStoreId = lojas.find((l) => l.slug === "matola")!.id as string;

  await criarDispositivoCalado(maputoStoreId, `Bridge calado MPT ${suffix}`);
  await criarDispositivoCalado(matolaStoreId, `Bridge calado MTL ${suffix}`);

  gerenteMaputo = await criarEquipa("gerente", "manager", [maputoStoreId]);
}, 60_000);

afterAll(async () => {
  if (createdDeviceIds.length > 0) {
    await admin.from("devices").delete().in("id", createdDeviceIds);
  }
  for (const userId of createdUserIds) {
    await admin.from("staff_stores").delete().eq("user_id", userId);
    await admin.from("staff_profiles").delete().eq("user_id", userId);
    await admin.auth.admin.deleteUser(userId);
  }
});

describe("1050 · a porta do cron", () => {
  it("abre à chave de serviço, sem sessão nenhuma", async () => {
    const { data, error } = await admin.rpc("list_system_alerts_all");
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
  });

  it("vê as duas lojas — é o cron que escolhe a quem manda cada aviso", async () => {
    const { data, error } = await admin.rpc("list_system_alerts_all");
    expect(error).toBeNull();

    const alertas = data as Alerta[];
    const calados = alertas.filter((a) => a.kind === "device_silent");
    expect(calados.some((a) => a.store_id === maputoStoreId)).toBe(true);
    expect(calados.some((a) => a.store_id === matolaStoreId)).toBe(true);
  });

  it("continua fechada ao browser anónimo", async () => {
    const { error } = await anon.rpc("list_system_alerts_all");
    expect(error).not.toBeNull();
  });

  it("continua fechada a quem tem sessão de equipa", async () => {
    const { error } = await gerenteMaputo.rpc("list_system_alerts_all");
    expect(error).not.toBeNull();
  });
});

describe("1050 · o painel não muda", () => {
  it("o gerente de Maputo continua a ver só Maputo", async () => {
    const { data, error } = await gerenteMaputo.rpc("list_system_alerts");
    expect(error).toBeNull();

    const alertas = data as Alerta[];
    expect(alertas.length).toBeGreaterThan(0);
    expect(alertas.every((a) => a.store_id === maputoStoreId)).toBe(true);
  });

  it("sem sessão continua a recusar — é por isso que o cron tem porta própria", async () => {
    const { error } = await admin.rpc("list_system_alerts");
    expect(error).not.toBeNull();
    expect(error?.message ?? "").toContain("not_authenticated");
  });
});
