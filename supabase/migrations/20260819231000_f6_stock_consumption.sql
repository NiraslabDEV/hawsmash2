-- HAWSMASH 2.0 — F6: baixa de estoque por loja na mesma transacção da venda.
--
-- Antes desta migration o motor herdado descontava public.menu_items.stock_qty
-- — o catálogo global. Com duas lojas isso é errado: uma venda em Maputo
-- reduzia o stock que a Matola vê. A partir daqui a única fonte de stock é
-- store_items (por loja) e todo o consumo/reposição passa a deixar rasto em
-- stock_movements.

-- ---------------------------------------------------------------------------
-- 1. Venda de balcão: desconta e regista o movimento na mesma transacção.
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
  v_seq integer;
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
  returning seq into v_seq;

  v_order_number := v_store.order_prefix || '-' || lpad(v_seq::text, 4, '0');

  perform set_config('app.request_store_id', v_store.id::text, true);

  insert into public.orders (
    store_id, order_number, daily_number, client_sale_id,
    status, flow, fulfillment_type, channel,
    customer_name, customer_phone, customer_email,
    subtotal_cents, delivery_fee_cents, total_cents,
    payment_method, cash_received_cents, change_cents,
    needs_review, notes
  ) values (
    v_store.id, v_order_number, v_seq, v_client_sale_id,
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
    'daily_number', v_seq,
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

-- ---------------------------------------------------------------------------
-- 2. Anulação: a reposição passa a ser feita uma só vez, dentro da transição
--    de estado, a partir do que foi realmente consumido.
-- ---------------------------------------------------------------------------
create or replace function public.void_sale(
  p_order_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_role text;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_order public.orders%rowtype;
  v_restored integer := 0;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0020';
  end if;

  v_role := private.auth_role();
  if v_role is null or v_role not in ('owner', 'manager') then
    raise exception 'void_access_denied' using errcode = 'P0403';
  end if;

  if length(v_reason) < 3 or length(v_reason) > 500 then
    raise exception 'void_reason_required' using errcode = 'P0007';
  end if;

  select o.*
  into v_order
  from public.orders o
  where o.id = p_order_id
    and o.channel = 'counter'
    and private.auth_can_store(o.store_id)
  for update;

  if not found then
    raise exception 'sale_not_found_or_denied' using errcode = 'P0404';
  end if;

  if v_order.status = 'cancelled' then
    return jsonb_build_object(
      'order_id', v_order.id,
      'status', v_order.status,
      'restored_qty', 0,
      'duplicate', true
    );
  end if;

  if v_order.status = 'delivered' then
    raise exception 'cannot_void_delivered_sale' using errcode = 'P0003';
  end if;

  perform set_config('app.request_store_id', v_order.store_id::text, true);

  -- A transição e a reposição vivem em advance_order: a mesma transacção
  -- devolve o stock e deixa o movimento gravado.
  perform public.advance_order(v_order.id, 'CANCEL', v_reason);

  select coalesce(sum(sm.delta), 0)::integer
  into v_restored
  from public.stock_movements sm
  where sm.order_id = v_order.id
    and sm.reason = 'void';

  update public.payments
  set status = 'refunded'
  where order_id = v_order.id
    and store_id = v_order.store_id
    and status = 'confirmed';

  insert into public.event_log (
    order_id, store_id, actor_user_id, type, payload
  ) values (
    v_order.id,
    v_order.store_id,
    v_uid,
    'counter.sale_voided',
    jsonb_build_object(
      'reason', v_reason,
      'restored_qty', v_restored,
      'previous_status', v_order.status
    )
  );

  return jsonb_build_object(
    'order_id', v_order.id,
    'status', 'cancelled',
    'restored_qty', v_restored,
    'duplicate', false
  );
end;
$$;

revoke all on function public.void_sale(uuid, text) from public, anon;
grant execute on function public.void_sale(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Pedido online, fluxo manual (APPROVE) e cancelamento.
-- ---------------------------------------------------------------------------
create or replace function private.advance_order_legacy(
  p_order_id uuid,
  p_event text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order record;
  v_new_status text;
  v_message text;
  v_zone_name text;
  v_items jsonb := '[]'::jsonb;
begin
  select o.id, o.status, o.flow, o.payment_proof_path, o.customer_name, o.customer_phone,
         o.fulfillment_type, o.delivery_zone_id, o.address, o.scheduled_for, o.payment_method,
         o.notes, o.total_cents, o.created_at
  into v_order
  from public.orders o
  where o.id = p_order_id;
  if not found then raise exception 'order_not_found' using errcode = 'P0001'; end if;

  if p_event = 'APPROVE' then
    if v_order.status <> 'awaiting_approval' then
      raise exception 'invalid_transition: cannot approve from status %', v_order.status;
    end if;
    v_new_status := 'approved';
    v_message := 'Pagamento confirmado pelo dono';
    -- Baixa de estoque da loja do pedido, na mesma transacção da aprovação.
    perform private.consume_order_stock(p_order_id);
  elsif p_event = 'START_PREPARATION' then
    if v_order.status not in ('approved', 'paid') then
      raise exception 'invalid_transition: cannot start preparation from status %', v_order.status;
    end if;
    v_new_status := 'in_preparation';
    v_message := 'Em preparação';
  elsif p_event = 'MARK_READY' then
    if v_order.status <> 'in_preparation' then
      raise exception 'invalid_transition: cannot mark ready from status %', v_order.status;
    end if;
    v_new_status := 'ready';
    v_message := 'Pronto para entrega/levantamento';
  elsif p_event = 'DELIVER' then
    if v_order.status <> 'ready' then
      raise exception 'invalid_transition: cannot deliver from status %', v_order.status;
    end if;
    v_new_status := 'delivered';
    v_message := 'Entregue';
  elsif p_event = 'CANCEL' then
    if v_order.status in ('delivered', 'cancelled') then
      raise exception 'invalid_transition: cannot cancel terminal state %', v_order.status;
    end if;
    if p_reason is null or length(btrim(p_reason)) = 0 then
      raise exception 'cancel_reason_required' using errcode = 'P0002';
    end if;
    v_new_status := 'cancelled';
    v_message := p_reason;
    -- Repõe exactamente o que foi consumido; nunca repõe duas vezes.
    perform private.restore_order_stock(p_order_id);
  else
    raise exception 'invalid_event:%.', p_event using errcode = 'P0003';
  end if;

  update public.orders set status = v_new_status, updated_at = now() where id = p_order_id;

  insert into public.event_log (order_id, type, payload)
  values (
    p_order_id,
    'order.' || lower(p_event),
    jsonb_build_object('new_status', v_new_status, 'reason', p_reason, 'message', v_message)
  );

  if p_event = 'APPROVE' then
    if v_order.fulfillment_type = 'delivery' and v_order.delivery_zone_id is not null then
      select z.name into v_zone_name from public.delivery_zones z where z.id = v_order.delivery_zone_id;
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
      'name', oi.name_snapshot, 'quantity', oi.qty, 'notes', oi.notes
    ) order by oi.id), '[]'::jsonb)
    into v_items
    from public.order_items oi
    where oi.order_id = p_order_id;

    insert into public.print_jobs (order_id, station, payload)
    values (
      p_order_id,
      'kitchen',
      jsonb_build_object(
        'order_number', (select o.order_number from public.orders o where o.id = p_order_id),
        'customer_name', v_order.customer_name,
        'fulfillment_type', v_order.fulfillment_type,
        'delivery_zone', v_zone_name,
        'address', v_order.address,
        'scheduled_for', v_order.scheduled_for,
        'items', v_items,
        'payment_method', v_order.payment_method,
        'payment_status', 'paid',
        'total_cents', v_order.total_cents,
        'notes', v_order.notes,
        'created_at', v_order.created_at
      )
    );

    insert into public.event_log (order_id, type, payload)
    values (
      p_order_id,
      'print_job.created',
      jsonb_build_object('trigger', 'advance_order.APPROVE', 'station', 'kitchen')
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'order_id', p_order_id,
    'new_status', v_new_status,
    'message', v_message
  );
end;
$$;

revoke all on function private.advance_order_legacy(uuid, text, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Pedido online, fluxo digital (webhook do gateway).
-- ---------------------------------------------------------------------------
create or replace function private.confirm_payment_legacy(
  p_idempotency_key text,
  p_order_id uuid,
  p_provider text,
  p_provider_ref text,
  p_method text,
  p_amount_cents integer,
  p_raw_webhook jsonb default '{}'::jsonb
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted integer;
  v_payment_id uuid;
  v_order record;
  v_zone_name text;
  v_items jsonb := '[]'::jsonb;
begin
  insert into public.payments (
    order_id, provider, provider_ref, method, amount_cents, idempotency_key, raw_webhook
  ) values (
    p_order_id, p_provider, p_provider_ref, p_method, p_amount_cents, p_idempotency_key, p_raw_webhook
  )
  on conflict (idempotency_key) do nothing;

  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then return 'duplicate'; end if;

  select p.id into v_payment_id
  from public.payments p
  where p.idempotency_key = p_idempotency_key;

  select o.id, o.status, o.total_cents, o.order_number, o.flow, o.fulfillment_type,
         o.delivery_zone_id, o.address, o.customer_name, o.customer_phone, o.scheduled_for,
         o.payment_method, o.notes, o.created_at
  into v_order
  from public.orders o
  where o.id = p_order_id
  for update;

  if not found then
    insert into public.event_log (order_id, type, payload)
    values (p_order_id, 'payment.order_not_found', jsonb_build_object('idempotency_key', p_idempotency_key));
    return 'order_not_found';
  end if;

  if p_amount_cents <> v_order.total_cents then
    insert into public.event_log (order_id, type, payload)
    values (
      p_order_id,
      'payment.amount_mismatch',
      jsonb_build_object(
        'expected', v_order.total_cents,
        'received', p_amount_cents,
        'idempotency_key', p_idempotency_key
      )
    );
    return 'amount_mismatch';
  end if;

  -- Baixa de estoque da loja do pedido; falha aqui reverte o pagamento inteiro.
  perform private.consume_order_stock(p_order_id);

  update public.payments set status = 'confirmed' where id = v_payment_id;

  if v_order.status not in ('awaiting_payment', 'payment_failed') then
    insert into public.event_log (order_id, type, payload)
    values (
      p_order_id,
      'payment.confirmed_on_invalid_state',
      jsonb_build_object('status', v_order.status, 'idempotency_key', p_idempotency_key)
    );
    return 'invalid_state';
  end if;

  update public.orders set status = 'paid', updated_at = now() where id = p_order_id;

  if v_order.fulfillment_type = 'delivery' and v_order.delivery_zone_id is not null then
    select z.name into v_zone_name from public.delivery_zones z where z.id = v_order.delivery_zone_id;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'name', oi.name_snapshot, 'quantity', oi.qty, 'notes', oi.notes
  ) order by oi.id), '[]'::jsonb)
  into v_items
  from public.order_items oi
  where oi.order_id = p_order_id;

  insert into public.print_jobs (order_id, station, payload)
  values (
    p_order_id,
    'kitchen',
    jsonb_build_object(
      'order_number', v_order.order_number,
      'customer_name', v_order.customer_name,
      'fulfillment_type', v_order.fulfillment_type,
      'delivery_zone', v_zone_name,
      'address', v_order.address,
      'scheduled_for', v_order.scheduled_for,
      'items', v_items,
      'payment_method', v_order.payment_method,
      'payment_status', 'paid',
      'total_cents', v_order.total_cents,
      'notes', v_order.notes,
      'created_at', v_order.created_at
    )
  );

  insert into public.event_log (order_id, type, payload)
  values (
    p_order_id,
    'payment.confirmed',
    jsonb_build_object('provider', p_provider, 'method', p_method, 'amount_cents', p_amount_cents)
  );

  return 'ok';
end;
$$;

revoke all on function private.confirm_payment_legacy(text, uuid, text, text, text, integer, jsonb)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. O catálogo global deixa de guardar stock: a partir daqui a verdade é
--    store_items. O trigger herdado em menu_items fica inerte.
-- ---------------------------------------------------------------------------
comment on column public.menu_items.stock_qty is
  'Obsoleto desde a F6: o stock real vive em store_items.stock_qty, por loja.';
comment on column public.menu_items.track_stock is
  'Obsoleto desde a F6: o controlo de stock é por loja em store_items.track_stock.';
