/**
 * Gate de integração da 1090 — TVs da loja.
 *
 * O que este ficheiro protege:
 * - cada TV é de uma loja (Regra 3): a Matola não cria, não muda e não apaga
 *   as TVs de Maputo, nem muda uma TV de loja;
 * - o balcão não configura TVs (é operação do dono e do gerente);
 * - a TV é pública, mas só pela porta dela: `anon` não lê as tabelas, e o
 *   que `get_tv_screen` devolve não traz quem gravou nem a biblioteca inteira;
 * - a biblioteca de vídeos só regista ficheiros que existem no bucket, e só
 *   o dono ou quem carregou o ficheiro o apaga;
 * - tudo o que muda fica no `event_log` com o autor.
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

let admin: SupabaseClient;
let anon: SupabaseClient;
let owner: SupabaseClient;
let managerMatola: SupabaseClient;
let managerMaputo: SupabaseClient;
let cashierMaputo: SupabaseClient;

let maputoId: string;
let matolaId: string;
let maputoTv1: { id: string; config: unknown; last_seen_at: string | null };

const createdUserIds: string[] = [];
const createdTvIds: string[] = [];
const createdMediaPaths: string[] = [];
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const PASSWORD = "Tvs-1090-Teste-2026!";

async function createUser(
  label: string,
  role: "owner" | "manager" | "cashier",
  storeIds: string[],
): Promise<SupabaseClient> {
  const email = `tvs-${label}-${suffix}@delivery.test`;
  const { data: user, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !user.user) throw new Error(`Setup TVs: ${label} — ${error?.message}`);
  createdUserIds.push(user.user.id);

  const { error: profileError } = await admin.from("staff_profiles").insert({
    user_id: user.user.id,
    full_name: `Equipa TVs ${label}`,
    role,
    active: true,
  });
  if (profileError) throw new Error(`Setup TVs: perfil ${label} — ${profileError.message}`);

  if (storeIds.length > 0) {
    const { error: storeError } = await admin
      .from("staff_stores")
      .insert(storeIds.map((storeId) => ({ user_id: user.user!.id, store_id: storeId })));
    if (storeError) throw new Error(`Setup TVs: acesso ${label} — ${storeError.message}`);
  }

  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: loginError } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (loginError) throw new Error(`Setup TVs: login ${label} — ${loginError.message}`);
  return client;
}

function tvArgs(overrides: Record<string, unknown>) {
  return {
    p_store_id: matolaId,
    p_tv_id: null,
    p_name: "TV de teste",
    p_slug: `teste-${suffix}`.slice(0, 32),
    p_mode: "senhas",
    p_active: true,
    p_config: {},
    ...overrides,
  };
}

/** Carrega um ficheiro minúsculo com a sessão de quem o vai registar. */
async function uploadAs(client: SupabaseClient, mime = "video/mp4"): Promise<string> {
  const path = `media/${crypto.randomUUID()}.${mime === "video/mp4" ? "mp4" : "webp"}`;
  const { error } = await client.storage
    .from("tv-media")
    .upload(path, new Blob([new Uint8Array([0, 0, 0, 24])], { type: mime }), { contentType: mime });
  if (error) throw new Error(`upload ${path} — ${error.message}`);
  createdMediaPaths.push(path);
  return path;
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
  if (error || !stores || stores.length < 2) throw new Error(`Setup TVs: lojas — ${error?.message}`);
  maputoId = stores.find((s) => s.slug === "maputo")!.id;
  matolaId = stores.find((s) => s.slug === "matola")!.id;

  const { data: tv1, error: tvError } = await admin
    .from("store_tvs")
    .select("id,config,last_seen_at")
    .eq("store_id", maputoId)
    .eq("slug", "tv1")
    .single();
  if (tvError || !tv1) throw new Error(`Setup TVs: a 1090 devia criar a tv1 de Maputo — ${tvError?.message}`);
  maputoTv1 = tv1;

  owner = await createUser("dono", "owner", []);
  managerMatola = await createUser("gerente-matola", "manager", [matolaId]);
  managerMaputo = await createUser("gerente-maputo", "manager", [maputoId]);
  cashierMaputo = await createUser("caixa-maputo", "cashier", [maputoId]);
});

afterAll(async () => {
  if (!admin) return;
  if (createdTvIds.length > 0) await admin.from("store_tvs").delete().in("id", createdTvIds);
  if (maputoTv1) {
    await admin
      .from("store_tvs")
      .update({ config: maputoTv1.config, last_seen_at: maputoTv1.last_seen_at })
      .eq("id", maputoTv1.id);
  }
  if (createdMediaPaths.length > 0) {
    await admin.from("tv_media").delete().in("storage_path", createdMediaPaths);
    await admin.storage.from("tv-media").remove(createdMediaPaths);
  }
  await admin.from("event_log").delete().in("actor_user_id", createdUserIds);
  for (const userId of createdUserIds) {
    await admin.auth.admin.deleteUser(userId);
  }
});

describe("1090 — as TVs de cada loja", () => {
  it("cada loja nasce com duas TVs", async () => {
    const { data } = await admin.from("store_tvs").select("store_id,slug").in("store_id", [maputoId, matolaId]);
    for (const loja of [maputoId, matolaId]) {
      const slugs = (data ?? []).filter((t) => t.store_id === loja).map((t) => t.slug);
      expect(slugs).toEqual(expect.arrayContaining(["tv1", "tv2"]));
    }
  });

  it("anon não lê as tabelas nem configura", async () => {
    const tvs = await anon.from("store_tvs").select("id");
    expect(tvs.error !== null || (tvs.data ?? []).length === 0).toBe(true);
    const media = await anon.from("tv_media").select("id");
    expect(media.error !== null || (media.data ?? []).length === 0).toBe(true);
    const { error } = await anon.rpc("save_store_tv", tvArgs({}));
    expect(error).not.toBeNull();
  });

  it("o gerente da Matola cria uma TV na Matola, e fica registado", async () => {
    const { data, error } = await managerMatola.rpc("save_store_tv", tvArgs({ p_name: "TV da esplanada" }));
    expect(error).toBeNull();
    const tv = data as { id: string; store_id: string; slug: string; mode: string };
    createdTvIds.push(tv.id);
    expect(tv.store_id).toBe(matolaId);

    const { data: log } = await admin
      .from("event_log")
      .select("type,store_id,actor_user_id,payload")
      .eq("type", "store.tv_created")
      .eq("store_id", matolaId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    expect(log?.payload).toMatchObject({ tv_id: tv.id, name: "TV da esplanada" });
    expect(createdUserIds).toContain(log?.actor_user_id);
  });

  it("a Matola não cria TVs em Maputo", async () => {
    const { error } = await managerMatola.rpc("save_store_tv", tvArgs({ p_store_id: maputoId, p_slug: `x-${suffix}`.slice(0, 32) }));
    expect(error?.message).toContain("tv_denied");
  });

  it("a Matola não muda uma TV de Maputo, nem a passa para a sua loja", async () => {
    const mudar = await managerMatola.rpc(
      "save_store_tv",
      tvArgs({ p_store_id: maputoId, p_tv_id: maputoTv1.id, p_slug: "tv1", p_mode: "menu" }),
    );
    expect(mudar.error?.message).toContain("tv_denied");
    const roubar = await managerMatola.rpc(
      "save_store_tv",
      tvArgs({ p_store_id: matolaId, p_tv_id: maputoTv1.id, p_slug: `roubada-${suffix}`.slice(0, 32) }),
    );
    expect(roubar.error?.message).toContain("tv_denied");
  });

  it("o balcão vê as TVs da loja mas não as configura", async () => {
    const leitura = await cashierMaputo.from("store_tvs").select("id").eq("store_id", maputoId);
    expect(leitura.error).toBeNull();
    const { error } = await cashierMaputo.rpc(
      "save_store_tv",
      tvArgs({ p_store_id: maputoId, p_tv_id: maputoTv1.id, p_slug: "tv1" }),
    );
    expect(error?.message).toContain("tv_denied");
  });

  it("a Matola não lê as TVs de Maputo", async () => {
    const { data } = await managerMatola.from("store_tvs").select("id").eq("store_id", maputoId);
    expect(data ?? []).toEqual([]);
  });

  it("recusa endereço que já é outro ecrã, repetido na loja ou inválido", async () => {
    const reservado = await managerMatola.rpc("save_store_tv", tvArgs({ p_slug: "senhas" }));
    expect(reservado.error?.message).toContain("invalid_tv_slug");
    const invalido = await managerMatola.rpc("save_store_tv", tvArgs({ p_slug: "TV 1" }));
    expect(invalido.error?.message).toContain("invalid_tv_slug");
    const repetido = await managerMatola.rpc("save_store_tv", tvArgs({ p_slug: "tv1" }));
    expect(repetido.error?.message).toContain("tv_slug_taken");
    const modo = await managerMatola.rpc("save_store_tv", tvArgs({ p_slug: `m-${suffix}`.slice(0, 32), p_mode: "karaoke" }));
    expect(modo.error?.message).toContain("invalid_tv_mode");
  });

  it("o gerente de Maputo muda a TV 1 de Maputo", async () => {
    const { data, error } = await managerMaputo.rpc(
      "save_store_tv",
      tvArgs({
        p_store_id: maputoId,
        p_tv_id: maputoTv1.id,
        p_name: "TV 1",
        p_slug: "tv1",
        p_mode: "senhas_videos",
        p_config: { senhas: { title: "Já está pronto" } },
      }),
    );
    expect(error).toBeNull();
    expect((data as { config: { senhas: { title: string } } }).config.senhas.title).toBe("Já está pronto");
  });
});

describe("1090 — o ecrã público", () => {
  it("a TV lê a sua configuração sem sessão, e só o que precisa", async () => {
    const { data, error } = await anon.rpc("get_tv_screen", {
      p_store_slug: "maputo",
      p_tv_slug: "tv1",
      p_heartbeat: false,
    });
    expect(error).toBeNull();
    const screen = data as { store: Record<string, unknown>; tv: Record<string, unknown>; media: unknown[] };
    expect(screen.store.slug).toBe("maputo");
    expect(screen.tv.slug).toBe("tv1");
    expect(screen.tv).not.toHaveProperty("updated_by");
    expect(screen.tv).not.toHaveProperty("store_id");
    expect(Array.isArray(screen.media)).toBe(true);
  });

  it("um endereço sem TV devolve tv vazia (a TV explica, não rebenta)", async () => {
    const { data, error } = await anon.rpc("get_tv_screen", {
      p_store_slug: "maputo",
      p_tv_slug: "nao-existe",
      p_heartbeat: false,
    });
    expect(error).toBeNull();
    expect((data as { tv: unknown }).tv).toBeNull();
  });

  it("loja inexistente é erro", async () => {
    const { error } = await anon.rpc("get_tv_screen", { p_store_slug: "lisboa", p_tv_slug: "tv1" });
    expect(error?.message).toContain("store_not_found");
  });

  it("a TV bate o coração ao ler; a pré-visualização do painel não", async () => {
    await admin.from("store_tvs").update({ last_seen_at: null }).eq("id", maputoTv1.id);
    await anon.rpc("get_tv_screen", { p_store_slug: "maputo", p_tv_slug: "tv1", p_heartbeat: false });
    const antes = await admin.from("store_tvs").select("last_seen_at").eq("id", maputoTv1.id).single();
    expect(antes.data?.last_seen_at).toBeNull();

    await anon.rpc("get_tv_screen", { p_store_slug: "maputo", p_tv_slug: "tv1" });
    const depois = await admin.from("store_tvs").select("last_seen_at").eq("id", maputoTv1.id).single();
    expect(depois.data?.last_seen_at).not.toBeNull();
  });
});

describe("1090 — biblioteca de vídeos", () => {
  let mediaMatola: { id: string; storage_path: string };

  it("o balcão não carrega vídeos", async () => {
    const { error } = await cashierMaputo.storage
      .from("tv-media")
      .upload(`media/${crypto.randomUUID()}.mp4`, new Blob([new Uint8Array([1])], { type: "video/mp4" }), {
        contentType: "video/mp4",
      });
    expect(error).not.toBeNull();
  });

  it("não se regista um ficheiro que não está no bucket", async () => {
    const { error } = await managerMatola.rpc("register_tv_media", {
      p_kind: "video",
      p_name: "Fantasma",
      p_path: `media/${crypto.randomUUID()}.mp4`,
      p_mime: "video/mp4",
      p_size: 10,
    });
    expect(error?.message).toContain("tv_media_not_found");
  });

  it("o gerente carrega e regista; a TV que o tem na lista recebe-o", async () => {
    const path = await uploadAs(managerMatola);
    const { data, error } = await managerMatola.rpc("register_tv_media", {
      p_kind: "video",
      p_name: "Promo de teste",
      p_path: path,
      p_mime: "video/mp4",
      p_size: 4,
    });
    expect(error).toBeNull();
    mediaMatola = data as { id: string; storage_path: string };
    expect(mediaMatola.storage_path).toBe(path);

    const save = await managerMaputo.rpc(
      "save_store_tv",
      tvArgs({
        p_store_id: maputoId,
        p_tv_id: maputoTv1.id,
        p_name: "TV 1",
        p_slug: "tv1",
        p_mode: "senhas_videos",
        p_config: { videos: { playlist: [{ mediaId: mediaMatola.id }] } },
      }),
    );
    expect(save.error).toBeNull();

    const { data: screen } = await anon.rpc("get_tv_screen", {
      p_store_slug: "maputo",
      p_tv_slug: "tv1",
      p_heartbeat: false,
    });
    const media = (screen as { media: Array<{ id: string; storage_path: string; kind: string }> }).media;
    expect(media).toEqual([expect.objectContaining({ id: mediaMatola.id, storage_path: path, kind: "video" })]);
    expect(media[0]).not.toHaveProperty("created_by");
  });

  it("outro gerente não apaga o que não carregou; quem carregou apaga", async () => {
    const alheio = await managerMaputo.rpc("delete_tv_media", { p_media_id: mediaMatola.id });
    expect(alheio.error?.message).toContain("tv_media_denied");

    const proprio = await managerMatola.rpc("delete_tv_media", { p_media_id: mediaMatola.id });
    expect(proprio.error).toBeNull();
    expect((proprio.data as { storage_path: string }).storage_path).toBe(mediaMatola.storage_path);

    const { data: log } = await admin
      .from("event_log")
      .select("payload")
      .eq("type", "tv.media_deleted")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    expect(log?.payload).toMatchObject({ media_id: mediaMatola.id });
  });

  it("o dono apaga o que outro carregou", async () => {
    const path = await uploadAs(managerMatola, "image/webp");
    const { data } = await managerMatola.rpc("register_tv_media", {
      p_kind: "image",
      p_name: "Cartaz",
      p_path: path,
      p_mime: "image/webp",
      p_size: 4,
    });
    const { error } = await owner.rpc("delete_tv_media", { p_media_id: (data as { id: string }).id });
    expect(error).toBeNull();
  });
});

describe("1090 — apagar uma TV", () => {
  it("a Matola não apaga TVs de Maputo; apaga as suas", async () => {
    const alheia = await managerMatola.rpc("delete_store_tv", { p_tv_id: maputoTv1.id });
    expect(alheia.error?.message).toContain("tv_denied");

    const { data } = await managerMatola.rpc(
      "save_store_tv",
      tvArgs({ p_slug: `apagar-${suffix}`.slice(0, 32) }),
    );
    const id = (data as { id: string }).id;
    createdTvIds.push(id);
    const { error } = await managerMatola.rpc("delete_store_tv", { p_tv_id: id });
    expect(error).toBeNull();
    const { data: resto } = await admin.from("store_tvs").select("id").eq("id", id);
    expect(resto ?? []).toEqual([]);
  });
});
