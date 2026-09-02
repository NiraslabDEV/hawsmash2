-- HAWSMASH 2.0 — 1040: a marca sai do código e passa a ser dado.
--
-- Porquê (CLAUDE.md §18.2 · ROADMAP-PRODUTO P1): `config/brand.ts` é importado
-- por ~16 ficheiros através do alias `@brand` e os valores entram no bundle em
-- tempo de compilação. Enquanto assim for, mudar o nome ou a cor não muda nada
-- sem novo deploy, o dono não consegue editar a sua própria marca, e cada
-- cliente novo é uma cópia do repositório que colide sempre no mesmo ficheiro.
--
-- A partir daqui: a identidade vive aqui, o `config/brand.ts` fica a valer
-- como fallback de fábrica (a loja nunca abre sem marca, mesmo com a BD em
-- baixo) e a aba Aparência do painel escreve por `update_brand()`.
--
-- Não confundir com `settings` (operação da empresa) nem com `stores`
-- (operação da unidade): aqui só entra identidade — nome, cores, logo,
-- redes, contactos e o texto de montra. Nada operacional, nada de segredos.

-- ---------------------------------------------------------------------------
-- Tabela — singleton, como `settings`
-- ---------------------------------------------------------------------------
create table if not exists public.brand_settings (
  id                     smallint primary key default 1 check (id = 1),
  name                   text not null,
  tagline                text not null default '',
  legal_name             text,
  nuit                   text,
  locale                 text not null default 'pt-MZ',
  currency               text not null default 'MZN',
  logo_path              text,
  favicon_path           text,
  og_image_path          text,
  receipt_footer_default text,
  -- Subárvores editáveis. Ficam em jsonb de propósito: o que é identidade
  -- essencial tem coluna própria; o que é conteúdo de montra (copy da landing,
  -- promos do funil, tons secundários) muda de restaurante para restaurante e
  -- não justifica uma coluna por campo. A aplicação faz merge profundo por
  -- cima do fallback de fábrica, portanto uma instalação nova pode gravar só
  -- o que lhe interessa e herdar o resto.
  social                 jsonb not null default '{}'::jsonb,
  contact                jsonb not null default '{}'::jsonb,
  theme                  jsonb not null default '{}'::jsonb,
  storefront             jsonb not null default '{}'::jsonb,
  updated_at             timestamptz not null default now(),
  updated_by             uuid references auth.users(id) on delete set null
);

alter table public.brand_settings enable row level security;

-- Leitura directa: só equipa. O público entra por `get_brand()` (§17: anon
-- nunca faz SELECT directo em tabela).
drop policy if exists brand_settings_staff_select on public.brand_settings;
create policy brand_settings_staff_select on public.brand_settings
for select to authenticated
using ((select private.auth_role()) is not null);

-- Escrita: por RPC, nunca directa. Sem policy de insert/update/delete, nem
-- para o dono — assim a auditoria não tem porta lateral.

-- ---------------------------------------------------------------------------
-- Bucket público da marca
-- ---------------------------------------------------------------------------
-- Público de propósito: é o logo que aparece na montra. Segredos continuam
-- fora daqui (§17). Escrita só do dono.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'brand-assets',
  'brand-assets',
  true,
  5242880,                                                  -- 5 MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml', 'image/x-icon']
)
on conflict (id) do nothing;

drop policy if exists brand_assets_public_read on storage.objects;
create policy brand_assets_public_read on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'brand-assets');

drop policy if exists brand_assets_owner_write on storage.objects;
create policy brand_assets_owner_write on storage.objects for all
  to authenticated
  using (bucket_id = 'brand-assets' and (select private.auth_is_owner()))
  with check (bucket_id = 'brand-assets' and (select private.auth_is_owner()));

-- ---------------------------------------------------------------------------
-- get_brand() — a porta pública
-- ---------------------------------------------------------------------------
-- Devolve `null` quando ainda não há linha: instalação nova renderiza com a
-- marca de fábrica em vez de rebentar. É esse o contrato com a aplicação.
create or replace function public.get_brand()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select to_jsonb(b) - 'updated_by'
  from public.brand_settings b
  where b.id = 1;
$$;

revoke all on function public.get_brand() from public;
grant execute on function public.get_brand() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- update_brand() — só o dono, sempre logado
-- ---------------------------------------------------------------------------
-- Aceita um patch parcial: a chave ausente não mexe no que lá está. As
-- subárvores (social/contact/theme/storefront) são substituídas inteiras
-- quando vêm — o painel envia sempre a subárvore completa que editou, e o
-- merge com o fallback de fábrica é feito na aplicação.
create or replace function public.update_brand(p_patch jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_before jsonb;
  v_after jsonb;
begin
  if not coalesce((select private.auth_is_owner()), false) then
    raise exception 'forbidden' using errcode = 'P0403';
  end if;

  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'invalid_payload' using errcode = 'P0400';
  end if;

  select to_jsonb(b) - 'updated_by' into v_before
  from public.brand_settings b where b.id = 1;

  insert into public.brand_settings as b (
    id, name, tagline, legal_name, nuit, locale, currency,
    logo_path, favicon_path, og_image_path, receipt_footer_default,
    social, contact, theme, storefront, updated_at, updated_by
  )
  values (
    1,
    coalesce(nullif(p_patch->>'name', ''), 'PLACEHOLDER_MARCA'),
    coalesce(p_patch->>'tagline', ''),
    nullif(p_patch->>'legal_name', ''),
    nullif(p_patch->>'nuit', ''),
    coalesce(nullif(p_patch->>'locale', ''), 'pt-MZ'),
    coalesce(nullif(p_patch->>'currency', ''), 'MZN'),
    nullif(p_patch->>'logo_path', ''),
    nullif(p_patch->>'favicon_path', ''),
    nullif(p_patch->>'og_image_path', ''),
    nullif(p_patch->>'receipt_footer_default', ''),
    coalesce(p_patch->'social', '{}'::jsonb),
    coalesce(p_patch->'contact', '{}'::jsonb),
    coalesce(p_patch->'theme', '{}'::jsonb),
    coalesce(p_patch->'storefront', '{}'::jsonb),
    now(),
    v_actor
  )
  on conflict (id) do update set
    name = coalesce(nullif(p_patch->>'name', ''), b.name),
    tagline = case
      when jsonb_exists(p_patch, 'tagline') then coalesce(p_patch->>'tagline', '') else b.tagline end,
    legal_name = case
      when jsonb_exists(p_patch, 'legal_name') then nullif(p_patch->>'legal_name', '') else b.legal_name end,
    nuit = case
      when jsonb_exists(p_patch, 'nuit') then nullif(p_patch->>'nuit', '') else b.nuit end,
    locale = coalesce(nullif(p_patch->>'locale', ''), b.locale),
    currency = coalesce(nullif(p_patch->>'currency', ''), b.currency),
    logo_path = case
      when jsonb_exists(p_patch, 'logo_path') then nullif(p_patch->>'logo_path', '') else b.logo_path end,
    favicon_path = case
      when jsonb_exists(p_patch, 'favicon_path') then nullif(p_patch->>'favicon_path', '') else b.favicon_path end,
    og_image_path = case
      when jsonb_exists(p_patch, 'og_image_path') then nullif(p_patch->>'og_image_path', '') else b.og_image_path end,
    receipt_footer_default = case
      when jsonb_exists(p_patch, 'receipt_footer_default') then nullif(p_patch->>'receipt_footer_default', '')
      else b.receipt_footer_default end,
    social = case
      when jsonb_exists(p_patch, 'social') then coalesce(p_patch->'social', '{}'::jsonb) else b.social end,
    contact = case
      when jsonb_exists(p_patch, 'contact') then coalesce(p_patch->'contact', '{}'::jsonb) else b.contact end,
    theme = case
      when jsonb_exists(p_patch, 'theme') then coalesce(p_patch->'theme', '{}'::jsonb) else b.theme end,
    storefront = case
      when jsonb_exists(p_patch, 'storefront') then coalesce(p_patch->'storefront', '{}'::jsonb) else b.storefront end,
    updated_at = now(),
    updated_by = v_actor;

  select to_jsonb(b) - 'updated_by' into v_after
  from public.brand_settings b where b.id = 1;

  -- Evento de empresa: a marca não pertence a nenhuma loja (store_id null).
  insert into public.event_log (store_id, actor_user_id, type, payload)
  values (
    null,
    v_actor,
    'brand.updated',
    jsonb_build_object(
      'changed', (
        select coalesce(jsonb_agg(k order by k), '[]'::jsonb)
        from jsonb_object_keys(coalesce(p_patch, '{}'::jsonb)) as k
        where v_before is null or (v_before -> k) is distinct from (v_after -> k)
      )
    )
  );

  return v_after;
end;
$$;

revoke all on function public.update_brand(jsonb) from public;
grant execute on function public.update_brand(jsonb) to authenticated, service_role;
