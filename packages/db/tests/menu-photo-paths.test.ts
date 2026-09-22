/**
 * Gate da 1052 — nenhuma foto do cardápio com caminho relativo.
 *
 * O `photo_url` vai directo para o `src` do componente de imagem, sem
 * normalização. Um caminho relativo (`assets/burger.webp`) resolve a partir da
 * rota: em `/l/maputo` o browser pede `/l/assets/burger.webp` e recebe 404 —
 * sem erro, sem aviso, só um cardápio sem fotos.
 *
 * Foi assim que o LIVE ficou, com a importação do menu do HAWSMASH 1.0 por
 * cima do que as migrations tinham gravado. Este teste é o que impede que
 * volte a acontecer sem ninguém reparar.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://localhost:54731";
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz";

/** Absoluto do site (`/…`) ou endereço completo (`http…`). Nada pelo meio. */
function caminhoServivel(url: string | null): boolean {
  if (url === null || url === "") return true;
  return url.startsWith("/") || url.startsWith("http://") || url.startsWith("https://");
}

let admin: SupabaseClient;

beforeAll(() => {
  admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
});

describe("1052 · fotos do cardápio", () => {
  it("nenhum produto tem foto com caminho relativo", async () => {
    const { data, error } = await admin.from("menu_items").select("name,photo_url");
    expect(error).toBeNull();

    const relativas = (data ?? []).filter((i) => !caminhoServivel(i.photo_url as string | null));
    expect(relativas.map((i) => `${i.name}: ${i.photo_url}`)).toEqual([]);
  });

  it("nenhuma variante tem foto com caminho relativo", async () => {
    const { data, error } = await admin.from("menu_item_variants").select("name,photo_url");
    expect(error).toBeNull();

    const relativas = (data ?? []).filter((v) => !caminhoServivel(v.photo_url as string | null));
    expect(relativas.map((v) => `${v.name}: ${v.photo_url}`)).toEqual([]);
  });
});
