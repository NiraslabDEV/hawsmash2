/**
 * Gate da 1131/1132 — extras e observações rápidas no site.
 *
 * O que tem de ser verdade:
 *  - o get_menu público traz `quick_notes` da loja pedida, e só dela (Regra 3);
 *  - uma config estragada nunca impede o cardápio de abrir;
 *  - o anon continua sem SELECT em store_pos_settings (§17);
 *  - os burgers trazem os extras pedidos, com preço do servidor e foto.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://localhost:54731";
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz";

type Addon = { id: string; name: string; price_cents: number; photo_url: string | null };
type Menu = {
  quick_notes?: string[];
  categories: Array<{ name: string; items: Array<{ name: string; addons?: Addon[] }> }>;
};

let admin: SupabaseClient;
let anon: SupabaseClient;
const originais = new Map<string, Record<string, unknown>>();
const lojas: Record<string, string> = {};

async function menu(slug: string): Promise<Menu> {
  const { data, error } = await anon.rpc("get_menu", { p_store_slug: slug, p_channel: "delivery" });
  if (error) throw new Error(error.message);
  return data as Menu;
}

async function gravarConfig(slug: string, config: Record<string, unknown>) {
  const { error } = await admin.from("store_pos_settings").update({ config }).eq("store_id", lojas[slug]);
  if (error) throw new Error(error.message);
}

beforeAll(async () => {
  admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

  const { data: stores, error } = await admin.from("stores").select("id,slug").in("slug", ["maputo", "matola"]);
  if (error || stores?.length !== 2) throw new Error(`Setup: lojas — ${error?.message}`);
  for (const store of stores) lojas[store.slug] = store.id;

  const { data: configs, error: configError } = await admin
    .from("store_pos_settings")
    .select("store_id,config")
    .in("store_id", Object.values(lojas));
  if (configError || configs?.length !== 2) throw new Error(`Setup: definições — ${configError?.message}`);
  for (const row of configs) originais.set(row.store_id, row.config as Record<string, unknown>);
});

afterAll(async () => {
  for (const [storeId, config] of originais) {
    await admin.from("store_pos_settings").update({ config }).eq("store_id", storeId);
  }
});

describe("observações rápidas no site (1131)", () => {
  it("o get_menu traz as observações da loja pedida, pela ordem dela", async () => {
    const base = originais.get(lojas.maputo)!;
    await gravarConfig("maputo", { ...base, quickNotes: ["SEM VEGETAIS", "  SEM MOLHO ", ""] });

    const data = await menu("maputo");
    expect(data.quick_notes).toEqual(["SEM VEGETAIS", "SEM MOLHO"]);
    expect(data.categories.length).toBeGreaterThan(0);
  });

  it("as observações de uma loja não aparecem no site da outra", async () => {
    const base = originais.get(lojas.matola)!;
    await gravarConfig("matola", { ...base, quickNotes: ["SÓ DA MATOLA 1131"] });

    expect((await menu("maputo")).quick_notes).not.toContain("SÓ DA MATOLA 1131");
    expect((await menu("matola")).quick_notes).toEqual(["SÓ DA MATOLA 1131"]);
  });

  it("config estragada: o cardápio abre na mesma, sem atalhos", async () => {
    const base = originais.get(lojas.maputo)!;
    await gravarConfig("maputo", { ...base, quickNotes: "não é lista" });

    const data = await menu("maputo");
    expect(data.quick_notes).toEqual([]);
    expect(data.categories.length).toBeGreaterThan(0);
  });

  it("o anon continua sem ler a tabela das definições do POS", async () => {
    const { data, error } = await anon.from("store_pos_settings").select("config");
    expect(error !== null || (data ?? []).length === 0).toBe(true);
  });
});

describe("extras dos burgers (1132)", () => {
  it("cada burger traz Macon, Brisket e Jalapeños ao preço pedido, com foto", async () => {
    const data = await menu("maputo");
    const burgers = data.categories.find((c) => /^burger/i.test(c.name));
    expect(burgers, "categoria Burgers no cardápio local").toBeTruthy();

    for (const burger of burgers!.items) {
      const extras = Object.fromEntries((burger.addons ?? []).map((a) => [a.name, a]));
      expect(extras.Macon?.price_cents, burger.name).toBe(5000);
      expect(extras.Brisket?.price_cents, burger.name).toBe(10000);
      expect(extras["Jalapeños"]?.price_cents, burger.name).toBe(5000);
      expect(extras.Brisket?.photo_url).toBe("/assets/storefront/extras/brisket.webp");
    }
  });
});
