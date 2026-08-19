-- ============================================================================
-- DELIVERY OS — F4.1: Marketing & Tracking (config no admin)
-- Colunas em settings: (A) IDs públicos + (B) tokens secretos.
-- get_menu() expõe SÓ (A). get_secret_settings() devolve (B) a authenticated.
-- Ref: CLAUDE.md secção 16.2
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- (A) IDs PÚBLICOS — vão para o client (carregam os scripts). OK no get_menu().
-- ────────────────────────────────────────────────────────────────────────────
alter table settings add column if not exists gtm_container_id      text;
alter table settings add column if not exists meta_pixel_id         text;
alter table settings add column if not exists ga4_measurement_id    text;
alter table settings add column if not exists gads_conversion_id    text;
alter table settings add column if not exists gads_conversion_label text;

-- ────────────────────────────────────────────────────────────────────────────
-- (B) SEGREDOS — só servidor. NUNCA no get_menu() nem em qualquer RPC anon.
-- ────────────────────────────────────────────────────────────────────────────
alter table settings add column if not exists meta_capi_token      text;
alter table settings add column if not exists gads_developer_token text;

-- ────────────────────────────────────────────────────────────────────────────
-- get_menu(): adiciona objecto 'marketing' com SÓ os campos (A).
-- Mantém o contrato anterior (payment_settings + categories + zones).
-- Output é sempre explícito (jsonb_build_object) — os tokens (B) existem em
-- v_s mas NUNCA são listados aqui. Não devolver v_s inteiro.
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.get_menu()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_s record;
begin
  select * into v_s from settings where id = 1;

  return jsonb_build_object(
    'accepting_orders', v_s.accepting_orders,
    'payment_provider', v_s.payment_provider,
    'mpesa_number',     v_s.mpesa_number,
    'mpesa_name',       v_s.mpesa_name,
    'emola_number',     v_s.emola_number,
    'emola_name',       v_s.emola_name,
    -- SÓ campos (A) públicos. NUNCA meta_capi_token / gads_developer_token.
    'marketing', jsonb_build_object(
      'gtm_container_id',      v_s.gtm_container_id,
      'meta_pixel_id',         v_s.meta_pixel_id,
      'ga4_measurement_id',    v_s.ga4_measurement_id,
      'gads_conversion_id',    v_s.gads_conversion_id,
      'gads_conversion_label', v_s.gads_conversion_label
    ),
    'categories', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'id',      c.id,
          'name',    c.name,
          'station', c.station,
          'sort',    c.sort,
          'items', (
            select coalesce(jsonb_agg(
              jsonb_build_object(
                'id',          i.id,
                'name',        i.name,
                'description', i.description,
                'price_cents', i.price_cents,
                'photo_url',   i.photo_url,
                'available',   i.available
              ) order by i.sort
            ), '[]'::jsonb)
            from menu_items i
            where i.category_id = c.id and i.available = true
          )
        ) order by c.sort
      ), '[]'::jsonb)
      from menu_categories c where c.active = true
    ),
    'zones', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'id',        z.id,
          'name',      z.name,
          'fee_cents', z.fee_cents,
          'sort',      z.sort
        ) order by z.sort
      ), '[]'::jsonb)
      from delivery_zones z where z.active = true
    )
  );
end;
$$;

grant execute on function public.get_menu() to anon;

-- ────────────────────────────────────────────────────────────────────────────
-- get_secret_settings(): devolve os tokens (B) para uso server-side (CAPI/Ads
-- em F4.5). Restrito a authenticated/service_role — NUNCA grant a anon.
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.get_secret_settings()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_s record;
begin
  select * into v_s from settings where id = 1;
  return jsonb_build_object(
    'meta_capi_token',      v_s.meta_capi_token,
    'gads_developer_token', v_s.gads_developer_token
  );
end;
$$;

revoke all on function public.get_secret_settings() from public, anon;
grant execute on function public.get_secret_settings() to authenticated, service_role;
