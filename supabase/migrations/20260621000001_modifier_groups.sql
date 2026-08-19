-- ============================================================================
-- Casa do Bom Pasteleiro — Grupos de modificadores (escolhas incluídas + extras pagos).
-- Ex.: "2 acompanhamentos + 1 molho grátis" nos pratos principais, ou
-- "tipo de ovo / pão ou torrada / até 5 acompanhamentos (extra paga)" no Pequeno-Almoço.
--
-- Diferença para menu_item_variants/menu_addons (20260616000001):
-- - variants = escolha única que SUBSTITUI o preço (tamanhos).
-- - addons   = multi-escolha, cada opção cobra sempre o seu price_cents.
-- - modifier_groups = multi ou única escolha com N unidades GRÁTIS incluídas
--   (free_quantity) e cada unidade a mais cobra extra_price_cents fixo do grupo.
-- ============================================================================

create table if not exists public.menu_modifier_groups (
  id              uuid        primary key default gen_random_uuid(),
  menu_item_id    uuid        not null references public.menu_items(id) on delete cascade,
  name            text        not null,
  selection_type  text        not null default 'multi' check (selection_type in ('single', 'multi')),
  min_select      int         not null default 0 check (min_select >= 0),
  max_select      int         not null default 1 check (max_select >= 1),
  free_quantity   int         not null default 0 check (free_quantity >= 0),
  extra_price_cents int       not null default 0 check (extra_price_cents >= 0),
  sort            int         not null default 0,
  active          bool        not null default true,
  created_at      timestamptz not null default now(),
  check (max_select >= min_select)
);

alter table public.menu_modifier_groups enable row level security;
create policy "staff_all" on public.menu_modifier_groups
  for all to authenticated using (true) with check (true);

create table if not exists public.menu_modifier_options (
  id           uuid        primary key default gen_random_uuid(),
  group_id     uuid        not null references public.menu_modifier_groups(id) on delete cascade,
  name         text        not null,
  price_cents  int         not null default 0 check (price_cents >= 0),
  sort         int         not null default 0,
  active       bool        not null default true,
  created_at   timestamptz not null default now()
);

alter table public.menu_modifier_options enable row level security;
create policy "staff_all" on public.menu_modifier_options
  for all to authenticated using (true) with check (true);

alter table public.order_items
  add column if not exists modifiers jsonb not null default '[]'::jsonb;

-- ─────────────────────────────────────────────────────────────────────────────
-- get_menu(): adiciona modifier_groups[] (com options[]) por item.
-- ─────────────────────────────────────────────────────────────────────────────

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

-- ─────────────────────────────────────────────────────────────────────────────
-- create_order v6 — estende 20260620000002 com modifier_groups.
-- Payload por item: { menuItemId, qty, variantId?, addonIds?[], modifiers?: [{groupId, optionIds:[]}], notes? }.
-- Para CADA grupo ativo do item (não só os enviados pelo client), valida
-- min_select/max_select e cobra extra_price_cents por unidade além de free_quantity.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.create_order(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cfg          record;
  v_items        jsonb;
  v_item_el      jsonb;
  v_menu_item    record;
  v_variant      record;
  v_addon_ids    jsonb;
  v_addon_id     text;
  v_addon        record;
  v_addons_snap  jsonb;
  v_variant_name text;
  v_group        record;
  v_option       record;
  v_mod_el       jsonb;
  v_option_ids   jsonb;
  v_option_id    text;
  v_option_count int;
  v_option_names jsonb;
  v_modifiers_snap jsonb;
  v_extra_qty    int;
  v_zone         record;
  v_rc           record;
  v_order_id     uuid;
  v_order_number text;
  v_subtotal     int := 0;
  v_delivery_fee int := 0;
  v_discount     int := 0;
  v_total        int;
  v_qty          int;
  v_unit_price   int;
  v_redeemed     int;
  v_gift_item_id uuid;

  v_customer_name    text;
  v_customer_phone   text;
  v_customer_email   text;
  v_fulfillment_type text;
  v_delivery_zone_id uuid;
  v_address          text;
  v_payment_method   text;
  v_notes            text;
  v_referral_code    text;
  v_scheduled_for    timestamptz;
  v_slot_hour        int;
  v_slot_minute      int;
  v_flow             text;
  v_has_gift_item    bool := false;
begin
  -- 1. Settings
  select * into v_cfg from settings where id = 1;

  if not v_cfg.accepting_orders then
    raise exception 'store_closed' using errcode = 'P0001';
  end if;

  -- 2. Flow (decidido pelo payload, ver 20260620000002)
  v_flow := coalesce(p_payload ->> 'flow', 'manual');
  if v_flow not in ('manual', 'digital') then
    v_flow := 'manual';
  end if;

  -- 3. Payload
  v_items            := p_payload -> 'items';
  v_customer_name    := nullif(trim(p_payload ->> 'customerName'), '');
  v_customer_phone   := nullif(trim(p_payload ->> 'customerPhone'), '');
  v_customer_email   := nullif(trim(p_payload ->> 'customerEmail'), '');
  v_fulfillment_type := p_payload ->> 'fulfillmentType';
  v_delivery_zone_id := (p_payload ->> 'deliveryZoneId')::uuid;
  v_address          := trim(p_payload ->> 'address');
  v_payment_method   := p_payload ->> 'paymentMethod';
  v_notes            := trim(p_payload ->> 'notes');
  v_referral_code    := nullif(upper(trim(p_payload ->> 'referralCode')), '');

  if p_payload ->> 'scheduledFor' is not null then
    v_scheduled_for := (p_payload ->> 'scheduledFor')::timestamptz;
  end if;

  if v_customer_name is null or length(v_customer_name) = 0 then
    raise exception 'invalid_customer_name' using errcode = 'P0003';
  end if;

  if v_fulfillment_type not in ('pickup', 'delivery') then
    raise exception 'invalid_fulfillment_type' using errcode = 'P0004';
  end if;

  if v_payment_method not in ('mpesa', 'emola', 'credit_card', 'cash') then
    raise exception 'invalid_payment_method' using errcode = 'P0005';
  end if;

  -- 4. Itens
  if v_items is null or jsonb_array_length(v_items) = 0 then
    raise exception 'empty_order' using errcode = 'P0006';
  end if;

  -- 5. Entrega
  if v_fulfillment_type = 'delivery' then
    if v_delivery_zone_id is null then
      raise exception 'delivery_zone_required' using errcode = 'P0007';
    end if;
    select * into v_zone from delivery_zones
    where id = v_delivery_zone_id and active = true;
    if not found then
      raise exception 'invalid_delivery_zone' using errcode = 'P0008';
    end if;
    v_delivery_fee := v_zone.fee_cents;
    if v_address is null or length(v_address) = 0 then
      raise exception 'delivery_address_required' using errcode = 'P0009';
    end if;
  end if;

  -- 6. Agendamento
  if v_scheduled_for is not null then
    if v_scheduled_for <= now() then
      raise exception 'scheduled_for_must_be_future' using errcode = 'P0010';
    end if;
    v_slot_hour   := extract(hour   from v_scheduled_for)::int;
    v_slot_minute := extract(minute from v_scheduled_for)::int;
    if v_slot_hour < v_cfg.open_hour or v_slot_hour >= v_cfg.close_hour then
      raise exception 'scheduled_for_outside_hours' using errcode = 'P0011';
    end if;
    if v_slot_minute % v_cfg.slot_minutes <> 0 then
      raise exception 'scheduled_for_invalid_slot' using errcode = 'P0012';
    end if;
  end if;

  -- 7. Validar cupom
  if v_referral_code is not null then
    select * into v_rc
    from referral_codes
    where code = v_referral_code
      and active = true
      and (expires_at is null or expires_at > now());

    if not found then
      raise exception 'referral_invalid_or_expired' using errcode = 'P0020';
    end if;

    if v_rc.owner_phone is not null and v_rc.owner_phone = v_customer_phone then
      raise exception 'referral_auto_redemption' using errcode = 'P0021';
    end if;

    if exists (
      select 1 from referral_redemptions
      where code_id = v_rc.id and customer_phone = v_customer_phone
    ) then
      raise exception 'referral_already_redeemed' using errcode = 'P0022';
    end if;

    select count(*) into v_redeemed from referral_redemptions where code_id = v_rc.id;
    if v_redeemed >= v_rc.max_redemptions then
      raise exception 'referral_max_redemptions' using errcode = 'P0023';
    end if;

    if v_rc.reward_type = 'free_item' then
      v_gift_item_id := v_rc.gift_item_id;
    end if;
  end if;

  -- 8. Calcular subtotal + stock + variante/adicionais/modifier_groups + is_gift
  for v_item_el in select * from jsonb_array_elements(v_items)
  loop
    v_qty := (v_item_el ->> 'qty')::int;

    if v_qty is null or v_qty <= 0 then
      raise exception 'invalid_qty' using errcode = 'P0013';
    end if;

    select mi.* into v_menu_item
    from menu_items mi
    where mi.id = (v_item_el ->> 'menuItemId')::uuid
      and mi.available = true;

    if not found then
      raise exception 'item_unavailable:%.', (v_item_el ->> 'menuItemId')
        using errcode = 'P0014';
    end if;

    if v_menu_item.is_gift then
      if v_gift_item_id is null or v_gift_item_id != v_menu_item.id then
        raise exception 'gift_item_not_authorized' using errcode = 'P0024';
      end if;
      if v_qty > 1 then
        raise exception 'gift_item_max_one' using errcode = 'P0025';
      end if;
      v_has_gift_item := true;
      continue;
    end if;

    if v_menu_item.track_stock and v_menu_item.stock_qty < v_qty then
      raise exception 'out_of_stock:%.', v_menu_item.id using errcode = 'P0105';
    end if;

    v_unit_price := v_menu_item.price_cents;

    -- Variante (escolha única, substitui preço)
    if v_item_el ->> 'variantId' is not null then
      select * into v_variant
      from menu_item_variants
      where id = (v_item_el ->> 'variantId')::uuid
        and menu_item_id = v_menu_item.id
        and active = true;
      if not found then
        raise exception 'invalid_variant:%.', (v_item_el ->> 'variantId')
          using errcode = 'P0030';
      end if;
      v_unit_price := v_variant.price_cents;
    end if;

    -- Adicionais (multi, cada um soma sempre o seu preço)
    v_addon_ids := coalesce(v_item_el -> 'addonIds', '[]'::jsonb);
    for v_addon_id in select * from jsonb_array_elements_text(v_addon_ids)
    loop
      select * into v_addon
      from menu_addons
      where id = v_addon_id::uuid
        and menu_item_id = v_menu_item.id
        and active = true;
      if not found then
        raise exception 'invalid_addon:%.', v_addon_id using errcode = 'P0031';
      end if;
      v_unit_price := v_unit_price + v_addon.price_cents;
    end loop;

    -- Grupos de modificadores (ex.: acompanhamentos/molho, tipo de ovo/pão).
    -- Valida TODOS os grupos ativos do item — mesmo que o client não os envie
    -- (nesse caso conta como 0 seleções, o que falha se min_select > 0).
    for v_group in
      select * from menu_modifier_groups
      where menu_item_id = v_menu_item.id and active = true
    loop
      v_option_ids := '[]'::jsonb;
      for v_mod_el in
        select * from jsonb_array_elements(coalesce(v_item_el -> 'modifiers', '[]'::jsonb))
      loop
        if (v_mod_el ->> 'groupId')::uuid = v_group.id then
          v_option_ids := coalesce(v_mod_el -> 'optionIds', '[]'::jsonb);
        end if;
      end loop;

      v_option_count := jsonb_array_length(v_option_ids);
      if v_option_count < v_group.min_select or v_option_count > v_group.max_select then
        raise exception 'invalid_modifier_selection:%.', v_group.name using errcode = 'P0041';
      end if;

      for v_option_id in select * from jsonb_array_elements_text(v_option_ids)
      loop
        select * into v_option
        from menu_modifier_options
        where id = v_option_id::uuid and group_id = v_group.id and active = true;
        if not found then
          raise exception 'invalid_modifier_option:%.', v_option_id using errcode = 'P0042';
        end if;
        v_unit_price := v_unit_price + v_option.price_cents;
      end loop;

      if v_option_count > v_group.free_quantity then
        v_unit_price := v_unit_price + (v_option_count - v_group.free_quantity) * v_group.extra_price_cents;
      end if;
    end loop;

    v_subtotal := v_subtotal + (v_unit_price * v_qty);
  end loop;

  -- 9. Desconto do cupom
  if v_referral_code is not null then
    if v_rc.reward_type != 'free_item' then
      if v_rc.reward_type = 'discount_cents' then
        v_discount := least(v_rc.reward_value, v_subtotal);
      elsif v_rc.reward_type = 'discount_pct' then
        v_discount := (v_subtotal * v_rc.reward_value / 100);
      end if;
    end if;
  end if;

  v_total := v_subtotal - v_discount + v_delivery_fee;
  if v_total < 0 then v_total := 0; end if;

  -- 10. Order number
  v_order_number := 'ENC-' || lpad(nextval('order_number_seq')::text, 4, '0');

  -- 11. Criar pedido
  insert into orders (
    order_number, status, flow,
    fulfillment_type, delivery_zone_id, address,
    customer_name, customer_phone, customer_email,
    scheduled_for,
    subtotal_cents, delivery_fee_cents, total_cents,
    payment_method, notes,
    referral_code, discount_cents, gift_item_id
  ) values (
    v_order_number,
    case when v_flow = 'digital' then 'awaiting_payment' else 'awaiting_approval' end,
    v_flow,
    v_fulfillment_type, v_delivery_zone_id, v_address,
    v_customer_name, v_customer_phone, v_customer_email,
    v_scheduled_for,
    v_subtotal, v_delivery_fee, v_total,
    v_payment_method, v_notes,
    v_referral_code, v_discount, v_gift_item_id
  )
  returning id into v_order_id;

  -- 12. Order items (snapshots imutáveis)
  for v_item_el in select * from jsonb_array_elements(v_items)
  loop
    select mi.id, mi.name, mi.price_cents, mi.is_gift, coalesce(c.station, 'kitchen') as station
    into v_menu_item
    from menu_items mi
    join menu_categories c on c.id = mi.category_id
    where mi.id = (v_item_el ->> 'menuItemId')::uuid;

    v_qty := (v_item_el ->> 'qty')::int;
    v_unit_price := v_menu_item.price_cents;
    v_variant_name := null;
    v_addons_snap := '[]'::jsonb;
    v_modifiers_snap := '[]'::jsonb;

    if v_menu_item.is_gift then
      v_unit_price := 0;
    else
      if v_item_el ->> 'variantId' is not null then
        select * into v_variant
        from menu_item_variants
        where id = (v_item_el ->> 'variantId')::uuid and menu_item_id = v_menu_item.id;
        v_unit_price := v_variant.price_cents;
        v_variant_name := v_variant.name;
      end if;

      v_addon_ids := coalesce(v_item_el -> 'addonIds', '[]'::jsonb);
      for v_addon_id in select * from jsonb_array_elements_text(v_addon_ids)
      loop
        select * into v_addon from menu_addons where id = v_addon_id::uuid;
        v_unit_price := v_unit_price + v_addon.price_cents;
        v_addons_snap := v_addons_snap || jsonb_build_object('name', v_addon.name, 'price_cents', v_addon.price_cents);
      end loop;

      for v_group in
        select * from menu_modifier_groups
        where menu_item_id = v_menu_item.id and active = true
      loop
        v_option_ids := '[]'::jsonb;
        for v_mod_el in
          select * from jsonb_array_elements(coalesce(v_item_el -> 'modifiers', '[]'::jsonb))
        loop
          if (v_mod_el ->> 'groupId')::uuid = v_group.id then
            v_option_ids := coalesce(v_mod_el -> 'optionIds', '[]'::jsonb);
          end if;
        end loop;

        v_option_count := jsonb_array_length(v_option_ids);
        v_option_names := '[]'::jsonb;

        for v_option_id in select * from jsonb_array_elements_text(v_option_ids)
        loop
          select * into v_option from menu_modifier_options where id = v_option_id::uuid;
          v_unit_price := v_unit_price + v_option.price_cents;
          v_option_names := v_option_names || jsonb_build_object('name', v_option.name, 'price_cents', v_option.price_cents);
        end loop;

        v_extra_qty := greatest(v_option_count - v_group.free_quantity, 0);
        if v_extra_qty > 0 then
          v_unit_price := v_unit_price + v_extra_qty * v_group.extra_price_cents;
        end if;

        v_modifiers_snap := v_modifiers_snap || jsonb_build_object(
          'group_name', v_group.name,
          'options', v_option_names,
          'extra_qty', v_extra_qty,
          'extra_price_cents', v_group.extra_price_cents
        );
      end loop;
    end if;

    insert into order_items (
      order_id, menu_item_id, name_snapshot, qty,
      unit_price_cents, station, notes,
      variant_name_snapshot, addons, modifiers
    ) values (
      v_order_id,
      v_menu_item.id,
      v_menu_item.name,
      v_qty,
      v_unit_price,
      v_menu_item.station,
      nullif(trim(v_item_el ->> 'notes'), ''),
      v_variant_name,
      coalesce(v_addons_snap, '[]'::jsonb),
      coalesce(v_modifiers_snap, '[]'::jsonb)
    );
  end loop;

  -- 13. Resgate do cupom
  if v_referral_code is not null then
    insert into referral_redemptions (code_id, order_id, customer_phone)
    values (v_rc.id, v_order_id, v_customer_phone);

    insert into event_log (order_id, type, payload)
    values (
      v_order_id,
      'referral.redeemed',
      jsonb_build_object(
        'code',         v_referral_code,
        'reward_type',  v_rc.reward_type,
        'reward_value', v_rc.reward_value,
        'discount',     v_discount,
        'has_gift',     v_has_gift_item
      )
    );
  end if;

  -- 14. Log do pedido
  insert into event_log (order_id, type, payload)
  values (
    v_order_id,
    'order.created',
    jsonb_build_object(
      'order_number',   v_order_number,
      'flow',           v_flow,
      'total_cents',    v_total,
      'discount_cents', v_discount,
      'fulfillment',    v_fulfillment_type,
      'payment_method', v_payment_method
    )
  );

  return v_order_id;
end;
$$;

grant execute on function public.create_order(jsonb) to anon;
