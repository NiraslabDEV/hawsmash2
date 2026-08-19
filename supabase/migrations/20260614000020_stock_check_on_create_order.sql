-- ============================================================================
-- DELIVERY OS — Fix: verificação de stock em create_order
--
-- Problema: create_order só verificava available=true mas não stock_qty >= qty.
-- O cliente podia pedir 4 pudins com stock=2; o erro só aparecia no APPROVE.
-- Fix: no loop de validação de itens (passo 6), verificar stock antes de
-- aceitar o pedido — dá erro imediato ao cliente no front.
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
  v_zone         record;
  v_order_id     uuid;
  v_order_number text;
  v_subtotal     int := 0;
  v_delivery_fee int := 0;
  v_total        int;
  v_qty          int;

  -- campos do payload
  v_customer_name    text;
  v_customer_phone   text;
  v_customer_email   text;
  v_fulfillment_type text;
  v_delivery_zone_id uuid;
  v_address          text;
  v_payment_method   text;
  v_notes            text;
  v_scheduled_for    timestamptz;
  v_slot_hour        int;
  v_slot_minute      int;
  v_flow             text;
begin
  -- 1. Ler settings
  select * into v_cfg from settings where id = 1;

  if not v_cfg.accepting_orders then
    raise exception 'store_closed' using errcode = 'P0001';
  end if;

  -- 2. Determinar flow
  if v_cfg.payment_provider in ('paysuite', 'mock') then
    v_flow := 'digital';
  else
    v_flow := 'manual';
  end if;

  -- 3. Extrair payload
  v_items            := p_payload -> 'items';
  v_customer_name    := nullif(trim(p_payload ->> 'customerName'), '');
  v_customer_phone   := nullif(trim(p_payload ->> 'customerPhone'), '');
  v_customer_email   := nullif(trim(p_payload ->> 'customerEmail'), '');
  v_fulfillment_type := p_payload ->> 'fulfillmentType';
  v_delivery_zone_id := (p_payload ->> 'deliveryZoneId')::uuid;
  v_address          := trim(p_payload ->> 'address');
  v_payment_method   := p_payload ->> 'paymentMethod';
  v_notes            := trim(p_payload ->> 'notes');

  -- scheduledFor: null string ou timestamp ISO
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

  -- 4. Validar itens (não vazios)
  if v_items is null or jsonb_array_length(v_items) = 0 then
    raise exception 'empty_order' using errcode = 'P0006';
  end if;

  -- 5. Validar entrega
  if v_fulfillment_type = 'delivery' then
    if v_delivery_zone_id is null then
      raise exception 'delivery_zone_required' using errcode = 'P0007';
    end if;

    select * into v_zone
    from delivery_zones
    where id = v_delivery_zone_id and active = true;

    if not found then
      raise exception 'invalid_delivery_zone' using errcode = 'P0008';
    end if;

    v_delivery_fee := v_zone.fee_cents;

    if v_address is null or length(v_address) = 0 then
      raise exception 'delivery_address_required' using errcode = 'P0009';
    end if;
  end if;

  -- 6. Validar horário agendado
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

  -- 7. Calcular subtotal + VERIFICAR STOCK (CLAUDE.md 14.4)
  -- Preço sempre do banco; stock verificado aqui para erro imediato ao cliente.
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

    -- Verificação de stock: rejeitar o pedido antes de qualquer pagamento
    -- (a dedução atómica real acontece no confirm_payment / advance_order APPROVE)
    if v_menu_item.track_stock and v_menu_item.stock_qty < v_qty then
      raise exception 'out_of_stock:%.', v_menu_item.id using errcode = 'P0105';
    end if;

    -- PREÇO DO BANCO — qualquer price enviado pelo client é ignorado
    v_subtotal := v_subtotal + (v_menu_item.price_cents * v_qty);
  end loop;

  v_total := v_subtotal + v_delivery_fee;

  -- 8. Gerar order_number (ENC-0042)
  v_order_number := 'ENC-' || lpad(nextval('order_number_seq')::text, 4, '0');

  -- 9. Criar pedido
  insert into orders (
    order_number, status, flow,
    fulfillment_type, delivery_zone_id, address,
    customer_name, customer_phone, customer_email,
    scheduled_for,
    subtotal_cents, delivery_fee_cents, total_cents,
    payment_method, notes
  ) values (
    v_order_number,
    case when v_flow = 'digital' then 'awaiting_payment' else 'awaiting_approval' end,
    v_flow,
    v_fulfillment_type, v_delivery_zone_id, v_address,
    v_customer_name, v_customer_phone, v_customer_email,
    v_scheduled_for,
    v_subtotal, v_delivery_fee, v_total,
    v_payment_method, v_notes
  )
  returning id into v_order_id;

  -- 10. Criar order_items com snapshots de nome/preço do banco.
  --     NOTA: station vive em menu_categories (NÃO em menu_items) — join.
  for v_item_el in select * from jsonb_array_elements(v_items)
  loop
    select mi.id, mi.name, mi.price_cents, coalesce(c.station, 'kitchen') as station
    into v_menu_item
    from menu_items mi
    join menu_categories c on c.id = mi.category_id
    where mi.id = (v_item_el ->> 'menuItemId')::uuid;

    v_qty := (v_item_el ->> 'qty')::int;

    insert into order_items (
      order_id, menu_item_id, name_snapshot, qty,
      unit_price_cents, station,
      notes
    ) values (
      v_order_id,
      v_menu_item.id,
      v_menu_item.name,
      v_qty,
      v_menu_item.price_cents,
      v_menu_item.station,
      nullif(trim(v_item_el ->> 'notes'), '')
    );
  end loop;

  -- 11. Log
  insert into event_log (order_id, type, payload)
  values (
    v_order_id,
    'order.created',
    jsonb_build_object(
      'order_number',    v_order_number,
      'flow',            v_flow,
      'total_cents',     v_total,
      'fulfillment',     v_fulfillment_type,
      'payment_method',  v_payment_method
    )
  );

  return v_order_id;
end;
$$;

grant execute on function public.create_order(jsonb) to anon;
