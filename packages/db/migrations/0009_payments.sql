-- ============================================================================
-- DELIVERY OS — F2.1: Paysuite digital flow
-- Tabelas: payments + print_jobs
-- RPCs: confirm_payment (idempotente, transaccional)
-- Updates: create_order suporta flow=digital; get_menu inclui payment_settings;
--          get_order_stats conta awaiting_payment + awaiting_approval
-- Ref: CLAUDE.md secções 6.2, 6.4, 14.3
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- orders: campo para guardar o ID de pagamento Paysuite (para reconciliação)
-- ────────────────────────────────────────────────────────────────────────────
alter table orders add column if not exists payment_provider_ref text;

-- ────────────────────────────────────────────────────────────────────────────
-- Tabela: payments
-- Registo imutável por tentativa — idempotência via data.reference do webhook
-- ────────────────────────────────────────────────────────────────────────────
create table payments (
  id              uuid        primary key default uuid_generate_v4(),
  order_id        uuid        not null references orders(id) on delete cascade,
  provider        text        not null,
  provider_ref    text,
  method          text,
  amount_cents    int         not null check (amount_cents > 0),
  status          text        not null default 'pending'
    check (status in ('pending', 'confirmed', 'failed', 'refunded')),
  idempotency_key text        not null unique,
  raw_webhook     jsonb,
  created_at      timestamptz not null default now()
);

alter table payments enable row level security;
create policy "staff_all" on payments
  for all to authenticated using (true) with check (true);

-- ────────────────────────────────────────────────────────────────────────────
-- Tabela: print_jobs
-- Fila ESC/POS para o print-bridge (F2.2). Criada em confirm_payment/APPROVE.
-- ────────────────────────────────────────────────────────────────────────────
create table print_jobs (
  id         uuid        primary key default uuid_generate_v4(),
  order_id   uuid        not null references orders(id) on delete cascade,
  station    text        not null,
  payload    jsonb       not null default '{}',
  status     text        not null default 'queued'
    check (status in ('queued', 'printing', 'printed', 'failed')),
  attempts   int         not null default 0,
  created_at timestamptz not null default now(),
  printed_at timestamptz
);

alter table print_jobs enable row level security;
create policy "staff_all" on print_jobs
  for all to authenticated using (true) with check (true);

-- ────────────────────────────────────────────────────────────────────────────
-- RPC: confirm_payment — CLAUDE.md 14.3 + secção 6.4
-- Transaccional: insert ON CONFLICT DO NOTHING (idempotência) → valida amount
-- → confirma payment → transiciona order para 'paid' → cria print_job
-- Retorna: 'ok' | 'duplicate' | 'amount_mismatch' | 'invalid_state' | 'order_not_found'
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.confirm_payment(
  p_idempotency_key text,
  p_order_id        uuid,
  p_provider        text,
  p_provider_ref    text,
  p_method          text,
  p_amount_cents    int,
  p_raw_webhook     jsonb default '{}'::jsonb
) returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_inserted   int;
  v_payment_id uuid;
  v_order      record;
begin
  -- 1. Inserir registo de pagamento (ON CONFLICT = duplicado → retorna 'duplicate')
  insert into payments (
    order_id, provider, provider_ref, method,
    amount_cents, idempotency_key, raw_webhook
  ) values (
    p_order_id, p_provider, p_provider_ref, p_method,
    p_amount_cents, p_idempotency_key, p_raw_webhook
  ) on conflict (idempotency_key) do nothing;

  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    return 'duplicate';
  end if;

  select id into v_payment_id
  from payments
  where idempotency_key = p_idempotency_key;

  -- 2. Lock + leitura do pedido
  select o.id, o.status, o.total_cents, o.order_number
  into   v_order
  from   orders o
  where  o.id = p_order_id
  for    update;

  if not found then
    insert into event_log (order_id, type, payload) values (
      p_order_id, 'payment.order_not_found',
      jsonb_build_object('idempotency_key', p_idempotency_key)
    );
    return 'order_not_found';
  end if;

  -- 3. Verificação de montante (CLAUDE.md 6.4): discrepância → loga, mantém pending
  if p_amount_cents != v_order.total_cents then
    insert into event_log (order_id, type, payload) values (
      p_order_id, 'payment.amount_mismatch',
      jsonb_build_object(
        'expected', v_order.total_cents,
        'received', p_amount_cents,
        'idempotency_key', p_idempotency_key
      )
    );
    return 'amount_mismatch';
  end if;

  -- 4. Marcar pagamento como confirmado
  update payments set status = 'confirmed' where id = v_payment_id;

  -- 5. Verificar estado do pedido (CLAUDE.md 6.4): confirma payment mas não transiciona
  if v_order.status not in ('awaiting_payment', 'payment_failed') then
    insert into event_log (order_id, type, payload) values (
      p_order_id, 'payment.confirmed_on_invalid_state',
      jsonb_build_object(
        'status', v_order.status,
        'idempotency_key', p_idempotency_key
      )
    );
    return 'invalid_state';
  end if;

  -- 6. Transicionar pedido para 'paid' + print_job + event (mesma transacção)
  update orders
  set    status = 'paid', updated_at = now()
  where  id = p_order_id;

  insert into print_jobs (order_id, station, payload)
  values (
    p_order_id, 'kitchen',
    jsonb_build_object(
      'order_number', v_order.order_number,
      'trigger',      'payment.confirmed'
    )
  );

  insert into event_log (order_id, type, payload)
  values (
    p_order_id, 'payment.confirmed',
    jsonb_build_object(
      'provider',     p_provider,
      'method',       p_method,
      'amount_cents', p_amount_cents
    )
  );

  return 'ok';
end;
$$;

-- Admin pode consultar/testar; service_role usa via route handler (superuser local)
grant execute on function
  public.confirm_payment(text, uuid, text, text, text, int, jsonb)
  to authenticated;
revoke execute on function
  public.confirm_payment(text, uuid, text, text, text, int, jsonb)
  from public;

-- ────────────────────────────────────────────────────────────────────────────
-- Actualiza create_order: suporta flow=digital → status=awaiting_payment
-- Mantém retrocompatibilidade: sem 'flow' no payload → manual (awaiting_approval)
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.create_order(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cfg           record;
  v_order_id      uuid;
  v_order_number  text;
  v_item_el       jsonb;
  v_menu_item     record;
  v_zone          record;
  v_qty           int;
  v_subtotal      int := 0;
  v_delivery_fee  int := 0;
  v_total         int;
  v_flow          text;
  v_initial_status text;

  v_items             jsonb;
  v_customer_name     text;
  v_customer_phone    text;
  v_customer_email    text;
  v_fulfillment_type  text;
  v_delivery_zone_id  uuid;
  v_address           text;
  v_scheduled_for     timestamptz;
  v_payment_method    text;
  v_notes             text;

  v_slot_hour   int;
  v_slot_minute int;
begin
  select * into v_cfg from settings where id = 1;

  if not found then
    raise exception 'restaurant_not_configured' using errcode = 'P0001';
  end if;

  if not v_cfg.accepting_orders then
    raise exception 'restaurant_closed' using errcode = 'P0002';
  end if;

  v_items            := p_payload -> 'items';
  v_customer_name    := trim(p_payload ->> 'customerName');
  v_customer_phone   := trim(p_payload ->> 'customerPhone');
  v_customer_email   := nullif(trim(p_payload ->> 'customerEmail'), '');
  v_fulfillment_type := p_payload ->> 'fulfillmentType';
  v_delivery_zone_id := (p_payload ->> 'deliveryZoneId')::uuid;
  v_address          := trim(p_payload ->> 'address');
  v_payment_method   := p_payload ->> 'paymentMethod';
  v_notes            := trim(p_payload ->> 'notes');
  v_flow             := coalesce(p_payload ->> 'flow', 'manual');

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

  if v_flow not in ('manual', 'digital') then
    raise exception 'invalid_flow' using errcode = 'P0015';
  end if;

  if v_items is null or jsonb_array_length(v_items) = 0 then
    raise exception 'empty_order' using errcode = 'P0006';
  end if;

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

    v_subtotal := v_subtotal + (v_menu_item.price_cents * v_qty);
  end loop;

  v_total := v_subtotal + v_delivery_fee;

  v_order_number := 'ENC-' || lpad(nextval('order_number_seq')::text, 4, '0');

  -- Status inicial depende do flow (CLAUDE.md secção 5)
  v_initial_status := case
    when v_flow = 'digital' then 'awaiting_payment'
    else 'awaiting_approval'
  end;

  insert into orders (
    order_number, status, flow,
    fulfillment_type, delivery_zone_id, address,
    customer_name, customer_phone, customer_email,
    scheduled_for,
    subtotal_cents, delivery_fee_cents, total_cents,
    payment_method, notes
  ) values (
    v_order_number, v_initial_status, v_flow,
    v_fulfillment_type, v_delivery_zone_id, v_address,
    v_customer_name, v_customer_phone, v_customer_email,
    v_scheduled_for,
    v_subtotal, v_delivery_fee, v_total,
    v_payment_method, v_notes
  )
  returning id into v_order_id;

  for v_item_el in select * from jsonb_array_elements(v_items)
  loop
    select mi.* into v_menu_item
    from menu_items mi
    where mi.id = (v_item_el ->> 'menuItemId')::uuid;

    insert into order_items (
      order_id, menu_item_id,
      name_snapshot, qty, unit_price_cents,
      station, notes
    ) values (
      v_order_id, v_menu_item.id,
      v_menu_item.name,
      (v_item_el ->> 'qty')::int,
      v_menu_item.price_cents,
      (select station from menu_categories where id = v_menu_item.category_id),
      v_item_el ->> 'notes'
    );
  end loop;

  insert into event_log (order_id, type, payload)
  values (
    v_order_id, 'order.created',
    jsonb_build_object(
      'order_number',       v_order_number,
      'flow',               v_flow,
      'fulfillment_type',   v_fulfillment_type,
      'total_cents',        v_total,
      'subtotal_cents',     v_subtotal,
      'delivery_fee_cents', v_delivery_fee,
      'payment_method',     v_payment_method,
      'item_count',         jsonb_array_length(v_items)
    )
  );

  return v_order_id;
end;
$$;

grant execute on function public.create_order(jsonb) to anon;

-- ────────────────────────────────────────────────────────────────────────────
-- Actualiza get_menu: inclui payment_settings para o checkout decidir o flow
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
-- Actualiza get_order_stats: conta awaiting_payment (digital) além de
-- awaiting_approval (manual) no card "Aguarda Pagamento"
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.get_order_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_total_faturado    int := 0;
  v_ativos            int := 0;
  v_aguarda_pagamento int := 0;
  v_em_preparo        int := 0;
  v_prontos           int := 0;
begin
  select coalesce(sum(o.total_cents), 0) into v_total_faturado
  from orders o
  where o.status in ('approved','paid','in_preparation','ready','delivered');

  select count(*) into v_ativos
  from orders o
  where o.status in ('in_preparation','ready','delivered');

  -- Aguarda pagamento: manual (awaiting_approval) + digital (awaiting_payment + payment_failed)
  select count(*) into v_aguarda_pagamento
  from orders o
  where o.status in ('awaiting_approval', 'awaiting_payment', 'payment_failed');

  select count(*) into v_em_preparo
  from orders o
  where o.status = 'in_preparation';

  select count(*) into v_prontos
  from orders o
  where o.status = 'ready';

  return jsonb_build_object(
    'total_faturado',       v_total_faturado,
    'ativos',               v_ativos,
    'aguarda_pagamento',    v_aguarda_pagamento,
    'em_preparo',           v_em_preparo,
    'prontos',              v_prontos
  );
end;
$$;

grant execute on function public.get_order_stats() to authenticated;
revoke execute on function public.get_order_stats() from public;
