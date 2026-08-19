/**
 * Gate de integração da F8 — equipa, permissões e painel Sistema.
 * Cobre atribuição de perfil/lojas, remoção imediata de acesso com auditoria,
 * PIN definido pelo dono e o semáforo operacional por loja.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://localhost:54731";
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz";

let admin: SupabaseClient;
let owner: SupabaseClient;
let manager: SupabaseClient;
let ownerUserId: string;
let managerUserId: string;
let memberUserId: string;
let maputoStoreId: string;
let matolaStoreId: string;

const createdUserIds: string[] = [];
const createdDeviceIds: string[] = [];
const createdJobIds: string[] = [];
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const PASSWORD = "Equipa-F8-Teste-2026!";

async function createUser(
  label: string,
  role: "owner" | "manager" | "cashier",
  storeIds: string[],
): Promise<{ id: string; email: string }> {
  const email = `team-${label}-${suffix}@delivery.test`;
  const { data: user, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !user.user) throw new Error(`Setup equipa: ${label} — ${error?.message}`);
  createdUserIds.push(user.user.id);

  const { error: profileError } = await admin.from("staff_profiles").insert({
    user_id: user.user.id,
    full_name: `Equipa F8 ${label}`,
    role,
    active: true,
  });
  if (profileError) throw new Error(`Setup equipa: perfil ${label} — ${profileError.message}`);

  if (storeIds.length > 0) {
    const { error: storeError } = await admin
      .from("staff_stores")
      .insert(storeIds.map((storeId) => ({ user_id: user.user!.id, store_id: storeId })));
    if (storeError) throw new Error(`Setup equipa: lojas ${label} — ${storeError.message}`);
  }

  return { id: user.user.id, email };
}

async function signIn(email: string): Promise<SupabaseClient> {
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`Setup equipa: login — ${error.message}`);
  return client;
}

beforeAll(async () => {
  admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: stores, error } = await admin
    .from("stores")
    .select("id,slug")
    .in("slug", ["maputo", "matola"]);
  if (error || stores?.length !== 2) throw new Error(`Setup equipa: lojas — ${error?.message}`);
  maputoStoreId = stores.find((store) => store.slug === "maputo")!.id;
  matolaStoreId = stores.find((store) => store.slug === "matola")!.id;

  const ownerUser = await createUser("dono", "owner", []);
  ownerUserId = ownerUser.id;
  owner = await signIn(ownerUser.email);

  const managerUser = await createUser("gerente", "manager", [maputoStoreId]);
  managerUserId = managerUser.id;
  manager = await signIn(managerUser.email);

  const memberUser = await createUser("caixa", "cashier", [maputoStoreId]);
  memberUserId = memberUser.id;
});

afterEach(async () => {
  await admin.from("event_log").delete().eq("actor_user_id", ownerUserId);
});

afterAll(async () => {
  if (!admin) return;
  if (createdJobIds.length > 0) {
    await admin.from("print_jobs").delete().in("id", createdJobIds);
  }
  if (createdDeviceIds.length > 0) {
    await admin.from("devices").delete().in("id", createdDeviceIds);
  }
  for (const userId of createdUserIds) {
    await admin.auth.admin.deleteUser(userId);
  }
});

describe("F8 — equipa e permissões", () => {
  it("lista a equipa ao dono com perfil e lojas, e recusa ao gerente", async () => {
    const listed = await owner.rpc("list_staff");
    expect(listed.error).toBeNull();

    const member = (listed.data as Array<{ user_id: string; stores: Array<{ slug: string }> }>).find(
      (entry) => entry.user_id === memberUserId,
    );
    expect(member).toMatchObject({ role: "cashier", active: true });
    expect(member!.stores.map((store) => store.slug)).toEqual(["maputo"]);

    const denied = await manager.rpc("list_staff");
    expect(denied.error?.message).toContain("staff_admin_denied");
  });

  it("muda perfil e lojas com efeito imediato no isolamento", async () => {
    const memberClient = await signIn(`team-caixa-${suffix}@delivery.test`);
    const before = await memberClient.from("orders").select("store_id").limit(50);
    expect(before.error).toBeNull();
    expect((before.data ?? []).every((order) => order.store_id === maputoStoreId)).toBe(true);

    const moved = await owner.rpc("set_staff_access", {
      p_user_id: memberUserId,
      p_role: "cashier",
      p_store_ids: [matolaStoreId],
    });
    expect(moved.error).toBeNull();

    const after = await memberClient.from("orders").select("store_id").limit(50);
    expect(after.error).toBeNull();
    expect((after.data ?? []).every((order) => order.store_id === matolaStoreId)).toBe(true);

    const { data: events } = await admin
      .from("event_log")
      .select("type,payload,actor_user_id")
      .eq("type", "staff.access_changed")
      .order("created_at", { ascending: false })
      .limit(1);
    expect(events?.[0].actor_user_id).toBe(ownerUserId);

    const restored = await owner.rpc("set_staff_access", {
      p_user_id: memberUserId,
      p_role: "cashier",
      p_store_ids: [maputoStoreId],
    });
    expect(restored.error).toBeNull();
  });

  it("corta o acesso na hora e deixa o motivo no registo", async () => {
    const memberClient = await signIn(`team-caixa-${suffix}@delivery.test`);

    const revoked = await owner.rpc("deactivate_staff", {
      p_user_id: memberUserId,
      p_reason: "Saiu da equipa",
    });
    expect(revoked.error).toBeNull();

    const blocked = await memberClient.from("orders").select("id").limit(1);
    expect(blocked.data ?? []).toEqual([]);

    const { data: events } = await admin
      .from("event_log")
      .select("type,payload,actor_user_id")
      .eq("type", "staff.access_revoked")
      .order("created_at", { ascending: false })
      .limit(1);
    expect(events?.[0]).toMatchObject({ actor_user_id: ownerUserId });
    expect(events?.[0].payload).toMatchObject({ user_id: memberUserId, reason: "Saiu da equipa" });

    const reactivated = await owner.rpc("set_staff_access", {
      p_user_id: memberUserId,
      p_role: "cashier",
      p_store_ids: [maputoStoreId],
      p_active: true,
    });
    expect(reactivated.error).toBeNull();
  });

  it("deixa o dono definir o PIN de um membro sem o guardar legível", async () => {
    const set = await owner.rpc("set_staff_pin", { p_user_id: memberUserId, p_pin: "7391" });
    expect(set.error).toBeNull();

    const { data: profile } = await admin
      .from("staff_profiles")
      .select("pin_hash")
      .eq("user_id", memberUserId)
      .single();
    expect(profile?.pin_hash).toBeTruthy();
    expect(profile?.pin_hash).not.toContain("7391");

    const weak = await owner.rpc("set_staff_pin", { p_user_id: memberUserId, p_pin: "12" });
    expect(weak.error).not.toBeNull();

    const denied = await manager.rpc("set_staff_pin", {
      p_user_id: memberUserId,
      p_pin: "5555",
    });
    expect(denied.error?.message).toContain("staff_admin_denied");
  });
});

describe("F8 — digest diário", () => {
  it("resume o dia por loja e respeita o alcance de quem pergunta", async () => {
    const ownerDigest = await owner.rpc("get_daily_digest", { p_day: null });
    expect(ownerDigest.error).toBeNull();

    const payload = ownerDigest.data as {
      day: string;
      stores: Array<{
        store_id: string;
        store_name: string;
        orders_count: number;
        revenue_cents: number;
        payments: Record<string, number>;
        cash_closes: unknown[];
        incidents: number;
      }>;
    };
    expect(payload.stores.length).toBeGreaterThan(1);
    expect(typeof payload.stores[0].orders_count).toBe("number");
    expect(typeof payload.stores[0].revenue_cents).toBe("number");

    const managerDigest = await manager.rpc("get_daily_digest", { p_day: null });
    expect(managerDigest.error).toBeNull();
    const managerStores = (managerDigest.data as { stores: Array<{ store_id: string }> }).stores;
    expect(managerStores).toHaveLength(1);
    expect(managerStores[0].store_id).toBe(maputoStoreId);
  });
});

describe("F8 — painel Sistema", () => {
  it("mostra o semáforo da loja com dispositivos, fila e último pedido", async () => {
    const { data: device, error: deviceError } = await admin
      .from("devices")
      .insert({
        store_id: maputoStoreId,
        kind: "bridge",
        label: "Bridge F8",
        device_key_hash: `f8-bridge-${suffix}`,
        last_seen_at: new Date().toISOString(),
        app_version: "1.2.3",
      })
      .select("id")
      .single();
    expect(deviceError).toBeNull();
    createdDeviceIds.push(device!.id);

    const status = await manager.rpc("get_system_status");
    expect(status.error).toBeNull();

    const payload = status.data as {
      stores: Array<{
        store_id: string;
        store_name: string;
        devices: Array<{ kind: string; online: boolean; label: string }>;
        print_queue: { pending: number; failed: number };
        last_order_at: string | null;
      }>;
    };

    expect(payload.stores).toHaveLength(1);
    expect(payload.stores[0].store_id).toBe(maputoStoreId);
    const bridge = payload.stores[0].devices.find((entry) => entry.label === "Bridge F8");
    expect(bridge).toMatchObject({ kind: "bridge", online: true });
    expect(typeof payload.stores[0].print_queue.pending).toBe("number");

    const ownerStatus = await owner.rpc("get_system_status");
    expect((ownerStatus.data as { stores: unknown[] }).stores.length).toBeGreaterThan(1);
  });

  it("levanta alerta de bridge calado e de impressão falhada, com a loja certa", async () => {
    const { data: silent } = await admin
      .from("devices")
      .insert({
        store_id: maputoStoreId,
        kind: "pos",
        label: "POS calado F8",
        device_key_hash: `f8-pos-${suffix}`,
        last_seen_at: new Date(Date.now() - 30 * 60_000).toISOString(),
      })
      .select("id")
      .single();
    createdDeviceIds.push(silent!.id);

    const { data: job } = await admin
      .from("print_jobs")
      .insert({
        store_id: maputoStoreId,
        station: "kitchen",
        kind: "test",
        status: "failed",
        attempts: 3,
        payload: { template: "test" },
      })
      .select("id")
      .single();
    createdJobIds.push(job!.id);

    const alerts = await manager.rpc("list_system_alerts");
    expect(alerts.error).toBeNull();

    const rows = alerts.data as Array<{
      store_id: string;
      kind: string;
      severity: string;
      message: string;
    }>;
    expect(rows.every((row) => row.store_id === maputoStoreId)).toBe(true);
    expect(rows.some((row) => row.kind === "device_silent")).toBe(true);
    expect(rows.some((row) => row.kind === "print_failed")).toBe(true);
  });
});
