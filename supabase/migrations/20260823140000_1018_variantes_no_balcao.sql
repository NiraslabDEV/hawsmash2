-- 1018 — o balcão passa a vender variantes (HAW / WAGYU).
--
-- Medido antes desta migration: create_counter_sale aceitava 300 MT por um
-- Classic Smash WAGYU (que custa 400) e gravava variant_name_snapshot a null.
-- Cada WAGYU vendido ao balcão perdia 100 MT, com o talão a sair certinho e o
-- preço errado — o pior tipo de bug de dinheiro, porque não se vê.
--
-- A causa: create_counter_sale_unlocked tem o seu próprio ciclo de preços e
-- preçava por `v_item_row.price_cents` (o preço base do item), deitando fora o
-- `variantId` do payload sem levantar erro nenhum. A loja online já vendia bem.
--
-- Esta migration reescreve a função com a variante resolvida no mesmo sítio
-- onde a disponibilidade e o stock já são validados. O preço da variante
-- SUBSTITUI o do item base, que é exactamente o que o motor da loja online faz
-- — duas contas diferentes para o mesmo preço é o que a Regra 2 proíbe.
--
-- Nota sobre `store_items.price_cents_override`: quando há variante, o override
-- da loja deixa de se aplicar, porque a variante traz o preço completo. É o
-- comportamento do motor online e replico-o de propósito. Hoje não faz diferença
-- (os preços são iguais nas duas lojas, CLAUDE §16 P2); fica registado como
-- divergência a decidir, não como bug a corrigir por minha conta.
--
-- Forward-only: substitui a função inteira, sem tocar em dados.

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
  v_variant record;
  v_variant_name text;
  v_unit_price integer;
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

    -- Variante (HAW/WAGYU): o preço da variante SUBSTITUI o do item base, tal
    -- como o motor da loja online faz. Antes disto o balcão preçava sempre pelo
    -- item base e cada WAGYU saía 100 MT abaixo, com o talão a sair certinho.
    --
    -- A variante tem de pertencer a ESTE item e estar activa. Sem isso, colar
    -- uma variante barata a um produto caro seria um desconto que ninguém pediu.
    v_variant_name := null;
    v_unit_price := v_item_row.price_cents;

    if nullif(btrim(v_item ->> 'variantId'), '') is not null then
      select mv.name, mv.price_cents
      into v_variant
      from public.menu_item_variants mv
      where mv.id = (v_item ->> 'variantId')::uuid
        and mv.menu_item_id = v_menu_item_id
        and mv.active;

      if not found then
        raise exception 'invalid_variant:%', v_item ->> 'variantId'
          using errcode = 'P0015';
      end if;

      v_unit_price := v_variant.price_cents;
      v_variant_name := v_variant.name;
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

    v_subtotal := v_subtotal + (v_unit_price * v_qty);
    v_resolved_items := v_resolved_items || jsonb_build_array(jsonb_build_object(
      'menu_item_id', v_menu_item_id,
      'name', v_item_row.name,
      'station', v_item_row.station,
      'qty', v_qty,
      'unit_price_cents', v_unit_price,
      'variant_name', v_variant_name,
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
      qty, unit_price_cents, station, notes, variant_name_snapshot
    ) values (
      v_order_id,
      v_store.id,
      (v_resolved_item ->> 'menu_item_id')::uuid,
      v_resolved_item ->> 'name',
      (v_resolved_item ->> 'qty')::integer,
      (v_resolved_item ->> 'unit_price_cents')::integer,
      v_resolved_item ->> 'station',
      v_resolved_item ->> 'notes',
      v_resolved_item ->> 'variant_name'
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
