/**
 * Testes de integração contra Supabase local — F4.1 (Marketing & Tracking).
 * Requer `supabase start` + `pnpm db:migrate` antes de correr.
 *
 * Coberturas (ROADMAP F4.1):
 *   (a) get_menu() devolve o objecto 'marketing' com os campos públicos (A)
 *   (b) get_menu() NUNCA expõe os tokens secretos (B) — nem na raiz nem em marketing
 *   (c) anon NÃO pode chamar get_secret_settings (sem grant)
 *   (d) authenticated/service_role obtém os tokens (B) via get_secret_settings
 */
import { describe, it, expect, beforeAll } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://localhost:54531";

const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";

const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz";

const PUBLIC_FIELDS = [
  "gtm_container_id",
  "meta_pixel_id",
  "ga4_measurement_id",
  "gads_conversion_id",
  "gads_conversion_label",
] as const;

const SECRET_FIELDS = ["meta_capi_token", "gads_developer_token"] as const;

let anon: SupabaseClient;
let admin: SupabaseClient;

beforeAll(async () => {
  anon = createClient(SUPABASE_URL, ANON_KEY);
  admin = createClient(SUPABASE_URL, SERVICE_KEY);

  // Semeia valores conhecidos (públicos + secretos) na linha singleton.
  const { error } = await admin
    .from("settings")
    .update({
      gtm_container_id: "GTM-TEST01",
      meta_pixel_id: "111222333",
      ga4_measurement_id: "G-TESTABCDE",
      gads_conversion_id: "AW-999888777",
      gads_conversion_label: "LbLtEsT",
      meta_capi_token: "SECRET_capi_should_never_leak",
      gads_developer_token: "SECRET_devtoken_should_never_leak",
    })
    .eq("id", 1);

  if (error) throw new Error(`Setup falhou — ${error.message}. Corre 'pnpm db:migrate'.`);
});

// ─── (a) marketing público presente ─────────────────────────────────────────

describe("(a) get_menu() — objecto marketing público", () => {
  it("devolve marketing com os 5 campos (A)", async () => {
    const { data, error } = await anon.rpc("get_menu", { p_store_slug: "maputo" });
    expect(error).toBeNull();
    expect(data.marketing).toBeTruthy();
    for (const f of PUBLIC_FIELDS) {
      expect(data.marketing).toHaveProperty(f);
    }
    expect(data.marketing.gtm_container_id).toBe("GTM-TEST01");
    expect(data.marketing.meta_pixel_id).toBe("111222333");
  });
});

// ─── (b) segredos NUNCA vazam por get_menu (anon) ───────────────────────────

describe("(b) get_menu() — tokens secretos (B) nunca expostos", () => {
  it("nenhum token secreto aparece no JSON serializado do get_menu", async () => {
    const { data } = await anon.rpc("get_menu", { p_store_slug: "maputo" });
    const blob = JSON.stringify(data);
    for (const f of SECRET_FIELDS) {
      expect(blob).not.toContain(f);
    }
    expect(blob).not.toContain("SECRET_capi_should_never_leak");
    expect(blob).not.toContain("SECRET_devtoken_should_never_leak");
    // marketing não contém as chaves secretas
    for (const f of SECRET_FIELDS) {
      expect(data.marketing).not.toHaveProperty(f);
    }
  });
});

// ─── (c) anon não pode obter os segredos ────────────────────────────────────

describe("(c) get_secret_settings() — bloqueado para anon", () => {
  it("anon recebe erro de permissão (sem grant)", async () => {
    const { data, error } = await anon.rpc("get_secret_settings");
    expect(error).not.toBeNull();
    expect(data).toBeNull();
  });

  it("anon SELECT direto em settings retorna vazio (RLS)", async () => {
    const { data, error } = await anon.from("settings").select("meta_capi_token");
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});

// ─── (d) server-side obtém os segredos ──────────────────────────────────────

describe("(d) get_secret_settings() — server-side obtém os tokens (B)", () => {
  it("service_role recebe os dois tokens", async () => {
    const { data, error } = await admin.rpc("get_secret_settings");
    expect(error).toBeNull();
    expect(data.meta_capi_token).toBe("SECRET_capi_should_never_leak");
    expect(data.gads_developer_token).toBe("SECRET_devtoken_should_never_leak");
  });
});
