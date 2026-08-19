-- ============================================================================
-- Fix: regressão no cálculo do flow em create_order().
--
-- Original (20260614000009_payments.sql): v_flow := coalesce(p_payload ->> 'flow', 'manual').
-- Migrations seguintes (0020, 0024, product_variants_addons, fix_create_order_vrc)
-- foram recriando a função inteira e substituíram silenciosamente essa lógica por
-- `if v_cfg.payment_provider in ('paysuite','mock') then digital else manual` —
-- o que fazia TODO pedido herdar o mesmo flow, ignorando o payload.
--
-- O desenho real da app (apps/web/app/api/payments/route.ts) já faz a validação
-- correta: só chama create_order com { ...payload, flow: 'digital' } depois de
-- confirmar `cfg.provider !== 'manual'`. O checkout manual (/api/create-order)
-- nunca manda `flow`, e deve continuar 'manual' independentemente do provider
-- configurado (retrocompat). A RPC deve voltar a ler o payload, não settings.
--
-- Descoberto ao correr packages/db/tests/payments.test.ts e stock.test.ts pela
-- primeira vez contra Supabase local (nunca tinham sido corridos — CLAUDE.md/
-- ROADMAP marcavam-nos "⏳ requer supabase start").
-- ============================================================================

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

  -- 2. Flow — decidido pelo PAYLOAD (o cliente/app escolhe "Pagar Agora" vs
  -- comprovativo manual). A disponibilidade do fluxo digital já é validada
  -- fora desta RPC, em apps/web/app/api/payments/route.ts (recusa se
  -- settings.payment_provider = 'manual'). Sem `flow` no payload → 'manual'
  -- (retrocompat do checkout manual, que nunca envia este campo).
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

  -- 7. Validar cupom (antes de calcular subtotal para saber se há free_item)
  if v_referral_code is not null then
    select * into v_rc
    from referral_codes
    where code = v_referral_code
      and active = true
      and (expires_at is null or expires_at > now());

    if not found then
      raise exception 'referral_invalid_or_expired' using errcode = 'P0020';
    end if;

    -- Anti-abuso: auto-resgate
    if v_rc.owner_phone is not null and v_rc.owner_phone = v_customer_phone then
      raise exception 'referral_auto_redemption' using errcode = 'P0021';
    end if;

    -- Anti-abuso: mesmo telefone já usou este código
    if exists (
      select 1 from referral_redemptions
      where code_id = v_rc.id and customer_phone = v_customer_phone
    ) then
      raise exception 'referral_already_redeemed' using errcode = 'P0022';
    end if;

    -- Anti-abuso: max_redemptions atingido
    select count(*) into v_redeemed from referral_redemptions where code_id = v_rc.id;
    if v_redeemed >= v_rc.max_redemptions then
      raise exception 'referral_max_redemptions' using errcode = 'P0023';
    end if;

    -- Guardar gift_item_id se for free_item
    if v_rc.reward_type = 'free_item' then
      v_gift_item_id := v_rc.gift_item_id;
    end if;
  end if;

  -- 8. Calcular subtotal + verificar stock + variante/adicionais + is_gift
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

    -- is_gift sem cupom válido com free_item → rejeitar
    if v_menu_item.is_gift then
      if v_gift_item_id is null or v_gift_item_id != v_menu_item.id then
        raise exception 'gift_item_not_authorized' using errcode = 'P0024';
      end if;
      if v_qty > 1 then
        raise exception 'gift_item_max_one' using errcode = 'P0025';
      end if;
      v_has_gift_item := true;
      -- item grátis: preço 0 (não soma ao subtotal)
      continue;
    end if;

    -- Verificação de stock
    if v_menu_item.track_stock and v_menu_item.stock_qty < v_qty then
      raise exception 'out_of_stock:%.', v_menu_item.id using errcode = 'P0105';
    end if;

    -- Variante (opcional, escolha única): tem de pertencer ao item e estar ativa
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

    -- Adicionais (opcional, multi): cada id tem de pertencer ao item e estar ativo
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

    v_subtotal := v_subtotal + (v_unit_price * v_qty);
  end loop;

  -- 9. Aplicar desconto do cupom (calculado no servidor, ignorando valor do client).
  -- DECISÃO: nested IF em vez de AND composto — PostgreSQL não garante short-circuit
  -- em expressões SQL de IF, logo `v_rc.reward_type` seria avaliado mesmo sem cupom.
  if v_referral_code is not null then
    if v_rc.reward_type != 'free_item' then
      if v_rc.reward_type = 'discount_cents' then
        v_discount := least(v_rc.reward_value, v_subtotal); -- não negativa
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

  -- 12. Order items (preços/variante/adicionais recalculados; snapshots imutáveis).
  --     NOTA: station vive em menu_categories (NÃO em menu_items) — join obrigatório.
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
      v_addons_snap := '[]'::jsonb;
      for v_addon_id in select * from jsonb_array_elements_text(v_addon_ids)
      loop
        select * into v_addon from menu_addons where id = v_addon_id::uuid;
        v_unit_price := v_unit_price + v_addon.price_cents;
        v_addons_snap := v_addons_snap || jsonb_build_object('name', v_addon.name, 'price_cents', v_addon.price_cents);
      end loop;
    end if;

    insert into order_items (
      order_id, menu_item_id, name_snapshot, qty,
      unit_price_cents, station, notes,
      variant_name_snapshot, addons
    ) values (
      v_order_id,
      v_menu_item.id,
      v_menu_item.name,
      v_qty,
      v_unit_price,
      v_menu_item.station,
      nullif(trim(v_item_el ->> 'notes'), ''),
      v_variant_name,
      coalesce(v_addons_snap, '[]'::jsonb)
    );
  end loop;

  -- 13. Registar resgate do cupom
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
