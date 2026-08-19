-- ============================================================================
-- DELIVERY OS — Cupom promocional na loja + foto das categorias
-- Storefront: hero → coupon widget → category circles → product grid vertical
-- ============================================================================

-- ── Campos públicos de promoção em settings ──────────────────────────────────
alter table settings add column if not exists promo_banner_url text;   -- imagem do cupom (admin faz upload)
alter table settings add column if not exists promo_code       text;   -- código a exibir (ex: "PRIMEIRABOX")

-- ── Foto circular das categorias ─────────────────────────────────────────────
alter table menu_categories add column if not exists photo_url text;

-- ── Bucket público para assets da loja (banners, cupons, hero) ───────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'storefront-assets',
  'storefront-assets',
  true,                           -- público: imagens de marketing
  5242880,                        -- 5 MB
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

create policy "storefront_assets_auth_all" on storage.objects for all
  to authenticated
  using (bucket_id = 'storefront-assets')
  with check (bucket_id = 'storefront-assets');

create policy "storefront_assets_anon_read" on storage.objects for select
  to anon
  using (bucket_id = 'storefront-assets');

-- ── get_menu(): adiciona promo_banner_url, promo_code e photo_url de categoria ─
create or replace function public.get_menu()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_s record;
begin
  select * into v_s from settings where id = 1;

  return jsonb_build_object(
    'accepting_orders',  v_s.accepting_orders,
    'payment_provider',  v_s.payment_provider,
    'mpesa_number',      v_s.mpesa_number,
    'mpesa_name',        v_s.mpesa_name,
    'emola_number',      v_s.emola_number,
    'emola_name',        v_s.emola_name,
    -- campos públicos de promoção (nunca secrets)
    'promo_banner_url',  v_s.promo_banner_url,
    'promo_code',        v_s.promo_code,
    -- SÓ campos (A) públicos de marketing. NUNCA meta_capi_token / gads_developer_token.
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
          'id',        c.id,
          'name',      c.name,
          'station',   c.station,
          'sort',      c.sort,
          'photo_url', c.photo_url,
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
