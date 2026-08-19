-- HAWSMASH 2.0 — F1 / 1003: catálogo global, realidade por loja.

create table if not exists public.store_items (
  store_id uuid not null references public.stores(id) on delete cascade,
  menu_item_id uuid not null references public.menu_items(id) on delete cascade,
  available boolean not null default true,
  price_cents_override integer check (price_cents_override is null or price_cents_override >= 0),
  track_stock boolean not null default false,
  stock_qty integer not null default 0 check (stock_qty >= 0),
  low_stock_qty integer not null default 0 check (low_stock_qty >= 0),
  primary key (store_id, menu_item_id)
);

create index if not exists store_items_menu_item_id_idx
  on public.store_items (menu_item_id);
create index if not exists store_items_store_available_idx
  on public.store_items (store_id, available);

alter table public.store_items enable row level security;
revoke all on public.store_items from public, anon, authenticated;
grant select, insert, update on public.store_items to authenticated;
grant select, insert, update, delete on public.store_items to service_role;

insert into public.store_items (
  store_id,
  menu_item_id,
  available,
  track_stock,
  stock_qty
)
select
  s.id,
  mi.id,
  mi.available,
  mi.track_stock,
  coalesce(mi.stock_qty, 0)
from public.stores s
cross join public.menu_items mi
where s.active
on conflict (store_id, menu_item_id) do nothing;

create or replace function private.add_menu_item_to_stores()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.store_items (
    store_id, menu_item_id, available, track_stock, stock_qty
  )
  select s.id, new.id, new.available, new.track_stock, coalesce(new.stock_qty, 0)
  from public.stores s
  where s.active
  on conflict (store_id, menu_item_id) do nothing;

  return new;
end;
$$;

create or replace function private.add_store_to_menu_items()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.active then
    insert into public.store_items (
      store_id, menu_item_id, available, track_stock, stock_qty
    )
    select new.id, mi.id, mi.available, mi.track_stock, coalesce(mi.stock_qty, 0)
    from public.menu_items mi
    on conflict (store_id, menu_item_id) do nothing;
  end if;

  return new;
end;
$$;

revoke execute on function private.add_menu_item_to_stores() from public, anon, authenticated;
revoke execute on function private.add_store_to_menu_items() from public, anon, authenticated;

drop trigger if exists menu_items_fill_store_items on public.menu_items;
create trigger menu_items_fill_store_items
after insert on public.menu_items
for each row execute function private.add_menu_item_to_stores();

drop trigger if exists stores_fill_store_items on public.stores;
create trigger stores_fill_store_items
after insert or update of active on public.stores
for each row execute function private.add_store_to_menu_items();

-- Conserva a RPC herdada como implementação interna e expõe uma assinatura
-- onde a loja é sempre explícita.
alter function public.get_menu(text) set schema private;
alter function private.get_menu(text) rename to get_menu_legacy;
revoke all on function private.get_menu_legacy(text) from public, anon, authenticated;

create or replace function public.get_menu(
  p_store_slug text,
  p_channel text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_store public.stores%rowtype;
  v_legacy jsonb;
  v_categories jsonb := '[]'::jsonb;
  v_items jsonb;
  v_category jsonb;
  v_item jsonb;
  v_store_item record;
begin
  select s.*
  into v_store
  from public.stores s
  where s.slug = p_store_slug
    and s.active;

  if not found then
    raise exception 'store_not_found' using errcode = 'P0404';
  end if;

  v_legacy := private.get_menu_legacy(p_channel);

  for v_category in
    select value from jsonb_array_elements(v_legacy -> 'categories')
  loop
    v_items := '[]'::jsonb;

    for v_item in
      select value from jsonb_array_elements(v_category -> 'items')
    loop
      select
        si.available,
        si.track_stock,
        si.stock_qty,
        coalesce(si.price_cents_override, mi.price_cents) as effective_price_cents
      into v_store_item
      from public.store_items si
      join public.menu_items mi on mi.id = si.menu_item_id
      where si.store_id = v_store.id
        and si.menu_item_id = (v_item ->> 'id')::uuid;

      if found
        and v_store_item.available
        and (not v_store_item.track_stock or v_store_item.stock_qty > 0)
      then
        v_items := v_items || jsonb_build_array(
          v_item || jsonb_build_object(
            'price_cents', v_store_item.effective_price_cents,
            'available', true
          )
        );
      end if;
    end loop;

    if jsonb_array_length(v_items) > 0 then
      v_categories := v_categories || jsonb_build_array(
        (v_category - 'items') || jsonb_build_object('items', v_items)
      );
    end if;
  end loop;

  return (v_legacy - array[
    'accepting_orders', 'payment_provider',
    'mpesa_number', 'mpesa_name', 'emola_number', 'emola_name',
    'categories', 'zones'
  ]) || jsonb_build_object(
    'store', jsonb_build_object(
      'id', v_store.id,
      'slug', v_store.slug,
      'name', v_store.name,
      'short_name', v_store.short_name,
      'address', v_store.address,
      'maps_url', v_store.maps_url,
      'phone', v_store.phone,
      'delivery_enabled', v_store.delivery_enabled,
      'pickup_enabled', v_store.pickup_enabled,
      'counter_enabled', v_store.counter_enabled
    ),
    'accepting_orders', v_store.accepting_orders,
    'payment_provider', v_store.payment_provider,
    'mpesa_number', v_store.mpesa_number,
    'mpesa_name', v_store.mpesa_name,
    'emola_number', v_store.emola_number,
    'emola_name', v_store.emola_name,
    'categories', v_categories,
    'zones', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', z.id,
        'name', z.name,
        'fee_cents', z.fee_cents,
        'sort', z.sort
      ) order by z.sort), '[]'::jsonb)
      from public.delivery_zones z
      where z.store_id = v_store.id and z.active
    ),
    'hours', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'dow', h.dow,
        'opens', h.opens,
        'closes', h.closes,
        'active', h.active
      ) order by h.dow), '[]'::jsonb)
      from public.store_hours h
      where h.store_id = v_store.id
    )
  );
end;
$$;

revoke all on function public.get_menu(text, text) from public;
grant execute on function public.get_menu(text, text) to anon, authenticated, service_role;

alter function public.create_order(jsonb) set schema private;
alter function private.create_order(jsonb) rename to create_order_legacy;
revoke all on function private.create_order_legacy(jsonb) from public, anon, authenticated;

create or replace function public.create_order(
  p_store_slug text,
  p_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store public.stores%rowtype;
  v_item jsonb;
  v_store_item record;
  v_zone_id uuid;
  v_order_id uuid;
  v_day date;
  v_seq integer;
  v_order_number text;
  v_subtotal integer;
begin
  select s.*
  into v_store
  from public.stores s
  where s.slug = p_store_slug
    and s.active;

  if not found then
    raise exception 'store_not_found' using errcode = 'P0404';
  end if;

  if not v_store.accepting_orders then
    raise exception 'store_not_accepting_orders' using errcode = 'P0403';
  end if;

  if p_payload ->> 'fulfillmentType' = 'delivery' then
    if not v_store.delivery_enabled then
      raise exception 'delivery_disabled' using errcode = 'P0403';
    end if;

    v_zone_id := nullif(p_payload ->> 'deliveryZoneId', '')::uuid;
    if v_zone_id is null then
      raise exception 'delivery_zone_required' using errcode = 'P0007';
    end if;
    if not exists (
      select 1
      from public.delivery_zones z
      where z.id = v_zone_id
        and z.store_id = v_store.id
        and z.active
    ) then
      raise exception 'delivery_zone_store_mismatch' using errcode = 'P0401';
    end if;
  elsif p_payload ->> 'fulfillmentType' = 'pickup' and not v_store.pickup_enabled then
    raise exception 'pickup_disabled' using errcode = 'P0403';
  end if;

  for v_item in select value from jsonb_array_elements(p_payload -> 'items')
  loop
    select
      si.available,
      si.track_stock,
      si.stock_qty,
      coalesce(si.price_cents_override, mi.price_cents) as effective_price_cents,
      mi.price_cents as catalog_price_cents,
      mi.is_gift
    into v_store_item
    from public.store_items si
    join public.menu_items mi on mi.id = si.menu_item_id
    where si.store_id = v_store.id
      and si.menu_item_id = (v_item ->> 'menuItemId')::uuid;

    if not found
      or not v_store_item.available
      or (v_store_item.track_stock and v_store_item.stock_qty < (v_item ->> 'qty')::integer)
    then
      raise exception 'item_unavailable:%', v_item ->> 'menuItemId' using errcode = 'P0014';
    end if;
  end loop;

  perform set_config('app.request_store_id', v_store.id::text, true);
  v_order_id := private.create_order_legacy(p_payload);

  -- O motor herdado calcula extras/variantes. O override altera apenas a
  -- componente do preço base, preservando esses adicionais.
  update public.order_items oi
  set unit_price_cents = case
    when mi.is_gift and oi.unit_price_cents = 0 then 0
    else oi.unit_price_cents + coalesce(si.price_cents_override, mi.price_cents) - mi.price_cents
  end
  from public.menu_items mi
  join public.store_items si
    on si.menu_item_id = mi.id
   and si.store_id = v_store.id
  where oi.order_id = v_order_id
    and oi.menu_item_id = mi.id;

  select coalesce(sum(oi.unit_price_cents * oi.qty), 0)::integer
  into v_subtotal
  from public.order_items oi
  where oi.order_id = v_order_id;

  v_day := (now() at time zone 'Africa/Maputo')::date;
  insert into public.order_counters (store_id, day, seq)
  values (v_store.id, v_day, 1)
  on conflict (store_id, day) do update
    set seq = public.order_counters.seq + 1
  returning seq into v_seq;

  v_order_number := v_store.order_prefix || '-' || lpad(v_seq::text, 4, '0');

  update public.orders
  set order_number = v_order_number,
      subtotal_cents = v_subtotal,
      total_cents = greatest(0, v_subtotal - coalesce(discount_cents, 0) + delivery_fee_cents)
  where id = v_order_id;

  update public.event_log
  set payload = payload || jsonb_build_object(
    'order_number', v_order_number,
    'total_cents', (
      select o.total_cents from public.orders o where o.id = v_order_id
    )
  )
  where order_id = v_order_id
    and type = 'order.created';

  return v_order_id;
end;
$$;

revoke all on function public.create_order(text, jsonb) from public;
grant execute on function public.create_order(text, jsonb) to anon, authenticated, service_role;
