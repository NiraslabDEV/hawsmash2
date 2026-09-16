/**
 * Gate de integração da 1049 — entrada no POS pelo cartão da pessoa + PIN.
 *
 * O que aqui se prova é o que torna o cartão aceitável num balcão: o terminal
 * só mostra a equipa da SUA loja (§5.3), o PIN certo abre a sessão daquela
 * pessoa e deixa rasto (§6), e o PIN errado tem travão — sem ele quatro
 * algarismos adivinham-se numa tarde.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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
let maputoStoreId: string;
let matolaStoreId: string;
let maputoDeviceId: string;
let caixaMaputoId: string;
let caixaMatolaId: string;
let semPinId: string;

const createdUserIds: string[] = [];
const createdDeviceIds: string[] = [];
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const PASSWORD = "Cartao-1049-Teste-2026!";
const PIN = "4821";

async function createStaff(
  label: string,
  role: "owner" | "manager" | "cashier" | "kitchen",
  storeIds: string[],
  pin: string | null,
): Promise<string> {
  const email = `cartao-${label}-${suffix}@delivery.test`;
  const { data: user, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !user.user) throw new Error(`Setup cartão: ${label} — ${error?.message}`);
  createdUserIds.push(user.user.id);

  const { error: profileError } = await admin.from("staff_profiles").insert({
    user_id: user.user.id,
    full_name: `Cartao 1049 ${label}`,
    role,
    active: true,
  });
  if (profileError) throw new Error(`Setup cartão: perfil ${label} — ${profileError.message}`);

  if (storeIds.length > 0) {
    const { error: storeError } = await admin
      .from("staff_stores")
      .insert(storeIds.map((storeId) => ({ user_id: user.user!.id, store_id: storeId })));
    if (storeError) throw new Error(`Setup cartão: lojas ${label} — ${storeError.message}`);
  }

  // O PIN entra pela via normal do painel (`set_staff_pin`, só dono): é o
  // mesmo `crypt` que a entrada por cartão depois compara.
  if (pin) {
    const { error: pinError } = await owner.rpc("set_staff_pin", {
      p_user_id: user.user.id,
      p_pin: pin,
    });
    if (pinError) throw new Error(`Setup cartão: PIN ${label} — ${pinError.message}`);
  }

  return user.user.id;
}

async function signIn(email: string): Promise<SupabaseClient> {
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`Setup cartão: login — ${error.message}`);
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
  if (error || stores?.length !== 2) throw new Error(`Setup cartão: lojas — ${error?.message}`);
  maputoStoreId = stores.find((store) => store.slug === "maputo")!.id;
  matolaStoreId = stores.find((store) => store.slug === "matola")!.id;

  const { data: device, error: deviceError } = await admin
    .from("devices")
    .insert({
      store_id: maputoStoreId,
      kind: "pos",
      label: "POS balcão teste 1049",
      device_key_hash: `teste-1049-${suffix}`,
      locked_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (deviceError || !device) throw new Error(`Setup cartão: dispositivo — ${deviceError?.message}`);
  maputoDeviceId = device.id;
  createdDeviceIds.push(device.id);

  // O dono existe primeiro: é ele quem define os PIN da equipa no painel.
  const ownerEmail = `cartao-dono-${suffix}@delivery.test`;
  const { data: ownerUser, error: ownerError } = await admin.auth.admin.createUser({
    email: ownerEmail,
    password: PASSWORD,
    email_confirm: true,
  });
  if (ownerError || !ownerUser.user) throw new Error(`Setup cartão: dono — ${ownerError?.message}`);
  createdUserIds.push(ownerUser.user.id);
  const { error: ownerProfileError } = await admin.from("staff_profiles").insert({
    user_id: ownerUser.user.id,
    full_name: `Cartao 1049 dono`,
    role: "owner",
    active: true,
  });
  if (ownerProfileError) {
    throw new Error(`Setup cartão: perfil do dono — ${ownerProfileError.message}`);
  }
  owner = await signIn(ownerEmail);

  caixaMaputoId = await createStaff("caixa-maputo", "cashier", [maputoStoreId], PIN);
  caixaMatolaId = await createStaff("caixa-matola", "cashier", [matolaStoreId], PIN);
  semPinId = await createStaff("caixa-sem-pin", "cashier", [maputoStoreId], null);
});

beforeEach(async () => {
  await admin
    .from("staff_profiles")
    .update({ pin_failed_attempts: 0, pin_locked_until: null })
    .in("user_id", [caixaMaputoId, caixaMatolaId, semPinId]);
  await admin
    .from("devices")
    .update({ locked_at: new Date().toISOString() })
    .eq("id", maputoDeviceId);
});

afterAll(async () => {
  await admin.from("event_log").delete().in("actor_user_id", createdUserIds);
  if (createdDeviceIds.length > 0) {
    await admin.from("devices").delete().in("id", createdDeviceIds);
  }
  for (const userId of createdUserIds) {
    await admin.auth.admin.deleteUser(userId);
  }
});

describe("1049 · cartões do ecrã de entrada", () => {
  it("mostra a equipa da loja do terminal e deixa de fora a da outra loja", async () => {
    const { data, error } = await anon.rpc("pos_login_cards", { p_device_id: maputoDeviceId });

    expect(error).toBeNull();
    expect(data.ok).toBe(true);
    expect(data.device.store_id).toBe(maputoStoreId);

    const ids = (data.staff as Array<{ user_id: string }>).map((card) => card.user_id);
    expect(ids).toContain(caixaMaputoId);
    expect(ids).not.toContain(caixaMatolaId);
  });

  it("nunca devolve email nem hash do PIN — só o que está no crachá", async () => {
    const { data } = await anon.rpc("pos_login_cards", { p_device_id: maputoDeviceId });
    const card = (data.staff as Array<Record<string, unknown>>).find(
      (entry) => entry.user_id === caixaMaputoId,
    )!;

    expect(Object.keys(card).sort()).toEqual(
      ["full_name", "has_pin", "locked_until", "role", "user_id"].sort(),
    );
    expect(card.has_pin).toBe(true);
  });

  it("marca quem ainda não tem PIN, para o ecrã mandar criá-lo", async () => {
    const { data } = await anon.rpc("pos_login_cards", { p_device_id: maputoDeviceId });
    const card = (data.staff as Array<{ user_id: string; has_pin: boolean }>).find(
      (entry) => entry.user_id === semPinId,
    )!;

    expect(card.has_pin).toBe(false);
  });

  it("terminal desconhecido não lista ninguém", async () => {
    const { data } = await anon.rpc("pos_login_cards", {
      p_device_id: "00000000-0000-4000-8000-000000000000",
    });

    expect(data.ok).toBe(false);
    expect(data.reason).toBe("invalid_device");
  });
});

describe("1049 · entrada com PIN", () => {
  it("o PIN certo identifica a pessoa, desbloqueia o terminal e fica registado", async () => {
    const { data, error } = await admin.rpc("pos_login_with_pin", {
      p_device_id: maputoDeviceId,
      p_user_id: caixaMaputoId,
      p_pin: PIN,
    });

    expect(error).toBeNull();
    expect(data.ok).toBe(true);
    expect(data.user_id).toBe(caixaMaputoId);
    expect(data.email).toContain("caixa-maputo");

    const { data: device } = await admin
      .from("devices")
      .select("locked_at")
      .eq("id", maputoDeviceId)
      .single();
    expect(device!.locked_at).toBeNull();

    const { data: log } = await admin
      .from("event_log")
      .select("type,store_id,actor_user_id")
      .eq("actor_user_id", caixaMaputoId)
      .eq("type", "pos.login")
      .order("created_at", { ascending: false })
      .limit(1);
    expect(log?.[0]).toMatchObject({ store_id: maputoStoreId, actor_user_id: caixaMaputoId });
  });

  it("PIN errado não entra, conta a tentativa e deixa o terminal trancado", async () => {
    const { data } = await admin.rpc("pos_login_with_pin", {
      p_device_id: maputoDeviceId,
      p_user_id: caixaMaputoId,
      p_pin: "0000",
    });

    expect(data.ok).toBe(false);
    expect(data.reason).toBe("invalid_pin");

    const { data: profile } = await admin
      .from("staff_profiles")
      .select("pin_failed_attempts")
      .eq("user_id", caixaMaputoId)
      .single();
    expect(profile!.pin_failed_attempts).toBe(1);

    const { data: device } = await admin
      .from("devices")
      .select("locked_at")
      .eq("id", maputoDeviceId)
      .single();
    expect(device!.locked_at).not.toBeNull();
  });

  it("cinco PIN errados travam o cartão, e o cartão aparece travado na grelha", async () => {
    for (let tentativa = 0; tentativa < 5; tentativa += 1) {
      await admin.rpc("pos_login_with_pin", {
        p_device_id: maputoDeviceId,
        p_user_id: caixaMaputoId,
        p_pin: "0000",
      });
    }

    const { data: travado } = await admin.rpc("pos_login_with_pin", {
      p_device_id: maputoDeviceId,
      p_user_id: caixaMaputoId,
      p_pin: PIN,
    });
    expect(travado.ok).toBe(false);
    expect(travado.reason).toBe("pin_locked");
    expect(Date.parse(travado.locked_until)).toBeGreaterThan(Date.now());

    const { data: cards } = await anon.rpc("pos_login_cards", { p_device_id: maputoDeviceId });
    const card = (cards.staff as Array<{ user_id: string; locked_until: string | null }>).find(
      (entry) => entry.user_id === caixaMaputoId,
    )!;
    expect(card.locked_until).not.toBeNull();
  });

  it("a entrada certa limpa o castigo acumulado", async () => {
    await admin.rpc("pos_login_with_pin", {
      p_device_id: maputoDeviceId,
      p_user_id: caixaMaputoId,
      p_pin: "0000",
    });
    await admin.rpc("pos_login_with_pin", {
      p_device_id: maputoDeviceId,
      p_user_id: caixaMaputoId,
      p_pin: PIN,
    });

    const { data: profile } = await admin
      .from("staff_profiles")
      .select("pin_failed_attempts,pin_locked_until")
      .eq("user_id", caixaMaputoId)
      .single();
    expect(profile!.pin_failed_attempts).toBe(0);
    expect(profile!.pin_locked_until).toBeNull();
  });

  it("quem é de outra loja não entra neste terminal, mesmo com o PIN certo", async () => {
    const { data } = await admin.rpc("pos_login_with_pin", {
      p_device_id: maputoDeviceId,
      p_user_id: caixaMatolaId,
      p_pin: PIN,
    });

    expect(data.ok).toBe(false);
    expect(data.reason).toBe("staff_not_in_store");
  });

  it("quem não tem PIN não entra pelo cartão", async () => {
    const { data } = await admin.rpc("pos_login_with_pin", {
      p_device_id: maputoDeviceId,
      p_user_id: semPinId,
      p_pin: PIN,
    });

    expect(data.ok).toBe(false);
    expect(data.reason).toBe("pin_not_configured");
  });

  it("o browser não chama a verificação do PIN — só o servidor", async () => {
    const { error } = await anon.rpc("pos_login_with_pin", {
      p_device_id: maputoDeviceId,
      p_user_id: caixaMaputoId,
      p_pin: PIN,
    });

    expect(error).not.toBeNull();
  });
});
