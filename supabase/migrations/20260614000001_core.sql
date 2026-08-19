-- ============================================================================
-- DELIVERY OS — Schema single-tenant
-- F0.2: Tabelas core + RLS + RPCs públicas (SECURITY DEFINER)
-- Ref: CLAUDE.md secções 4, 7, 12, 14
-- ============================================================================

create extension if not exists "uuid-ossp";

-- ============================================================================
-- TABELAS
-- ============================================================================

-- Singleton: config operacional do restaurante
create table settings (
  id            smallint primary key default 1 check (id = 1),
  mpesa_number  text,
  mpesa_name    text,
  emola_number  text,
  emola_name    text,
  pickup_address   text,
  pickup_maps_url  text,
  owner_email      text,
  open_hour        int  not null default 8,
  close_hour       int  not null default 22,
  slot_minutes     int  not null default 30,
  accepting_orders bool not null default true,
  payment_provider text not null default 'manual'
    check (payment_provider in ('manual', 'mock', 'paysuite'))
);

create table menu_categories (
  id      uuid    primary key default gen_random_uuid(),
  name    text    not null,
  sort    int     not null default 0,
  station text    not null default 'kitchen'
    check (station in ('kitchen', 'bar', 'cold_kitchen')),
  active  bool    not null default true
);

create table menu_items (
  id          uuid    primary key default gen_random_uuid(),
  category_id uuid    references menu_categories(id) on delete cascade,
  name        text    not null,
  description text,
  price_cents int     not null check (price_cents >= 0),
  photo_url   text,
  available   bool    not null default true,
  track_stock bool    not null default false,
  stock_qty   int     check (stock_qty >= 0) default 0,
  sort        int     not null default 0
);

create table delivery_zones (
  id        uuid primary key default gen_random_uuid(),
  name      text not null,
  fee_cents int  not null check (fee_cents >= 0),
  active    bool not null default true,
  sort      int  not null default 0
);

-- Sequência para ENC-XXXX
create sequence if not exists order_number_seq start 1;

create table orders (
  id                  uuid primary key default gen_random_uuid(),
  order_number        text unique not null,
  status              text not null check (status in (
    'draft','awaiting_payment','payment_failed','paid',
    'awaiting_approval','approved',
    'in_preparation','ready','delivered','cancelled'
  )),
  flow                text not null check (flow in ('digital', 'manual')),
  fulfillment_type    text not null check (fulfillment_type in ('pickup', 'delivery')),
  delivery_zone_id    uuid references delivery_zones(id) on delete set null,
  address             text,
  customer_name       text not null,
  customer_phone      text,
  customer_email      text,         -- opcional: usado para emails de confirmação/recusa
  scheduled_for       timestamptz,  -- null = AGORA (ASAP)
  subtotal_cents      int  not null check (subtotal_cents >= 0),
  delivery_fee_cents  int  not null default 0 check (delivery_fee_cents >= 0),
  total_cents         int  not null check (total_cents >= 0),
  payment_method      text not null check (payment_method in ('mpesa', 'emola', 'credit_card', 'cash')),
  payment_proof_path  text,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table order_items (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid not null references orders(id) on delete cascade,
  menu_item_id     uuid references menu_items(id) on delete set null,
  name_snapshot    text not null,
  qty              int  not null check (qty > 0),
  unit_price_cents int  not null check (unit_price_cents >= 0),
  station          text not null,
  notes            text
);

-- Append-only: sem UPDATE/DELETE policies
create table event_log (
  id         bigserial    primary key,
  order_id   uuid         references orders(id) on delete set null,
  type       text         not null,
  payload    jsonb        not null default '{}',
  created_at timestamptz  not null default now()
);

-- ============================================================================
-- RLS — Template CLAUDE.md 14.1
-- authenticated = qualquer staff (1 restaurante). anon: NENHUMA policy.
-- ============================================================================

alter table settings      enable row level security;
alter table menu_categories enable row level security;
alter table menu_items    enable row level security;
alter table delivery_zones enable row level security;
alter table orders        enable row level security;
alter table order_items   enable row level security;
alter table event_log     enable row level security;

create policy "staff_all" on settings
  for all to authenticated using (true) with check (true);

create policy "staff_all" on menu_categories
  for all to authenticated using (true) with check (true);

create policy "staff_all" on menu_items
  for all to authenticated using (true) with check (true);

create policy "staff_all" on delivery_zones
  for all to authenticated using (true) with check (true);

create policy "staff_all" on orders
  for all to authenticated using (true) with check (true);

create policy "staff_all" on order_items
  for all to authenticated using (true) with check (true);

-- event_log: staff pode ler mas nunca alterar (append-only via RPC)
create policy "staff_select" on event_log
  for select to authenticated using (true);

-- ============================================================================
-- RPC: get_menu() — CLAUDE.md 14.2
-- anon lê cardápio + zonas activas. Preços sempre do banco.
-- ============================================================================

create or replace function public.get_menu()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
begin
  return jsonb_build_object(
    'accepting_orders', (
      select accepting_orders from settings where id = 1
    ),
    'categories', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id',      c.id,
            'name',    c.name,
            'station', c.station,
            'sort',    c.sort,
            'items', (
              select coalesce(
                jsonb_agg(
                  jsonb_build_object(
                    'id',          i.id,
                    'name',        i.name,
                    'description', i.description,
                    'price_cents', i.price_cents,
                    'photo_url',   i.photo_url,
                    'available',   i.available
                  ) order by i.sort
                ), '[]'::jsonb
              )
              from menu_items i
              where i.category_id = c.id and i.available = true
            )
          ) order by c.sort
        ), '[]'::jsonb
      )
      from menu_categories c where c.active = true
    ),
    'zones', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id',        z.id,
            'name',      z.name,
            'fee_cents', z.fee_cents,
            'sort',      z.sort
          ) order by z.sort
        ), '[]'::jsonb
      )
      from delivery_zones z where z.active = true
    )
  );
end;
$$;

grant execute on function public.get_menu() to anon;

-- ============================================================================
-- RPC: get_order_status(p_order_id uuid)
-- anon poleia o estado do seu pedido (só campos públicos seguros).
-- ============================================================================

create or replace function public.get_order_status(p_order_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_order record;
begin
  select o.id, o.order_number, o.status, o.flow, o.fulfillment_type,
         o.scheduled_for, o.total_cents, o.payment_method, o.created_at
  into v_order
  from orders o
  where o.id = p_order_id;

  if not found then
    raise exception 'order_not_found' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'id',               v_order.id,
    'order_number',     v_order.order_number,
    'status',           v_order.status,
    'flow',             v_order.flow,
    'fulfillment_type', v_order.fulfillment_type,
    'scheduled_for',    v_order.scheduled_for,
    'total_cents',      v_order.total_cents,
    'payment_method',   v_order.payment_method,
    'created_at',       v_order.created_at
  );
end;
$$;

grant execute on function public.get_order_status(uuid) to anon;

-- ============================================================================
-- RPC: create_order(p_payload jsonb)
-- CLAUDE.md 14.2 + secção 6.1 (manual) + secção 7 (agendamento).
-- Preço SEMPRE do banco. Sem confiar em valores do client.
-- ============================================================================

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

  -- campos do payload
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

  -- slot validation
  v_slot_hour   int;
  v_slot_minute int;
begin
  -- 1. Ler configuração do restaurante
  select * into v_cfg from settings where id = 1;

  if not found then
    raise exception 'restaurant_not_configured' using errcode = 'P0001';
  end if;

  if not v_cfg.accepting_orders then
    raise exception 'restaurant_closed' using errcode = 'P0002';
  end if;

  -- 2. Extrair e validar campos do payload
  v_items            := p_payload -> 'items';
  v_customer_name    := trim(p_payload ->> 'customerName');
  v_customer_phone   := trim(p_payload ->> 'customerPhone');
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

  -- 3. Validar itens (não vazios)
  if v_items is null or jsonb_array_length(v_items) = 0 then
    raise exception 'empty_order' using errcode = 'P0006';
  end if;

  -- 4. Validar entrega
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

  -- 5. Validar horário agendado
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

  -- 6. Calcular subtotal com preço do banco (NUNCA do client)
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

    -- PREÇO DO BANCO — qualquer price enviado pelo client é ignorado
    v_subtotal := v_subtotal + (v_menu_item.price_cents * v_qty);
  end loop;

  v_total := v_subtotal + v_delivery_fee;

  -- 7. Gerar order_number (ENC-0042)
  v_order_number := 'ENC-' || lpad(nextval('order_number_seq')::text, 4, '0');

  -- 8. Criar pedido (sempre flow=manual para F0.2; F0.3+ adiciona digital)
  insert into orders (
    order_number, status, flow,
    fulfillment_type, delivery_zone_id, address,
    customer_name, customer_phone, customer_email,
    scheduled_for,
    subtotal_cents, delivery_fee_cents, total_cents,
    payment_method, notes
  ) values (
    v_order_number, 'awaiting_approval', 'manual',
    v_fulfillment_type, v_delivery_zone_id, v_address,
    v_customer_name, v_customer_phone, v_customer_email,
    v_scheduled_for,
    v_subtotal, v_delivery_fee, v_total,
    v_payment_method, v_notes
  )
  returning id into v_order_id;

  -- 9. Criar order_items com snapshots de nome/preço do banco
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

  -- 10. Gravar event_log (append-only)
  insert into event_log (order_id, type, payload)
  values (
    v_order_id, 'order.created',
    jsonb_build_object(
      'order_number',      v_order_number,
      'fulfillment_type',  v_fulfillment_type,
      'total_cents',       v_total,
      'subtotal_cents',    v_subtotal,
      'delivery_fee_cents', v_delivery_fee,
      'payment_method',    v_payment_method,
      'item_count',        jsonb_array_length(v_items)
    )
  );

  return v_order_id;
end;
$$;

grant execute on function public.create_order(jsonb) to anon;
