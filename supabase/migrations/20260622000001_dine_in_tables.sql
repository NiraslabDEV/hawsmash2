-- ============================================================================
-- Casa do Bom Pasteleiro — Pedido na mesa (QR) sem pagamento online.
--
-- Diferença chave para pickup/delivery: aqui o cliente só CONFIRMA o pedido
-- (dá o número da mesa via QR) — não há comprovativo nem aprovação. O pedido
-- entra logo em 'in_preparation' e cria o print_job imediatamente, porque o
-- pagamento é físico (dinheiro/cartão na mesa ou no balcão), fora da app.
-- ============================================================================

-- ── Mesas ─────────────────────────────────────────────────────────────────
create table public.tables (
  id         uuid        primary key default gen_random_uuid(),
  number     int         not null unique check (number > 0),
  token      text        not null unique default encode(extensions.gen_random_bytes(16), 'hex'),
  active     bool        not null default true,
  created_at timestamptz not null default now()
);

alter table public.tables enable row level security;
create policy "staff_all" on public.tables
  for all to authenticated using (true) with check (true);

-- anon só pode ler mesas ativas (para /m/[token] validar antes de mostrar o cardápio)
create policy "anon_read_active" on public.tables
  for select to anon using (active = true);

-- ── orders: mesa + novo canal 'dine_in' (sem gate de pagamento) ────────────
alter table public.orders
  add column if not exists table_id uuid references public.tables(id) on delete set null;

alter table public.orders drop constraint if exists orders_fulfillment_type_check;
alter table public.orders add constraint orders_fulfillment_type_check
  check (fulfillment_type in ('pickup', 'delivery', 'dine_in'));

alter table public.orders drop constraint if exists orders_flow_check;
alter table public.orders add constraint orders_flow_check
  check (flow in ('digital', 'manual', 'dine_in'));

-- 'no_payment' = pago fisicamente na mesa/balcão, fora da app (não rastreado aqui).
alter table public.orders drop constraint if exists orders_payment_method_check;
alter table public.orders add constraint orders_payment_method_check
  check (payment_method in ('mpesa', 'emola', 'credit_card', 'cash', 'no_payment'));

-- ── get_table_by_token: resolve o token do QR para {id, number} sem expor mais nada ──
create or replace function public.get_table_by_token(p_token text)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_table record;
begin
  select id, number into v_table from tables where token = p_token and active = true;
  if not found then
    raise exception 'invalid_table' using errcode = 'P0060';
  end if;
  return jsonb_build_object('id', v_table.id, 'number', v_table.number);
end;
$$;

grant execute on function public.get_table_by_token(text) to anon;

-- ── create_order v7 — adiciona fluxo dine_in (sem payment gate) ────────────
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
  v_table        record;
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
  v_table_id         uuid;
  v_payment_method   text;
  v_notes            text;
  v_referral_code    text;
  v_scheduled_for    timestamptz;
  v_slot_hour        int;
  v_slot_minute      int;
  v_flow             text;
  v_initial_status   text;
  v_has_gift_item    bool := false;
  v_print_items      jsonb;
begin
  -- 1. Settings
  select * into v_cfg from settings where id = 1;

  if not v_cfg.accepting_orders then
    raise exception 'store_closed' using errcode = 'P0001';
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

  if v_fulfillment_type not in ('pickup', 'delivery', 'dine_in') then
    raise exception 'invalid_fulfillment_type' using errcode = 'P0004';
  end if;

  -- 2. Flow
  if v_fulfillment_type = 'dine_in' then
    v_flow := 'dine_in';
  else
    v_flow := coalesce(p_payload ->> 'flow', 'manual');
    if v_flow not in ('manual', 'digital') then
      v_flow := 'manual';
    end if;
  end if;

  if v_flow = 'dine_in' then
    -- Mesa: sem pagamento na app — paga-se fisicamente. 'no_payment' se o
    -- client não mandar nada (não é obrigatório escolher método aqui).
    v_payment_method := coalesce(v_payment_method, 'no_payment');
    if v_payment_method not in ('mpesa', 'emola', 'credit_card', 'cash', 'no_payment') then
      raise exception 'invalid_payment_method' using errcode = 'P0005';
    end if;

    v_table_id := (p_payload ->> 'tableId')::uuid;
    if v_table_id is null then
      raise exception 'table_required' using errcode = 'P0061';
    end if;
    select * into v_table from tables where id = v_table_id and active = true;
    if not found then
      raise exception 'invalid_table' using errcode = 'P0060';
    end if;
  else
    if v_payment_method not in ('mpesa', 'emola', 'credit_card', 'cash') then
      raise exception 'invalid_payment_method' using errcode = 'P0005';
    end if;
  end if;

  -- 4. Itens
  if v_items is null or jsonb_array_length(v_items) = 0 then
    raise exception 'empty_order' using errcode = 'P0006';
  end if;

  -- 5. Entrega (só pickup/delivery — dine_in nunca tem zona/morada)
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

  -- 6. Agendamento (não aplicável a dine_in — pedido é sempre "agora")
  if v_flow != 'dine_in' and v_scheduled_for is not null then
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
  if v_flow = 'dine_in' then
    v_scheduled_for := null;
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
  --    Nota canal: dine_in exige available_dine_in=true; delivery exige
  --    available_delivery=true; pickup mantém a disponibilidade normal.
  for v_item_el in select * from jsonb_array_elements(v_items)
  loop
    v_qty := (v_item_el ->> 'qty')::int;

    if v_qty is null or v_qty <= 0 then
      raise exception 'invalid_qty' using errcode = 'P0013';
    end if;

    select mi.* into v_menu_item
    from menu_items mi
    where mi.id = (v_item_el ->> 'menuItemId')::uuid
      and mi.available = true
      and (v_fulfillment_type != 'dine_in' or mi.available_dine_in)
      and (v_fulfillment_type != 'delivery' or mi.available_delivery);

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

  -- 11. Status inicial: dine_in vai direto para in_preparation (sem gate de
  -- pagamento — confirmar o pedido já manda para a cozinha/balcão).
  if v_flow = 'dine_in' then
    v_initial_status := 'in_preparation';
  elsif v_flow = 'digital' then
    v_initial_status := 'awaiting_payment';
  else
    v_initial_status := 'awaiting_approval';
  end if;

  -- 12. Criar pedido
  insert into orders (
    order_number, status, flow,
    fulfillment_type, delivery_zone_id, address, table_id,
    customer_name, customer_phone, customer_email,
    scheduled_for,
    subtotal_cents, delivery_fee_cents, total_cents,
    payment_method, notes,
    referral_code, discount_cents, gift_item_id
  ) values (
    v_order_number,
    v_initial_status,
    v_flow,
    v_fulfillment_type, v_delivery_zone_id, v_address, v_table_id,
    v_customer_name, v_customer_phone, v_customer_email,
    v_scheduled_for,
    v_subtotal, v_delivery_fee, v_total,
    v_payment_method, v_notes,
    v_referral_code, v_discount, v_gift_item_id
  )
  returning id into v_order_id;

  -- 13. Order items (snapshots imutáveis)
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

  -- 14. Resgate do cupom
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

  -- 15. Log do pedido
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

  -- 16. Mesa: sem gate de pagamento — cria o print_job já, na criação do
  -- pedido (não existe APPROVE/confirm_payment neste fluxo).
  if v_flow = 'dine_in' then
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'name',      oi.name_snapshot,
          'quantity',  oi.qty,
          'variant',   oi.variant_name_snapshot,
          'addons',    oi.addons,
          'modifiers', oi.modifiers,
          'notes',     oi.notes
        ) order by oi.id
      ),
      '[]'::jsonb
    ) into v_print_items
    from order_items oi
    where oi.order_id = v_order_id;

    insert into print_jobs (order_id, station, payload)
    values (
      v_order_id, 'kitchen',
      jsonb_build_object(
        'order_number',    v_order_number,
        'customer_name',   v_customer_name,
        'fulfillment_type', 'dine_in',
        'table_number',    v_table.number,
        'items',           v_print_items,
        'payment_method',  'no_payment (pago na mesa/balcão)',
        'total_cents',     v_total,
        'notes',           v_notes,
        'created_at',      now()
      )
    );

    insert into event_log (order_id, type, payload)
    values (
      v_order_id, 'print_job.created',
      jsonb_build_object('trigger', 'create_order.dine_in', 'station', 'kitchen')
    );
  end if;

  return v_order_id;
end;
$$;

grant execute on function public.create_order(jsonb) to anon;
