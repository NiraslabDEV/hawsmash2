-- ============================================================================
-- Fix: dedução de stock usava `v_updated int` para ler `track_stock` (boolean)
-- → "invalid input syntax for type integer: f" sempre que um item NÃO tem
-- track_stock (o default). Partia confirm_payment e advance_order APPROVE para
-- qualquer pedido com itens normais. Corrigido com variável boolean dedicada.
-- ============================================================================

create or replace function public.confirm_payment(
  p_idempotency_key text, p_order_id uuid, p_provider text, p_provider_ref text,
  p_method text, p_amount_cents int, p_raw_webhook jsonb default '{}'::jsonb
) returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_inserted int; v_payment_id uuid; v_order record; v_item_el record; v_updated int;
  v_tracks boolean; v_zone_name text; v_items jsonb := '[]'::jsonb;
begin
  insert into payments (order_id, provider, provider_ref, method, amount_cents, idempotency_key, raw_webhook)
  values (p_order_id, p_provider, p_provider_ref, p_method, p_amount_cents, p_idempotency_key, p_raw_webhook)
  on conflict (idempotency_key) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then return 'duplicate'; end if;
  select id into v_payment_id from payments where idempotency_key = p_idempotency_key;
  select o.id, o.status, o.total_cents, o.order_number, o.flow, o.fulfillment_type, o.delivery_zone_id, o.address, o.customer_name, o.customer_phone, o.scheduled_for, o.payment_method, o.notes, o.created_at
  into v_order from orders o where o.id = p_order_id for update;
  if not found then
    insert into event_log (order_id, type, payload) values (p_order_id, 'payment.order_not_found', jsonb_build_object('idempotency_key', p_idempotency_key));
    return 'order_not_found';
  end if;
  if p_amount_cents != v_order.total_cents then
    insert into event_log (order_id, type, payload) values (p_order_id, 'payment.amount_mismatch', jsonb_build_object('expected', v_order.total_cents, 'received', p_amount_cents, 'idempotency_key', p_idempotency_key));
    return 'amount_mismatch';
  end if;
  for v_item_el in select oi.menu_item_id, oi.qty from order_items oi where oi.order_id = p_order_id loop
    update menu_items set stock_qty = stock_qty - v_item_el.qty where id = v_item_el.menu_item_id and track_stock = true and stock_qty >= v_item_el.qty;
    get diagnostics v_updated = row_count;
    if v_updated = 0 then
      select track_stock into v_tracks from menu_items where id = v_item_el.menu_item_id;
      if coalesce(v_tracks, false) then
        insert into event_log (order_id, type, payload) values (p_order_id, 'payment.stock_insufficient', jsonb_build_object('menu_item_id', v_item_el.menu_item_id, 'requested_qty', v_item_el.qty, 'idempotency_key', p_idempotency_key));
        raise exception 'out_of_stock:%.', v_item_el.menu_item_id using errcode = 'P0105';
      end if;
    end if;
  end loop;
  update payments set status = 'confirmed' where id = v_payment_id;
  if v_order.status not in ('awaiting_payment', 'payment_failed') then
    insert into event_log (order_id, type, payload) values (p_order_id, 'payment.confirmed_on_invalid_state', jsonb_build_object('status', v_order.status, 'idempotency_key', p_idempotency_key));
    return 'invalid_state';
  end if;
  update orders set status = 'paid', updated_at = now() where id = p_order_id;
  if v_order.fulfillment_type = 'delivery' and v_order.delivery_zone_id is not null then
    select name into v_zone_name from delivery_zones where id = v_order.delivery_zone_id;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('name', oi.name_snapshot, 'quantity', oi.qty, 'notes', oi.notes) order by oi.id), '[]'::jsonb) into v_items from order_items oi where oi.order_id = p_order_id;
  insert into print_jobs (order_id, station, payload) values (p_order_id, 'kitchen', jsonb_build_object('order_number', v_order.order_number, 'customer_name', v_order.customer_name, 'fulfillment_type', v_order.fulfillment_type, 'delivery_zone', v_zone_name, 'address', v_order.address, 'scheduled_for', v_order.scheduled_for, 'items', v_items, 'payment_method', v_order.payment_method, 'payment_status', 'paid', 'total_cents', v_order.total_cents, 'notes', v_order.notes, 'created_at', v_order.created_at));
  insert into event_log (order_id, type, payload) values (p_order_id, 'payment.confirmed', jsonb_build_object('provider', p_provider, 'method', p_method, 'amount_cents', p_amount_cents));
  return 'ok';
end;
$$;

create or replace function public.advance_order(p_order_id uuid, p_event text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_order record; v_new_status text; v_message text; v_item_el record; v_updated int;
  v_tracks boolean; v_zone_name text; v_items jsonb := '[]'::jsonb;
begin
  select o.id, o.status, o.flow, o.payment_proof_path, o.customer_name, o.customer_phone, o.fulfillment_type, o.delivery_zone_id, o.address, o.scheduled_for, o.payment_method, o.notes, o.total_cents, o.created_at
  into v_order from orders o where o.id = p_order_id;
  if not found then raise exception 'order_not_found' using errcode = 'P0001'; end if;
  if p_event = 'APPROVE' then
    if v_order.status != 'awaiting_approval' then raise exception 'invalid_transition: cannot approve from status %', v_order.status; end if;
    v_new_status := 'approved'; v_message := 'Pagamento confirmado pelo dono';
    for v_item_el in select oi.menu_item_id, oi.qty from order_items oi where oi.order_id = p_order_id loop
      update menu_items set stock_qty = stock_qty - v_item_el.qty where id = v_item_el.menu_item_id and track_stock = true and stock_qty >= v_item_el.qty;
      get diagnostics v_updated = row_count;
      if v_updated = 0 then
        select track_stock into v_tracks from menu_items where id = v_item_el.menu_item_id;
        if coalesce(v_tracks, false) then
          insert into event_log (order_id, type, payload) values (p_order_id, 'order.approve_stock_insufficient', jsonb_build_object('menu_item_id', v_item_el.menu_item_id, 'requested_qty', v_item_el.qty));
          raise exception 'out_of_stock:%.', v_item_el.menu_item_id using errcode = 'P0105';
        end if;
      end if;
    end loop;
  elsif p_event = 'START_PREPARATION' then
    if v_order.status not in ('approved', 'paid') then raise exception 'invalid_transition: cannot start preparation from status %', v_order.status; end if;
    v_new_status := 'in_preparation'; v_message := 'Em preparação';
  elsif p_event = 'MARK_READY' then
    if v_order.status != 'in_preparation' then raise exception 'invalid_transition: cannot mark ready from status %', v_order.status; end if;
    v_new_status := 'ready'; v_message := 'Pronto para entrega/levantamento';
  elsif p_event = 'DELIVER' then
    if v_order.status != 'ready' then raise exception 'invalid_transition: cannot deliver from status %', v_order.status; end if;
    v_new_status := 'delivered'; v_message := 'Entregue';
  elsif p_event = 'CANCEL' then
    if v_order.status in ('delivered', 'cancelled') then raise exception 'invalid_transition: cannot cancel terminal state %', v_order.status; end if;
    if p_reason is null or length(trim(p_reason)) = 0 then raise exception 'cancel_reason_required' using errcode = 'P0002'; end if;
    v_new_status := 'cancelled'; v_message := p_reason;
  else raise exception 'invalid_event:%.', p_event using errcode = 'P0003';
  end if;
  update orders set status = v_new_status, updated_at = now() where id = p_order_id;
  insert into event_log (order_id, type, payload) values (p_order_id, 'order.' || lower(p_event), jsonb_build_object('new_status', v_new_status, 'reason', p_reason, 'message', v_message));
  if p_event = 'APPROVE' then
    if v_order.fulfillment_type = 'delivery' and v_order.delivery_zone_id is not null then
      select name into v_zone_name from delivery_zones where id = v_order.delivery_zone_id;
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('name', oi.name_snapshot, 'quantity', oi.qty, 'notes', oi.notes) order by oi.id), '[]'::jsonb) into v_items from order_items oi where oi.order_id = p_order_id;
    insert into print_jobs (order_id, station, payload) values (p_order_id, 'kitchen', jsonb_build_object('order_number', (select order_number from orders where id = p_order_id), 'customer_name', v_order.customer_name, 'fulfillment_type', v_order.fulfillment_type, 'delivery_zone', v_zone_name, 'address', v_order.address, 'scheduled_for', v_order.scheduled_for, 'items', v_items, 'payment_method', v_order.payment_method, 'payment_status', 'paid', 'total_cents', v_order.total_cents, 'notes', v_order.notes, 'created_at', v_order.created_at));
    insert into event_log (order_id, type, payload) values (p_order_id, 'print_job.created', jsonb_build_object('trigger', 'advance_order.APPROVE', 'station', 'kitchen'));
  end if;
  return jsonb_build_object('success', true, 'order_id', p_order_id, 'new_status', v_new_status, 'message', v_message);
end;
$$;
