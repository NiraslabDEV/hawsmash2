-- HAWSMASH 2.0 — 1012: o número do pedido deixa de repetir na viragem do dia.
--
-- BUG APANHADO EM STAGING (20/08/2026, ao virar a data): `orders.order_number`
-- é `unique`, mas era gerado a partir de `order_counters`, que **reinicia todos
-- os dias por loja**. No segundo dia de operação, o primeiro pedido de cada loja
-- tentava gravar `MPT-0001` outra vez e rebentava com duplicate key — ou seja,
-- na manhã seguinte à abertura **nenhuma venda entrava**, nem online nem balcão.
--
-- Correcção, alinhada com o que o CLAUDE.md §5.4 sempre disse:
--   · `order_number`  → sequência **contínua** por loja (histórico, email, pesquisa);
--   · `daily_number`  → contador **diário** por loja (talão grande, TV de senhas).
-- O pedido online passa também a receber `daily_number`: sem ele, um delivery
-- nunca aparecia na TV de senhas nem tinha número para chamar ao balcão.

create table if not exists public.store_order_sequences (
  store_id uuid primary key references public.stores(id) on delete cascade,
  seq integer not null default 0 check (seq >= 0)
);

alter table public.store_order_sequences enable row level security;
revoke all on table public.store_order_sequences from public, anon, authenticated;
grant select, insert, update, delete on table public.store_order_sequences to service_role;

drop policy if exists store_order_sequences_staff_select on public.store_order_sequences;
create policy store_order_sequences_staff_select on public.store_order_sequences
  for select to authenticated
  using (private.auth_can_store(store_id));
grant select on table public.store_order_sequences to authenticated;

-- Arranca de onde o histórico já vai, para não colidir com pedidos existentes
-- (incluindo os que vierem da importação do HAWSMASH 1.0).
insert into public.store_order_sequences (store_id, seq)
select
  s.id,
  coalesce(
    (
      select max((regexp_match(o.order_number, '(\d+)$'))[1]::integer)
      from public.orders o
      where o.store_id = s.id
        and o.order_number ~ '(\d+)$'
    ),
    0
  )
from public.stores s
on conflict (store_id) do update
  set seq = greatest(public.store_order_sequences.seq, excluded.seq);

-- ---------------------------------------------------------------------------
-- Próximo número contínuo da loja. Salta números já ocupados (histórico
-- importado) em vez de rebentar a venda.
-- ---------------------------------------------------------------------------
create or replace function private.next_order_number(p_store_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prefix text;
  v_seq integer;
  v_candidate text;
  v_attempts integer := 0;
begin
  select s.order_prefix into v_prefix
  from public.stores s
  where s.id = p_store_id;

  if v_prefix is null then
    raise exception 'store_not_found' using errcode = 'P0404';
  end if;

  loop
    v_attempts := v_attempts + 1;
    if v_attempts > 1000 then
      raise exception 'order_number_exhausted' using errcode = 'P0500';
    end if;

    insert into public.store_order_sequences (store_id, seq)
    values (p_store_id, 1)
    on conflict (store_id) do update
      set seq = public.store_order_sequences.seq + 1
    returning seq into v_seq;

    v_candidate := v_prefix || '-' || lpad(v_seq::text, 4, '0');

    exit when not exists (
      select 1 from public.orders o where o.order_number = v_candidate
    );
  end loop;

  return v_candidate;
end;
$$;

revoke all on function private.next_order_number(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Pedido online: número contínuo + número do dia.
-- ---------------------------------------------------------------------------
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
  v_daily integer;
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

  -- Número do dia (reinicia todos os dias, por loja) — é o que sai grande no
  -- talão e o que a TV de senhas chama.
  v_day := (now() at time zone 'Africa/Maputo')::date;
  insert into public.order_counters (store_id, day, seq)
  values (v_store.id, v_day, 1)
  on conflict (store_id, day) do update
    set seq = public.order_counters.seq + 1
  returning seq into v_daily;

  -- Número do pedido (contínuo por loja, nunca reinicia).
  v_order_number := private.next_order_number(v_store.id);

  update public.orders
  set order_number = v_order_number,
      daily_number = v_daily,
      subtotal_cents = v_subtotal,
      total_cents = greatest(0, v_subtotal - coalesce(discount_cents, 0) + delivery_fee_cents)
  where id = v_order_id;

  update public.event_log
  set payload = payload || jsonb_build_object(
    'order_number', v_order_number,
    'daily_number', v_daily,
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

-- ---------------------------------------------------------------------------
-- Venda de balcão: mesma separação entre número do pedido e número do dia.
-- ---------------------------------------------------------------------------
create or replace function public.create_counter_sale_unlocked(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_role text;
  v_device public.devices%rowtype;
  v_store public.stores%rowtype;
  v_existing public.orders%rowtype;
  v_client_sale_id uuid;
  v_item jsonb;
  v_payment jsonb;
  v_resolved_item jsonb;
  v_resolved_items jsonb := '[]'::jsonb;
  v_seen_items uuid[] := array[]::uuid[];
  v_menu_item_id uuid;
  v_qty integer;
  v_item_row record;
  v_stock_after integer;
  v_subtotal integer := 0;
  v_payment_total integer := 0;
  v_cash_payment integer := 0;
  v_cash_received integer;
  v_change integer;
  v_payment_method text;
  v_payment_index integer := 0;
  v_day date;
  v_daily integer;
  v_order_number text;
  v_order_id uuid;
  v_expected_total integer;
  v_needs_review boolean := false;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0020';
  end if;

  v_role := private.auth_role();
  if v_role is null or v_role not in ('owner', 'manager', 'cashier') then
    raise exception 'pos_access_denied' using errcode = 'P0403';
  end if;

  begin
    v_client_sale_id := nullif(p_payload ->> 'clientSaleId', '')::uuid;
  exception when invalid_text_representation then
    raise exception 'invalid_client_sale_id' using errcode = 'P0007';
  end;
  if v_client_sale_id is null then
    raise exception 'client_sale_id_required' using errcode = 'P0007';
  end if;

  select d.*
  into v_device
  from public.devices d
  where d.id = nullif(p_payload ->> 'deviceId', '')::uuid
    and d.kind = 'pos'
    and d.active
    and private.auth_can_store(d.store_id);

  if not found then
    raise exception 'invalid_or_unauthorised_device' using errcode = 'P0403';
  end if;

  select s.*
  into v_store
  from public.stores s
  where s.id = v_device.store_id
    and s.active
    and s.counter_enabled;

  if not found then
    raise exception 'counter_disabled' using errcode = 'P0403';
  end if;

  -- Serializa retries concorrentes da mesma venda antes de consultar a chave única.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_client_sale_id::text, 0)
  );

  select o.*
  into v_existing
  from public.orders o
  where o.client_sale_id = v_client_sale_id;

  if found then
    if v_existing.store_id <> v_store.id then
      raise exception 'client_sale_id_store_conflict' using errcode = 'P0409';
    end if;

    return jsonb_build_object(
      'order_id', v_existing.id,
      'order_number', v_existing.order_number,
      'daily_number', v_existing.daily_number,
      'total_cents', v_existing.total_cents,
      'cash_received_cents', v_existing.cash_received_cents,
      'change_cents', v_existing.change_cents,
      'needs_review', v_existing.needs_review,
      'duplicate', true
    );
  end if;

  if p_payload -> 'items' is null
    or jsonb_typeof(p_payload -> 'items') <> 'array'
    or jsonb_array_length(p_payload -> 'items') = 0
    or jsonb_array_length(p_payload -> 'items') > 100
  then
    raise exception 'invalid_items' using errcode = 'P0007';
  end if;

  for v_item in select value from jsonb_array_elements(p_payload -> 'items')
  loop
    begin
      v_menu_item_id := nullif(v_item ->> 'menuItemId', '')::uuid;
      v_qty := (v_item ->> 'qty')::integer;
    exception when invalid_text_representation then
      raise exception 'invalid_item' using errcode = 'P0007';
    end;

    if v_menu_item_id is null or v_qty is null or v_qty < 1 or v_qty > 99 then
      raise exception 'invalid_item' using errcode = 'P0007';
    end if;
    if v_menu_item_id = any(v_seen_items) then
      raise exception 'duplicate_item:%', v_menu_item_id using errcode = 'P0007';
    end if;
    v_seen_items := array_append(v_seen_items, v_menu_item_id);

    select
      mi.name,
      mc.station,
      si.available,
      si.track_stock,
      si.stock_qty,
      coalesce(si.price_cents_override, mi.price_cents) as price_cents
    into v_item_row
    from public.store_items si
    join public.menu_items mi on mi.id = si.menu_item_id
    join public.menu_categories mc on mc.id = mi.category_id
    where si.store_id = v_store.id
      and si.menu_item_id = v_menu_item_id
    for update of si;

    if not found or not v_item_row.available then
      raise exception 'item_unavailable:%', v_menu_item_id using errcode = 'P0014';
    end if;
    if v_item_row.track_stock and v_item_row.stock_qty < v_qty then
      raise exception 'out_of_stock:%', v_menu_item_id using errcode = 'P0014';
    end if;

    v_stock_after := null;
    if v_item_row.track_stock then
      update public.store_items si
      set stock_qty = si.stock_qty - v_qty
      where si.store_id = v_store.id
        and si.menu_item_id = v_menu_item_id
        and si.stock_qty >= v_qty
      returning si.stock_qty into v_stock_after;

      if v_stock_after is null then
        raise exception 'out_of_stock:%', v_menu_item_id using errcode = 'P0014';
      end if;
    end if;

    v_subtotal := v_subtotal + (v_item_row.price_cents * v_qty);
    v_resolved_items := v_resolved_items || jsonb_build_array(jsonb_build_object(
      'menu_item_id', v_menu_item_id,
      'name', v_item_row.name,
      'station', v_item_row.station,
      'qty', v_qty,
      'unit_price_cents', v_item_row.price_cents,
      'notes', nullif(btrim(v_item ->> 'notes'), ''),
      'stock_after', v_stock_after
    ));
  end loop;

  if p_payload -> 'payments' is null
    or jsonb_typeof(p_payload -> 'payments') <> 'array'
    or jsonb_array_length(p_payload -> 'payments') = 0
    or jsonb_array_length(p_payload -> 'payments') > 4
  then
    raise exception 'invalid_payments' using errcode = 'P0007';
  end if;

  for v_payment in select value from jsonb_array_elements(p_payload -> 'payments')
  loop
    if v_payment ->> 'method' not in ('cash', 'mpesa', 'emola', 'credit_card') then
      raise exception 'invalid_payment_method' using errcode = 'P0007';
    end if;

    begin
      v_qty := (v_payment ->> 'amountCents')::integer;
    exception when invalid_text_representation then
      raise exception 'invalid_payment_amount' using errcode = 'P0007';
    end;
    if v_qty is null or v_qty <= 0 then
      raise exception 'invalid_payment_amount' using errcode = 'P0007';
    end if;

    if v_payment_method is null then
      v_payment_method := v_payment ->> 'method';
    end if;
    v_payment_total := v_payment_total + v_qty;
    if v_payment ->> 'method' = 'cash' then
      v_cash_payment := v_cash_payment + v_qty;
    end if;
  end loop;

  if v_payment_total <> v_subtotal then
    raise exception 'payment_total_mismatch' using errcode = 'P0007';
  end if;

  if v_cash_payment > 0 then
    begin
      v_cash_received := (p_payload ->> 'cashReceivedCents')::integer;
    exception when invalid_text_representation then
      raise exception 'invalid_cash_received' using errcode = 'P0007';
    end;
    if v_cash_received is null or v_cash_received < v_cash_payment then
      raise exception 'insufficient_cash_received' using errcode = 'P0007';
    end if;
    v_change := v_cash_received - v_cash_payment;
  else
    v_cash_received := null;
    v_change := null;
  end if;

  if p_payload ? 'expectedTotalCents' then
    begin
      v_expected_total := (p_payload ->> 'expectedTotalCents')::integer;
    exception when invalid_text_representation then
      raise exception 'invalid_expected_total' using errcode = 'P0007';
    end;
    v_needs_review := v_expected_total <> v_subtotal;
  end if;

  v_day := (now() at time zone 'Africa/Maputo')::date;
  insert into public.order_counters (store_id, day, seq)
  values (v_store.id, v_day, 1)
  on conflict (store_id, day) do update
    set seq = public.order_counters.seq + 1
  returning seq into v_daily;

  v_order_number := private.next_order_number(v_store.id);

  perform set_config('app.request_store_id', v_store.id::text, true);

  insert into public.orders (
    store_id, order_number, daily_number, client_sale_id,
    status, flow, fulfillment_type, channel,
    customer_name, customer_phone, customer_email,
    subtotal_cents, delivery_fee_cents, total_cents,
    payment_method, cash_received_cents, change_cents,
    needs_review, notes
  ) values (
    v_store.id, v_order_number, v_daily, v_client_sale_id,
    'paid', 'manual', 'pickup', 'counter',
    coalesce(nullif(btrim(p_payload ->> 'customerName'), ''), 'Balcão'),
    nullif(btrim(p_payload ->> 'customerPhone'), ''),
    nullif(btrim(p_payload ->> 'customerEmail'), ''),
    v_subtotal, 0, v_subtotal,
    v_payment_method, v_cash_received, v_change,
    v_needs_review, nullif(btrim(p_payload ->> 'notes'), '')
  )
  returning id into v_order_id;

  for v_resolved_item in select value from jsonb_array_elements(v_resolved_items)
  loop
    insert into public.order_items (
      order_id, store_id, menu_item_id, name_snapshot,
      qty, unit_price_cents, station, notes
    ) values (
      v_order_id,
      v_store.id,
      (v_resolved_item ->> 'menu_item_id')::uuid,
      v_resolved_item ->> 'name',
      (v_resolved_item ->> 'qty')::integer,
      (v_resolved_item ->> 'unit_price_cents')::integer,
      v_resolved_item ->> 'station',
      v_resolved_item ->> 'notes'
    );

    -- O movimento fica ligado ao pedido; sem pedido não haveria a que o ligar.
    if v_resolved_item ->> 'stock_after' is not null then
      perform private.record_stock_movement(
        v_store.id,
        (v_resolved_item ->> 'menu_item_id')::uuid,
        -(v_resolved_item ->> 'qty')::integer,
        'sale',
        v_order_id,
        null,
        (v_resolved_item ->> 'stock_after')::integer
      );
    end if;
  end loop;

  for v_payment in select value from jsonb_array_elements(p_payload -> 'payments')
  loop
    v_payment_index := v_payment_index + 1;
    insert into public.payments (
      order_id, store_id, provider, method, amount_cents,
      status, idempotency_key
    ) values (
      v_order_id,
      v_store.id,
      'counter',
      v_payment ->> 'method',
      (v_payment ->> 'amountCents')::integer,
      'confirmed',
      'counter:' || v_client_sale_id::text || ':' || v_payment_index::text
    );
  end loop;

  if not exists (
    select 1 from public.cash_sessions cs
    where cs.store_id = v_store.id and cs.closed_at is null
  ) then
    insert into public.cash_sessions (store_id, opened_by)
    values (v_store.id, v_uid);

    insert into public.event_log (store_id, actor_user_id, type, payload)
    values (
      v_store.id,
      v_uid,
      'cash.session_auto_opened',
      jsonb_build_object('source', 'counter_sale')
    );
  end if;

  insert into public.event_log (
    order_id, store_id, actor_user_id, type, payload
  ) values (
    v_order_id,
    v_store.id,
    v_uid,
    'counter.sale_created',
    jsonb_build_object(
      'client_sale_id', v_client_sale_id,
      'device_id', v_device.id,
      'total_cents', v_subtotal,
      'needs_review', v_needs_review
    )
  );

  update public.devices
  set last_seen_at = now()
  where id = v_device.id;

  return jsonb_build_object(
    'order_id', v_order_id,
    'order_number', v_order_number,
    'daily_number', v_daily,
    'total_cents', v_subtotal,
    'cash_received_cents', v_cash_received,
    'change_cents', v_change,
    'needs_review', v_needs_review,
    'duplicate', false
  );
end;
$$;

revoke all on function public.create_counter_sale_unlocked(jsonb)
  from public, anon, authenticated;
