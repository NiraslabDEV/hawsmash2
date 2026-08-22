-- HAWSMASH 2.0 — 1015: bebidas do 1.0 + upsell configurável.
--
-- Duas coisas que o 1.0 já tinha e o 2.0 não herdou:
--
-- 1. **Bebidas.** No 1.0 cada bebida é UM produto com sabores (Fanta = Laranja,
--    Uva, Ananás) e uma foto por sabor. Aqui os sabores são `menu_item_variants`
--    (o mesmo mecanismo do HAW/WAGYU) e a foto por sabor passa a viver na
--    variante — a foto do cartão troca quando o cliente escolhe o sabor.
--
-- 2. **Upsell.** Um item marcado `is_upsell` é oferecido no ecrã entre o
--    carrinho e o pagamento. Quem decide o quê é o dono, pelo painel; os textos
--    são da empresa e vivem em `settings` (CLAUDE §5.1).
--
-- Idempotente: colunas com `if not exists`, dados guardados por nome.

-- ─────────────────────────────────────────────────────────────────────────────
-- Colunas
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.menu_items
  add column if not exists is_upsell boolean not null default false;

comment on column public.menu_items.is_upsell is
  'Oferecido no ecrã de upsell, entre o carrinho e o pagamento. Marcado no painel (Cardápio).';

-- Foto por sabor: o 1.0 guardava-as num jsonb no produto; aqui pertencem à
-- variante, que é quem tem o sabor. Null = usa a foto do item.
alter table public.menu_item_variants
  add column if not exists photo_url text;

alter table public.settings
  add column if not exists upsell_enabled boolean not null default true,
  add column if not exists upsell_title text not null default 'Falta alguma coisa?',
  add column if not exists upsell_subtitle text not null default 'Uma bebida gelada cai sempre bem com o smash.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Cardápio: bebidas herdadas do HAWSMASH 1.0 (preços do 1.0: 100 MT, 150 no Red Bull)
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  v_bebidas uuid;
  v_item uuid;
  v_row record;
  v_variant record;
begin
  select id into v_bebidas from public.menu_categories where name = 'Bebidas';

  if v_bebidas is null then
    insert into public.menu_categories (name, station, sort, active)
    values ('Bebidas', 'bar', 4, true)
    returning id into v_bebidas;
  end if;

  for v_row in
    select *
    from (values
      ('Coca-Cola',        10000, 1, '/assets/hawsmash/bebidas/coca-normal.webp'),
      ('Sprite',           10000, 2, '/assets/hawsmash/bebidas/sprite.webp'),
      ('Fanta',            10000, 3, '/assets/hawsmash/bebidas/fanta-laranja.webp'),
      ('Schweppes',        10000, 4, '/assets/hawsmash/bebidas/schweppes-pomegranate.webp'),
      ('Sparletta',        10000, 5, '/assets/hawsmash/bebidas/sparletta-morango.webp'),
      ('Red Bull',         15000, 6, '/assets/hawsmash/bebidas/redbull-normal.webp'),
      ('Red Bull Edition', 15000, 7, '/assets/hawsmash/bebidas/redbull-peach.webp')
    ) as t(name, price_cents, sort, photo_url)
  loop
    select id into v_item from public.menu_items where name = v_row.name;

    if v_item is null then
      -- O trigger da 1003 cria a linha de `store_items` para cada loja activa.
      insert into public.menu_items (
        category_id, name, description, photo_url, price_cents, sort, available, is_upsell
      ) values (
        v_bebidas, v_row.name, 'Bebida gelada.', v_row.photo_url,
        v_row.price_cents, v_row.sort, true, true
      )
      returning id into v_item;
    else
      update public.menu_items
      set is_upsell = true,
          photo_url = coalesce(photo_url, v_row.photo_url)
      where id = v_item;
    end if;

    -- Sabores. Preço igual ao da bebida: o sabor não muda o preço, muda a foto.
    for v_variant in
      select *
      from (values
        ('Coca-Cola',        'Normal',      1, '/assets/hawsmash/bebidas/coca-normal.webp'),
        ('Coca-Cola',        'Zero',        2, '/assets/hawsmash/bebidas/coca-zero.webp'),
        ('Fanta',            'Laranja',     1, '/assets/hawsmash/bebidas/fanta-laranja.webp'),
        ('Fanta',            'Uva',         2, '/assets/hawsmash/bebidas/fanta-uva.webp'),
        ('Fanta',            'Ananás',      3, '/assets/hawsmash/bebidas/fanta-ananas.webp'),
        ('Schweppes',        'Pomegranate', 1, '/assets/hawsmash/bebidas/schweppes-pomegranate.webp'),
        ('Schweppes',        'Pineapple',   2, '/assets/hawsmash/bebidas/schweppes-pineapple.webp'),
        ('Schweppes',        'Tangerine',   3, '/assets/hawsmash/bebidas/schweppes-tangerine.webp'),
        ('Schweppes',        'Ginger Ale',  4, '/assets/hawsmash/bebidas/schweppes-ginger.webp'),
        ('Sparletta',        'Morango',     1, '/assets/hawsmash/bebidas/sparletta-morango.webp'),
        ('Sparletta',        'Creme Soda',  2, '/assets/hawsmash/bebidas/sparletta-creme-soda.webp'),
        ('Red Bull',         'Normal',      1, '/assets/hawsmash/bebidas/redbull-normal.webp'),
        ('Red Bull',         'Zero',        2, '/assets/hawsmash/bebidas/redbull-zero.webp'),
        ('Red Bull Edition', 'Peach',       1, '/assets/hawsmash/bebidas/redbull-peach.webp'),
        ('Red Bull Edition', 'Tangerine',   2, '/assets/hawsmash/bebidas/redbull-tangerine.webp'),
        ('Red Bull Edition', 'Watermelon',  3, '/assets/hawsmash/bebidas/redbull-watermelon.webp'),
        ('Red Bull Edition', 'Yellow',      4, '/assets/hawsmash/bebidas/redbull-yellow.webp')
      ) as v(item_name, name, sort, photo_url)
      where v.item_name = v_row.name
    loop
      if not exists (
        select 1 from public.menu_item_variants
        where menu_item_id = v_item and name = v_variant.name
      ) then
        insert into public.menu_item_variants (
          menu_item_id, name, price_cents, sort, is_default, active, photo_url
        ) values (
          v_item, v_variant.name, v_row.price_cents, v_variant.sort,
          v_variant.sort = 1, true, v_variant.photo_url
        );
      else
        update public.menu_item_variants
        set photo_url = coalesce(photo_url, v_variant.photo_url)
        where menu_item_id = v_item and name = v_variant.name;
      end if;
    end loop;
  end loop;

  -- Acompanhamentos que também valem a pena oferecer no fim.
  update public.menu_items
  set is_upsell = true
  where name in ('Joe''s Chips', 'Pastéis de Nata');
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- get_menu: passa a devolver is_upsell, a foto do sabor e a configuração do upsell
--
-- Esta é a função herdada que monta o cardápio da empresa; a `public.get_menu`
-- (por loja) continua a envolvê-la, a aplicar preço/disponibilidade da loja e a
-- substituir os campos que são da unidade.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function private.get_menu_legacy(p_channel text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_s record;
begin
  if p_channel is not null and p_channel not in ('delivery', 'dine_in') then
    raise exception 'invalid_channel' using errcode = 'P0050';
  end if;

  select * into v_s from public.settings where id = 1;

  return jsonb_build_object(
    'accepting_orders',  v_s.accepting_orders,
    'payment_provider',  v_s.payment_provider,
    'mpesa_number',      v_s.mpesa_number,
    'mpesa_name',        v_s.mpesa_name,
    'emola_number',      v_s.emola_number,
    'emola_name',        v_s.emola_name,
    'promo_banner_url',  v_s.promo_banner_url,
    'promo_code',        v_s.promo_code,
    -- Upsell: público, nunca segredo.
    'upsell_enabled',    v_s.upsell_enabled,
    'upsell_title',      v_s.upsell_title,
    'upsell_subtitle',   v_s.upsell_subtitle,
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
                'id',            i.id,
                'name',          i.name,
                'description',   i.description,
                'price_cents',   i.price_cents,
                'photo_url',     i.photo_url,
                'available',     i.available,
                'is_upsell',     i.is_upsell,
                'calories_kcal', i.calories_kcal,
                'allergens',     to_jsonb(i.allergens),
                'variants', (
                  select coalesce(jsonb_agg(
                    jsonb_build_object(
                      'id',          v.id,
                      'name',        v.name,
                      'price_cents', v.price_cents,
                      'is_default',  v.is_default,
                      'photo_url',   v.photo_url
                    ) order by v.sort
                  ), '[]'::jsonb)
                  from public.menu_item_variants v
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
                  from public.menu_addons a
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
                        from public.menu_modifier_options o
                        where o.group_id = g.id and o.active = true
                      )
                    ) order by g.sort
                  ), '[]'::jsonb)
                  from public.menu_modifier_groups g
                  where g.menu_item_id = i.id and g.active = true
                )
              ) order by i.sort
            ), '[]'::jsonb)
            from public.menu_items i
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
      from public.menu_categories c where c.active = true
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
      from public.delivery_zones z where z.active = true
    )
  );
end;
$$;

revoke all on function private.get_menu_legacy(text) from public, anon, authenticated;
