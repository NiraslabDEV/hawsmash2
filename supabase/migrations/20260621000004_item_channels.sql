-- ============================================================================
-- Casa do Bom Pasteleiro — canal por item: Delivery / QR Mesa / ambos.
-- O dono escolhe no admin, por prato, onde ele aparece. Ex.: um prato pode
-- só existir para quem está fisicamente na mesa, ou só para delivery.
-- get_menu(p_channel) filtra por canal; sem argumento mantém o comportamento
-- antigo (mostra tudo — usado pelo admin/RPCs internas que não passam canal).
-- ============================================================================

alter table public.menu_items
  add column if not exists available_delivery bool not null default true,
  add column if not exists available_dine_in   bool not null default true;

-- Precisa de DROP explícito: get_menu(p_channel text default null) tem uma
-- assinatura diferente de get_menu() (0 args) — sem o DROP, uma chamada RPC
-- sem argumentos ficaria ambígua entre as duas (erro "function is not unique").
drop function if exists public.get_menu();

create or replace function public.get_menu(p_channel text default null)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_s record;
begin
  if p_channel is not null and p_channel not in ('delivery', 'dine_in') then
    raise exception 'invalid_channel' using errcode = 'P0050';
  end if;

  select * into v_s from settings where id = 1;

  return jsonb_build_object(
    'accepting_orders',  v_s.accepting_orders,
    'payment_provider',  v_s.payment_provider,
    'mpesa_number',      v_s.mpesa_number,
    'mpesa_name',        v_s.mpesa_name,
    'emola_number',      v_s.emola_number,
    'emola_name',        v_s.emola_name,
    'promo_banner_url',  v_s.promo_banner_url,
    'promo_code',        v_s.promo_code,
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
                'available',   i.available,
                'variants', (
                  select coalesce(jsonb_agg(
                    jsonb_build_object(
                      'id',         v.id,
                      'name',       v.name,
                      'price_cents', v.price_cents,
                      'is_default', v.is_default
                    ) order by v.sort
                  ), '[]'::jsonb)
                  from menu_item_variants v
                  where v.menu_item_id = i.id and v.active = true
                ),
                'addons', (
                  select coalesce(jsonb_agg(
                    jsonb_build_object(
                      'id',          a.id,
                      'name',        a.name,
                      'price_cents', a.price_cents
                    ) order by a.sort
                  ), '[]'::jsonb)
                  from menu_addons a
                  where a.menu_item_id = i.id and a.active = true
                ),
                'modifier_groups', (
                  select coalesce(jsonb_agg(
                    jsonb_build_object(
                      'id',                g.id,
                      'name',              g.name,
                      'selection_type',    g.selection_type,
                      'min_select',        g.min_select,
                      'max_select',        g.max_select,
                      'free_quantity',     g.free_quantity,
                      'extra_price_cents', g.extra_price_cents,
                      'options', (
                        select coalesce(jsonb_agg(
                          jsonb_build_object(
                            'id',          o.id,
                            'name',        o.name,
                            'price_cents', o.price_cents
                          ) order by o.sort
                        ), '[]'::jsonb)
                        from menu_modifier_options o
                        where o.group_id = g.id and o.active = true
                      )
                    ) order by g.sort
                  ), '[]'::jsonb)
                  from menu_modifier_groups g
                  where g.menu_item_id = i.id and g.active = true
                )
              ) order by i.sort
            ), '[]'::jsonb)
            from menu_items i
            where i.category_id = c.id
              and i.available = true
              and (
                p_channel is null
                or (p_channel = 'delivery' and i.available_delivery)
                or (p_channel = 'dine_in' and i.available_dine_in)
              )
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

grant execute on function public.get_menu(text) to anon;
