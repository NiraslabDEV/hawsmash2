/**
 * Gate de integração da F2 contra o Supabase de teste/staging.
 * Nunca apontar estas credenciais ao projecto de produção.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://localhost:54731";
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz";

let admin: SupabaseClient;
let maputoStoreId: string;
const createdDeviceIds: string[] = [];

beforeAll(async () => {
  admin = createClient(SUPABASE_URL, SERVICE_KEY);

  const { data: store, error } = await admin
    .from("stores")
    .select("id")
    .eq("slug", "maputo")
    .single();

  if (error || !store) {
    throw new Error(`Setup POS: loja Maputo não encontrada — ${error?.message}`);
  }

  maputoStoreId = store.id;
});

afterAll(async () => {
  if (createdDeviceIds.length > 0) {
    await admin.from("devices").delete().in("id", createdDeviceIds);
  }
});

describe("F2 — schema do POS", () => {
  it("expõe os campos de venda de balcão em orders", async () => {
    const { error } = await admin
      .from("orders")
      .select(
        "client_sale_id,daily_number,cash_received_cents,change_cents,needs_review,channel",
      )
      .limit(1);

    expect(error).toBeNull();
  });

  it("regista um dispositivo POS ligado a uma loja", async () => {
    const { data, error } = await admin
      .from("devices")
      .insert({
        store_id: maputoStoreId,
        kind: "pos",
        label: "POS teste F2",
        device_key_hash: "teste-f2-chave-nao-real",
      })
      .select("id,store_id,kind,active")
      .single();

    expect(error).toBeNull();
    expect(data).toMatchObject({
      store_id: maputoStoreId,
      kind: "pos",
      active: true,
    });

    if (data?.id) createdDeviceIds.push(data.id);
  });

  it("rejeita tipos de dispositivo desconhecidos", async () => {
    const { error } = await admin.from("devices").insert({
      store_id: maputoStoreId,
      kind: "terminal_desconhecido",
      label: "Inválido",
      device_key_hash: "teste-f2-invalido-nao-real",
    });

    expect(error).not.toBeNull();
  });
});
