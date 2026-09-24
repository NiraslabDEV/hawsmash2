-- 1090: TVs da loja — configuradas no painel, com vídeos.
--
-- Pedido do dono, 24 Set: um módulo TVs no painel. Duas TVs por loja, com
-- espaço para mais; as senhas passam lá, e os vídeos também. Tudo o que der
-- para configurar, configura-se ali.
--
-- Até aqui havia duas rotas fixas (`/tv/[loja]/menu` e `/tv/[loja]/senhas`) e
-- nada para escolher: mudar o que uma TV mostra era mudar o URL na box da TV.
-- A partir daqui:
--
-- 1. `store_tvs` — uma linha por ecrã físico, com endereço próprio
--    (`/tv/maputo/tv1`), modo (senhas + vídeos, só senhas, só vídeos,
--    cardápio), ligada/desligada e um `config` jsonb (títulos, tempos,
--    rotação, lista de vídeos). A TV relê a linha a cada 30 s: o painel manda
--    no ecrã sem ninguém tocar na box. É da loja (Regra 3).
--
-- 2. `tv_media` + bucket `tv-media` — a biblioteca de vídeos e imagens. É da
--    empresa, como o cardápio: carrega-se uma vez e usa-se nas TVs de
--    qualquer loja. O que cada TV passa é da loja, dentro do `config`.
--    // DECISÃO: biblioteca partilhada (menos uploads repetidos de 50 MB);
--    // o risco — um gerente apagar um vídeo que a outra loja usa — fica
--    // fechado por só o dono ou quem carregou poder apagar.
--
-- 3. `get_tv_screen` — a única porta pública. Devolve a configuração da TV e
--    só os ficheiros que ela passa; bate o coração da TV (`last_seen_at`)
--    para o painel mostrar "ligada" / "sem sinal".
--
-- O que a TV nunca recebe: nomes, telefones, valores de pedidos, quem gravou.
-- Portável: nada aqui sabe o nome do cliente (§18.3). Forward-only (§11.7).

-- ---------------------------------------------------------------------------
-- Ecrãs
-- ---------------------------------------------------------------------------
create table if not exists public.store_tvs (
  id           uuid primary key default gen_random_uuid(),
  store_id     uuid not null references public.stores(id) on delete cascade,
  -- Vai no URL da box: imutável na prática, mas editável no painel (a box
  -- só precisa do endereço novo). `menu`, `senhas` e `kds` já são rotas.
  slug         text not null
               check (slug ~ '^[a-z0-9][a-z0-9-]{0,31}$' and slug not in ('menu', 'senhas', 'kds')),
  name         text not null check (char_length(btrim(name)) between 1 and 60),
  mode         text not null default 'senhas'
               check (mode in ('senhas_videos', 'senhas', 'videos', 'menu')),
  config       jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  active       boolean not null default true,
  sort         int not null default 0,
  last_seen_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  updated_by   uuid references auth.users(id) on delete set null,
  unique (store_id, slug)
);

create index if not exists store_tvs_store_sort_idx on public.store_tvs (store_id, sort);

comment on table public.store_tvs is
  'TVs de cada loja (senhas, vídeos, cardápio). Escrita só por save_store_tv(); a TV lê por get_tv_screen().';

alter table public.store_tvs enable row level security;

drop policy if exists store_tvs_select on public.store_tvs;
create policy store_tvs_select on public.store_tvs
for select to authenticated
using ((select private.auth_can_store(store_id)));

-- Escrita só por RPC: a auditoria não tem porta lateral.
revoke all on public.store_tvs from anon;
revoke insert, update, delete on public.store_tvs from authenticated;
grant select on public.store_tvs to authenticated;
grant select, insert, update, delete on public.store_tvs to service_role;

-- Duas TVs por loja para começar (pedido do dono). Mais, no painel.
insert into public.store_tvs (store_id, slug, name, mode, sort)
select s.id, v.slug, v.name, v.mode, v.sort
from public.stores s
cross join (values
  ('tv1', 'TV 1', 'senhas_videos', 1),
  ('tv2', 'TV 2', 'videos', 2)
) as v(slug, name, mode, sort)
on conflict (store_id, slug) do nothing;

-- ---------------------------------------------------------------------------
-- Biblioteca de vídeos e imagens
-- ---------------------------------------------------------------------------
create table if not exists public.tv_media (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('video', 'image')),
  name         text not null check (char_length(btrim(name)) between 1 and 120),
  -- Um nome novo por ficheiro, nunca reescrito: a TV guarda-o em cache pelo
  -- endereço (lib/tv/media.ts).
  storage_path text not null unique
               check (storage_path ~ '^media/[a-z0-9-]{1,64}\.(mp4|webm|jpg|png|webp)$'),
  mime         text not null
               check (mime in ('video/mp4', 'video/webm', 'image/jpeg', 'image/png', 'image/webp')),
  size_bytes   bigint not null check (size_bytes >= 0),
  created_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id) on delete set null,
  check ((kind = 'video') = (mime like 'video/%'))
);

comment on table public.tv_media is
  'Vídeos e imagens das TVs (bucket tv-media). Da empresa; cada TV escolhe os seus em store_tvs.config.';

alter table public.tv_media enable row level security;

-- Quem configura TVs (dono e gerente). Nunca `using (true)`.
drop policy if exists tv_media_select on public.tv_media;
create policy tv_media_select on public.tv_media
for select to authenticated
using ((select private.auth_role()) in ('owner', 'manager'));

revoke all on public.tv_media from anon;
revoke insert, update, delete on public.tv_media from authenticated;
grant select on public.tv_media to authenticated;
grant select, insert, update, delete on public.tv_media to service_role;

-- Bucket público: a TV não tem sessão, e um vídeo promocional não é segredo.
-- 200 MB por ficheiro; o projecto pode ter um tecto global menor (B-113).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'tv-media',
  'tv-media',
  true,
  209715200,
  array['video/mp4', 'video/webm', 'image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Sem policy para `anon`: o URL público serve o ficheiro sem listar o bucket.
drop policy if exists tv_media_staff_read on storage.objects;
create policy tv_media_staff_read on storage.objects
for select to authenticated
using (bucket_id = 'tv-media' and (select private.auth_role()) in ('owner', 'manager'));

drop policy if exists tv_media_staff_insert on storage.objects;
create policy tv_media_staff_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'tv-media'
  and (select private.auth_role()) in ('owner', 'manager')
  and name ~ '^media/[a-z0-9-]{1,64}\.(mp4|webm|jpg|png|webp)$'
);

-- Apaga o dono, ou o gerente que carregou. Sem update: ficheiro não se reescreve.
drop policy if exists tv_media_staff_delete on storage.objects;
create policy tv_media_staff_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'tv-media'
  and (
    (select private.auth_is_owner())
    or ((select private.auth_role()) = 'manager' and owner_id = (select auth.uid())::text)
  )
);

-- ---------------------------------------------------------------------------
-- save_store_tv — criar (p_tv_id null) ou mudar uma TV
-- ---------------------------------------------------------------------------
create or replace function public.save_store_tv(
  p_store_id uuid,
  p_tv_id    uuid,
  p_name     text,
  p_slug     text,
  p_mode     text,
  p_active   boolean,
  p_config   jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_role   text;
  v_before public.store_tvs;
  v_row    public.store_tvs;
  v_name   text := btrim(coalesce(p_name, ''));
  v_slug   text := coalesce(p_slug, '');
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0020';
  end if;

  v_role := private.auth_role();
  if v_role is null or v_role not in ('owner', 'manager')
     or p_store_id is null or not private.auth_can_store(p_store_id) then
    raise exception 'tv_denied' using errcode = 'P0403';
  end if;

  if not exists (select 1 from public.stores where id = p_store_id) then
    raise exception 'store_not_found' using errcode = 'P0404';
  end if;

  if v_slug !~ '^[a-z0-9][a-z0-9-]{0,31}$' or v_slug in ('menu', 'senhas', 'kds') then
    raise exception 'invalid_tv_slug' using errcode = 'P0400';
  end if;
  if char_length(v_name) not between 1 and 60 then
    raise exception 'invalid_tv_name' using errcode = 'P0400';
  end if;
  if p_mode is null or p_mode not in ('senhas_videos', 'senhas', 'videos', 'menu') then
    raise exception 'invalid_tv_mode' using errcode = 'P0400';
  end if;
  -- Tecto de tamanho: são definições de ecrã, não um sítio para guardar coisas.
  if p_config is null or jsonb_typeof(p_config) <> 'object' or length(p_config::text) > 32768 then
    raise exception 'invalid_tv_config' using errcode = 'P0400';
  end if;

  if p_tv_id is not null then
    select * into v_before from public.store_tvs where id = p_tv_id for update;
    if not found then
      raise exception 'tv_not_found' using errcode = 'P0404';
    end if;
    -- Uma TV não muda de loja: seria o ecrã de uma casa a mostrar a outra.
    if v_before.store_id <> p_store_id then
      raise exception 'tv_denied' using errcode = 'P0403';
    end if;
  elsif (select count(*) from public.store_tvs where store_id = p_store_id) >= 20 then
    raise exception 'tv_limit_reached' using errcode = 'P0409';
  end if;

  if exists (
    select 1 from public.store_tvs
    where store_id = p_store_id and slug = v_slug and id is distinct from p_tv_id
  ) then
    raise exception 'tv_slug_taken' using errcode = 'P0409';
  end if;

  begin
    if p_tv_id is null then
      insert into public.store_tvs (store_id, slug, name, mode, config, active, sort, updated_by)
      values (
        p_store_id, v_slug, v_name, p_mode, p_config, coalesce(p_active, true),
        coalesce((select max(sort) + 1 from public.store_tvs where store_id = p_store_id), 1),
        v_uid
      )
      returning * into v_row;
    else
      update public.store_tvs set
        slug = v_slug,
        name = v_name,
        mode = p_mode,
        config = p_config,
        active = coalesce(p_active, active),
        updated_at = now(),
        updated_by = v_uid
      where id = p_tv_id
      returning * into v_row;
    end if;
  exception when unique_violation then
    -- Dois painéis a criar a mesma TV ao mesmo tempo.
    raise exception 'tv_slug_taken' using errcode = 'P0409';
  end;

  insert into public.event_log (store_id, actor_user_id, type, payload)
  values (
    p_store_id,
    v_uid,
    case when p_tv_id is null then 'store.tv_created' else 'store.tv_saved' end,
    jsonb_build_object(
      'tv_id', v_row.id,
      'slug', v_row.slug,
      'name', v_row.name,
      'mode', v_row.mode,
      'active', v_row.active,
      'previous', case when p_tv_id is null then null else jsonb_build_object(
        'slug', v_before.slug, 'name', v_before.name, 'mode', v_before.mode, 'active', v_before.active
      ) end,
      -- Só as secções que mudaram: responde a "quem tirou os vídeos da TV 2?".
      'changed', (
        select coalesce(jsonb_agg(k order by k), '[]'::jsonb)
        from (
          select key as k from jsonb_each(p_config)
          union
          select key from jsonb_each(coalesce(v_before.config, '{}'::jsonb))
        ) chaves
        where (p_config -> k) is distinct from (coalesce(v_before.config, '{}'::jsonb) -> k)
      )
    )
  );

  return jsonb_build_object(
    'id', v_row.id,
    'store_id', v_row.store_id,
    'slug', v_row.slug,
    'name', v_row.name,
    'mode', v_row.mode,
    'config', v_row.config,
    'active', v_row.active,
    'sort', v_row.sort,
    'last_seen_at', v_row.last_seen_at,
    'updated_at', v_row.updated_at
  );
end;
$$;

revoke all on function public.save_store_tv(uuid, uuid, text, text, text, boolean, jsonb) from public, anon;
grant execute on function public.save_store_tv(uuid, uuid, text, text, text, boolean, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- delete_store_tv — a box foi para outro sítio
-- ---------------------------------------------------------------------------
create or replace function public.delete_store_tv(p_tv_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := (select auth.uid());
  v_role text;
  v_tv   public.store_tvs;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0020';
  end if;

  v_role := private.auth_role();
  if v_role is null or v_role not in ('owner', 'manager') then
    raise exception 'tv_denied' using errcode = 'P0403';
  end if;

  select * into v_tv from public.store_tvs where id = p_tv_id for update;
  if not found then
    raise exception 'tv_not_found' using errcode = 'P0404';
  end if;
  if not private.auth_can_store(v_tv.store_id) then
    raise exception 'tv_denied' using errcode = 'P0403';
  end if;

  delete from public.store_tvs where id = p_tv_id;

  insert into public.event_log (store_id, actor_user_id, type, payload)
  values (v_tv.store_id, v_uid, 'store.tv_deleted',
    jsonb_build_object('tv_id', v_tv.id, 'slug', v_tv.slug, 'name', v_tv.name, 'mode', v_tv.mode));

  return jsonb_build_object('id', v_tv.id);
end;
$$;

revoke all on function public.delete_store_tv(uuid) from public, anon;
grant execute on function public.delete_store_tv(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- register_tv_media — depois de carregar o ficheiro no bucket
-- ---------------------------------------------------------------------------
-- Só regista o que está mesmo no bucket, e com o tamanho e o tipo que o
-- bucket diz — não os que o browser disse. Repetir devolve a mesma linha.
create or replace function public.register_tv_media(
  p_kind text,
  p_name text,
  p_path text,
  p_mime text,
  p_size bigint
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_role   text;
  v_object record;
  v_mime   text;
  v_row    public.tv_media;
  v_name   text := btrim(coalesce(p_name, ''));
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0020';
  end if;
  v_role := private.auth_role();
  if v_role is null or v_role not in ('owner', 'manager') then
    raise exception 'tv_media_denied' using errcode = 'P0403';
  end if;

  if p_kind is null or p_kind not in ('video', 'image')
     or p_path is null or p_path !~ '^media/[a-z0-9-]{1,64}\.(mp4|webm|jpg|png|webp)$'
     or char_length(v_name) not between 1 and 120 then
    raise exception 'invalid_tv_media' using errcode = 'P0400';
  end if;

  select o.metadata into v_object
  from storage.objects o
  where o.bucket_id = 'tv-media' and o.name = p_path;
  if not found then
    raise exception 'tv_media_not_found' using errcode = 'P0404';
  end if;

  v_mime := coalesce(nullif(v_object.metadata ->> 'mimetype', ''), p_mime);
  if v_mime is null
     or v_mime not in ('video/mp4', 'video/webm', 'image/jpeg', 'image/png', 'image/webp')
     or (p_kind = 'video') <> (v_mime like 'video/%') then
    raise exception 'invalid_tv_media' using errcode = 'P0400';
  end if;

  insert into public.tv_media (kind, name, storage_path, mime, size_bytes, created_by)
  values (
    p_kind, v_name, p_path, v_mime,
    greatest(coalesce((v_object.metadata ->> 'size')::bigint, p_size, 0), 0),
    v_uid
  )
  on conflict (storage_path) do nothing
  returning * into v_row;

  if v_row.id is null then
    select * into v_row from public.tv_media where storage_path = p_path;
  else
    insert into public.event_log (store_id, actor_user_id, type, payload)
    values (null, v_uid, 'tv.media_added', jsonb_build_object(
      'media_id', v_row.id, 'name', v_row.name, 'kind', v_row.kind, 'size_bytes', v_row.size_bytes));
  end if;

  return jsonb_build_object(
    'id', v_row.id,
    'kind', v_row.kind,
    'name', v_row.name,
    'storage_path', v_row.storage_path,
    'mime', v_row.mime,
    'size_bytes', v_row.size_bytes,
    'created_at', v_row.created_at,
    'created_by', v_row.created_by
  );
end;
$$;

revoke all on function public.register_tv_media(text, text, text, text, bigint) from public, anon;
grant execute on function public.register_tv_media(text, text, text, text, bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- delete_tv_media — o dono, ou quem carregou
-- ---------------------------------------------------------------------------
-- Devolve o caminho: o painel apaga o ficheiro do bucket a seguir (a API de
-- Storage é que apaga o ficheiro; apagar a linha à mão deixava-o órfão).
-- As TVs que o tinham na lista saltam-no (`resolvePlaylist`).
create or replace function public.delete_tv_media(p_media_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_role  text;
  v_media public.tv_media;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0020';
  end if;
  v_role := private.auth_role();
  if v_role is null or v_role not in ('owner', 'manager') then
    raise exception 'tv_media_denied' using errcode = 'P0403';
  end if;

  select * into v_media from public.tv_media where id = p_media_id for update;
  if not found then
    raise exception 'tv_media_not_found' using errcode = 'P0404';
  end if;
  if v_role <> 'owner' and v_media.created_by is distinct from v_uid then
    raise exception 'tv_media_denied' using errcode = 'P0403';
  end if;

  delete from public.tv_media where id = p_media_id;

  insert into public.event_log (store_id, actor_user_id, type, payload)
  values (null, v_uid, 'tv.media_deleted', jsonb_build_object(
    'media_id', v_media.id, 'name', v_media.name, 'storage_path', v_media.storage_path));

  return jsonb_build_object('id', v_media.id, 'storage_path', v_media.storage_path);
end;
$$;

revoke all on function public.delete_tv_media(uuid) from public, anon;
grant execute on function public.delete_tv_media(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- get_tv_screen — a porta da TV (sem sessão)
-- ---------------------------------------------------------------------------
-- Uma TV sem linha devolve `tv: null` em vez de erro: o ecrã explica o que
-- falta em vez de ficar numa página de erro. `p_heartbeat = false` é a
-- pré-visualização do painel — não pode fazer uma TV desligada parecer ligada.
create or replace function public.get_tv_screen(
  p_store_slug text,
  p_tv_slug    text,
  p_heartbeat  boolean default true
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_store public.stores%rowtype;
  v_tv    public.store_tvs%rowtype;
  v_store_json jsonb;
begin
  select s.* into v_store
  from public.stores s
  where s.slug = p_store_slug and s.active;
  if not found then
    raise exception 'store_not_found' using errcode = 'P0404';
  end if;

  v_store_json := jsonb_build_object('slug', v_store.slug, 'short_name', v_store.short_name);

  select t.* into v_tv
  from public.store_tvs t
  where t.store_id = v_store.id and t.slug = lower(coalesce(p_tv_slug, ''));
  if not found then
    return jsonb_build_object('store', v_store_json, 'tv', null, 'media', '[]'::jsonb, 'server_time', now());
  end if;

  -- Uma escrita a cada ~30 s por TV, no máximo.
  if coalesce(p_heartbeat, true)
     and (v_tv.last_seen_at is null or v_tv.last_seen_at < now() - interval '25 seconds') then
    update public.store_tvs set last_seen_at = now() where id = v_tv.id;
  end if;

  return jsonb_build_object(
    'store', v_store_json,
    'tv', jsonb_build_object(
      'id', v_tv.id,
      'slug', v_tv.slug,
      'name', v_tv.name,
      'mode', v_tv.mode,
      'active', v_tv.active,
      'config', v_tv.config,
      'updated_at', v_tv.updated_at
    ),
    -- Só o que esta TV passa — nunca a biblioteca inteira.
    'media', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', m.id,
        'kind', m.kind,
        'name', m.name,
        'storage_path', m.storage_path,
        'mime', m.mime
      )), '[]'::jsonb)
      from public.tv_media m
      where m.id::text in (
        select lower(e ->> 'mediaId')
        from jsonb_array_elements(
          case when jsonb_typeof(v_tv.config -> 'videos' -> 'playlist') = 'array'
               then v_tv.config -> 'videos' -> 'playlist'
               else '[]'::jsonb end
        ) e
      )
    ),
    'server_time', now()
  );
end;
$$;

revoke all on function public.get_tv_screen(text, text, boolean) from public;
grant execute on function public.get_tv_screen(text, text, boolean) to anon, authenticated, service_role;
