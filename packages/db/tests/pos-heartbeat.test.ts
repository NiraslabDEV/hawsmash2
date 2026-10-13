/**
 * Gate de integração da 1114 — o sinal de vida do POS e o alerta que diz a
 * verdade.
 *
 * O que estava medido no LIVE a 07/10: quatro `device_silent` críticos e
 * nenhuma avaria. O POS de Maputo estava ligado e a vender, mas só escrevia
 * `last_seen_at` quando havia venda — "calado há 5 minutos" queria dizer "sem
 * venda há 5 minutos". A Matola, com `stores.active = false`, dava dois
 * críticos há 35 dias porque o ramo nunca olhou para `s.active`.
 *
 * Isto só se prova contra um Supabase a sério: são RLS, `security definer` e
 * grants. Prova-se aqui que o POS consegue bater o sinal (até um `cashier`,
 * que a RLS da `devices` não deixa escrever), que não consegue bater o de
 * outra loja (regra 3), que o limiar do POS é mais largo que o da bridge, que
 * loja inactiva não alerta, e que retirar um dispositivo é só de manager/owner
 * e fica no `event_log`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Chaves só do ambiente — ao contrário dos testes mais antigos, este ficheiro
 * não traz nenhuma embutida. Uma chave em código acaba sempre por ser
 * copiada para onde não devia (§17).
 */
const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://localhost:54731";
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!ANON_KEY || !SERVICE_KEY) {
  throw new Error(
    "1114: define SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY (supabase status) para correr este teste.",
  );
}

type Alerta = {
  store_id: string;
  kind: string;
  severity: string;
  message: string;
  details: { device_id?: string; kind?: string };
};

let admin: SupabaseClient;
let caixaMaputo: SupabaseClient;
let gerenteMaputo: SupabaseClient;
let maputoStoreId: string;
let matolaStoreId: string;

const createdUserIds: string[] = [];
const createdDeviceIds: string[] = [];
const createdSessionIds: string[] = [];
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const PASSWORD = "Heartbeat-1114-Teste-2026!";

const minutosAtras = (n: number) => new Date(Date.now() - n * 60_000).toISOString();

async function criarEquipa(
  label: string,
  role: "owner" | "manager" | "cashier",
  storeIds: string[],
): Promise<SupabaseClient> {
  const email = `hb-${label}-${suffix}@delivery.test`;
  const { data: user, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !user.user) throw new Error(`Setup 1114: ${label} — ${error?.message}`);
  createdUserIds.push(user.user.id);

  const { error: perfilError } = await admin.from("staff_profiles").insert({
    user_id: user.user.id,
    full_name: `Heartbeat 1114 ${label}`,
    role,
    active: true,
  });
  if (perfilError) throw new Error(`Setup 1114: perfil ${label} — ${perfilError.message}`);

  if (storeIds.length > 0) {
    const { error: lojaError } = await admin
      .from("staff_stores")
      .insert(storeIds.map((storeId) => ({ user_id: user.user!.id, store_id: storeId })));
    if (lojaError) throw new Error(`Setup 1114: lojas ${label} — ${lojaError.message}`);
  }

  const sessao = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: loginError } = await sessao.auth.signInWithPassword({ email, password: PASSWORD });
  if (loginError) throw new Error(`Setup 1114: sessão ${label} — ${loginError.message}`);
  return sessao;
}

async function criarDispositivo(input: {
  storeId: string;
  kind: "pos" | "bridge";
  label: string;
  lastSeenAt: string | null;
}): Promise<string> {
  const { data, error } = await admin
    .from("devices")
    .insert({
      store_id: input.storeId,
      kind: input.kind,
      label: input.label,
      device_key_hash: `hb-${input.label}-${suffix}`,
      active: true,
      last_seen_at: input.lastSeenAt,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Setup 1114: dispositivo ${input.label} — ${error?.message}`);
  createdDeviceIds.push(data.id as string);
  return data.id as string;
}

/**
 * Um turno aberto é o que diz "esta loja está a operar agora" sem depender da
 * hora a que os testes correm. É assim que o POS fica sob vigilância aqui.
 */
async function abrirTurno(storeId: string): Promise<void> {
  const { data, error } = await admin
    .from("cash_sessions")
    .insert({
      store_id: storeId,
      shift_label: `1114 ${suffix}`,
      opening_float_cents: 0,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Setup 1114: turno — ${error?.message}`);
  createdSessionIds.push(data.id as string);
}

async function alertas(client: SupabaseClient): Promise<Alerta[]> {
  const { data, error } = await client.rpc("list_system_alerts_all");
  if (error) throw new Error(`1114: alertas — ${error.message}`);
  return data as Alerta[];
}

beforeAll(async () => {
  admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: lojas, error } = await admin.from("stores").select("id,slug");
  if (error || !lojas) throw new Error(`Setup 1114: lojas — ${error?.message}`);
  maputoStoreId = lojas.find((l) => l.slug === "maputo")!.id as string;
  matolaStoreId = lojas.find((l) => l.slug === "matola")!.id as string;

  caixaMaputo = await criarEquipa("caixa", "cashier", [maputoStoreId]);
  gerenteMaputo = await criarEquipa("gerente", "manager", [maputoStoreId]);
}, 60_000);

afterAll(async () => {
  if (createdSessionIds.length > 0) {
    await admin.from("cash_sessions").delete().in("id", createdSessionIds);
  }
  if (createdDeviceIds.length > 0) {
    await admin.from("devices").delete().in("id", createdDeviceIds);
  }
  for (const userId of createdUserIds) {
    await admin.from("staff_stores").delete().eq("user_id", userId);
    await admin.from("staff_profiles").delete().eq("user_id", userId);
    await admin.auth.admin.deleteUser(userId);
  }
});

describe("1114 · o POS dá sinal de vida", () => {
  it("o caixa bate o sinal, apesar de a RLS não o deixar escrever em devices", async () => {
    const deviceId = await criarDispositivo({
      storeId: maputoStoreId,
      kind: "pos",
      label: `POS sinal ${suffix}`,
      lastSeenAt: minutosAtras(60),
    });

    // A prova de que precisa de ser `security definer`: o caminho directo
    // está fechado ao caixa, e o sinal de vida tem de passar mesmo assim.
    const directo = await caixaMaputo
      .from("devices")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", deviceId)
      .select("id");
    expect(directo.data ?? []).toHaveLength(0);

    const { data, error } = await caixaMaputo.rpc("pos_heartbeat", {
      p_device_id: deviceId,
      p_app_version: "teste-1114",
    });
    expect(error).toBeNull();
    expect((data as { ok: boolean }).ok).toBe(true);

    const { data: depois } = await admin
      .from("devices")
      .select("last_seen_at,app_version")
      .eq("id", deviceId)
      .single();
    expect(Date.now() - new Date(depois!.last_seen_at as string).getTime()).toBeLessThan(60_000);
    expect(depois!.app_version).toBe("teste-1114");
  });

  it("não mantém vivo um terminal de outra loja (regra 3)", async () => {
    const alheio = await criarDispositivo({
      storeId: matolaStoreId,
      kind: "pos",
      label: `POS alheio ${suffix}`,
      lastSeenAt: minutosAtras(60),
    });

    const { error } = await caixaMaputo.rpc("pos_heartbeat", { p_device_id: alheio });
    expect(error).not.toBeNull();
    expect(error!.message).toContain("invalid_or_unauthorised_device");

    const { data: depois } = await admin
      .from("devices")
      .select("last_seen_at")
      .eq("id", alheio)
      .single();
    expect(Date.now() - new Date(depois!.last_seen_at as string).getTime()).toBeGreaterThan(
      30 * 60_000,
    );
  });

  it("fica fechado ao browser anónimo", async () => {
    const anon = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await anon.rpc("pos_heartbeat", {
      p_device_id: "00000000-0000-4000-8000-00000000ffff",
    });
    expect(error).not.toBeNull();
  });
});

describe("1114 · o alerta mede o que diz medir", () => {
  it("dá à bridge 5 minutos e ao POS 15 — o POS vende offline por desenho", async () => {
    await abrirTurno(maputoStoreId);

    const bridge = await criarDispositivo({
      storeId: maputoStoreId,
      kind: "bridge",
      label: `Bridge 8min ${suffix}`,
      lastSeenAt: minutosAtras(8),
    });
    const posRecente = await criarDispositivo({
      storeId: maputoStoreId,
      kind: "pos",
      label: `POS 8min ${suffix}`,
      lastSeenAt: minutosAtras(8),
    });
    const posCalado = await criarDispositivo({
      storeId: maputoStoreId,
      kind: "pos",
      label: `POS 40min ${suffix}`,
      lastSeenAt: minutosAtras(40),
    });

    const rows = await alertas(admin);
    const calados = rows.filter((a) => a.kind === "device_silent");
    const ids = calados.map((a) => a.details.device_id);

    // Oito minutos: para a bridge já é avaria, para o POS é um wifi fraco.
    expect(ids).toContain(bridge);
    expect(ids).not.toContain(posRecente);
    expect(ids).toContain(posCalado);
  });

  it("não alerta por loja inactiva — era o que a Matola fazia há 35 dias", async () => {
    const naInactiva = await criarDispositivo({
      storeId: matolaStoreId,
      kind: "bridge",
      label: `Bridge loja inactiva ${suffix}`,
      lastSeenAt: minutosAtras(60),
    });

    const { data: antes } = await admin
      .from("stores")
      .select("active")
      .eq("id", matolaStoreId)
      .single();
    await admin.from("stores").update({ active: false }).eq("id", matolaStoreId);
    try {
      const ids = (await alertas(admin))
        .filter((a) => a.kind === "device_silent")
        .map((a) => a.details.device_id);
      expect(ids).not.toContain(naInactiva);
    } finally {
      await admin.from("stores").update({ active: antes!.active }).eq("id", matolaStoreId);
    }
  });

  it("o POS calado fora de operação não alerta; a bridge alerta sempre", async () => {
    const { data: turnos } = await admin
      .from("cash_sessions")
      .select("id")
      .eq("store_id", matolaStoreId)
      .is("closed_at", null);
    expect(turnos ?? []).toHaveLength(0);

    // A Matola do seed abre às 12:00 e fecha às 21:30, três dias por semana.
    // Fora disso, e sem turno aberto, não há nada a avisar sobre um ecrã que
    // alguém desligou — mas a bridge é 24/7 e continua vigiada.
    const horas = await admin
      .from("store_hours")
      .select("dow")
      .eq("store_id", matolaStoreId)
      .eq("active", true);
    const agora = new Date(
      new Date().toLocaleString("en-US", { timeZone: "Africa/Maputo" }),
    );
    const diaConfigurado = (horas.data ?? []).some((h) => h.dow === agora.getDay());
    const hora = agora.getHours() + agora.getMinutes() / 60;
    const aOperar = diaConfigurado && hora >= 12 && hora < 21.5;

    const pos = await criarDispositivo({
      storeId: matolaStoreId,
      kind: "pos",
      label: `POS fora de horario ${suffix}`,
      lastSeenAt: minutosAtras(60),
    });
    const bridge = await criarDispositivo({
      storeId: matolaStoreId,
      kind: "bridge",
      label: `Bridge fora de horario ${suffix}`,
      lastSeenAt: minutosAtras(60),
    });

    const ids = (await alertas(admin))
      .filter((a) => a.kind === "device_silent")
      .map((a) => a.details.device_id);
    expect(ids).toContain(bridge);
    expect(ids.includes(pos)).toBe(aOperar);
  });
});

describe("1114 · retirar um dispositivo", () => {
  it("é do gerente, fica no event_log e deixa de alertar", async () => {
    const fantasma = await criarDispositivo({
      storeId: maputoStoreId,
      kind: "bridge",
      label: `Bridge fantasma ${suffix}`,
      lastSeenAt: minutosAtras(60),
    });

    const antes = (await alertas(admin))
      .filter((a) => a.kind === "device_silent")
      .map((a) => a.details.device_id);
    expect(antes).toContain(fantasma);

    const negado = await caixaMaputo.rpc("retire_device", { p_device_id: fantasma });
    expect(negado.error).not.toBeNull();
    expect(negado.error!.message).toContain("retire_device_access_denied");

    const { error } = await gerenteMaputo.rpc("retire_device", {
      p_device_id: fantasma,
      p_reason: "terminal já não existe",
    });
    expect(error).toBeNull();

    const depois = (await alertas(admin))
      .filter((a) => a.kind === "device_silent")
      .map((a) => a.details.device_id);
    expect(depois).not.toContain(fantasma);

    // Não se apaga: a linha é histórico de quem vendeu em que terminal (§17).
    const { data: linha } = await admin
      .from("devices")
      .select("active")
      .eq("id", fantasma)
      .single();
    expect(linha!.active).toBe(false);

    const { data: eventos } = await admin
      .from("event_log")
      .select("type,payload")
      .eq("type", "device.retired")
      .eq("store_id", maputoStoreId)
      .order("created_at", { ascending: false })
      .limit(10);
    expect(
      (eventos ?? []).some((e) => (e.payload as { device_id?: string }).device_id === fantasma),
    ).toBe(true);
  });

  it("vincular um POS novo retira o binding abandonado do mesmo balcão", async () => {
    const abandonado = await criarDispositivo({
      storeId: maputoStoreId,
      kind: "pos",
      label: `POS abandonado ${suffix}`,
      lastSeenAt: new Date(Date.now() - 5 * 24 * 60 * 60_000).toISOString(),
    });
    const aTrabalhar = await criarDispositivo({
      storeId: maputoStoreId,
      kind: "pos",
      label: `POS a trabalhar ${suffix}`,
      lastSeenAt: minutosAtras(1),
    });

    const { data, error } = await gerenteMaputo.rpc("bind_pos_device", {
      p_store_id: maputoStoreId,
      p_label: `POS novo ${suffix}`,
    });
    expect(error).toBeNull();
    createdDeviceIds.push((data as { device_id: string }).device_id);

    const { data: linhas } = await admin
      .from("devices")
      .select("id,active")
      .in("id", [abandonado, aTrabalhar]);
    const porId = new Map((linhas ?? []).map((l) => [l.id as string, l.active as boolean]));
    // Calado há cinco dias: é a linha que o mesmo PC deixou atrás.
    expect(porId.get(abandonado)).toBe(false);
    // Visto há um minuto: é um segundo terminal a sério, não se toca.
    expect(porId.get(aTrabalhar)).toBe(true);
  });
});
