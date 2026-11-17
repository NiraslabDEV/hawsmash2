-- 1139: motivo da gerência na NC. Definições integrais; só acrescenta set_config antes do reembolso.

-- Origem: 20260819231000_f6_stock_consumption.sql
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

  perform set_config('app.fiscal_reason', left(v_reason, 200), true);

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

-- Origem: 20260930200000_1112_anular_pedido_entregue.sql
create or replace function public.void_delivered_order(p_order_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_reason text := btrim(coalesce(p_reason, ''));
  v_order public.orders%rowtype;
  v_restored integer := 0;
  v_refunded integer := 0;
  v_refunded_cents bigint := 0;
  v_shift_closed boolean := false;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0020';
  end if;
  if coalesce(private.auth_role(), '') <> 'owner' then
    raise exception 'void_access_denied' using errcode = 'P0403';
  end if;
  if length(v_reason) < 3 or length(v_reason) > 500 then
    raise exception 'void_reason_required' using errcode = 'P0007';
  end if;

  select o.* into v_order
  from public.orders o
  where o.id = p_order_id
  for update;
  if not found or not private.auth_can_store(v_order.store_id) then
    raise exception 'order_not_found' using errcode = 'P0404';
  end if;

  if v_order.status = 'cancelled' then
    return jsonb_build_object('order_id', v_order.id, 'status', 'cancelled', 'duplicate', true);
  end if;
  if v_order.status <> 'delivered' then
    raise exception 'order_not_delivered' using errcode = 'P0409';
  end if;

  perform set_config('app.request_store_id', v_order.store_id::text, true);

  v_restored := coalesce(private.restore_order_stock(v_order.id), 0);

  update public.orders
  set status = 'cancelled', updated_at = now()
  where id = v_order.id and store_id = v_order.store_id and status = 'delivered';

  select count(*)::integer, coalesce(sum(p.amount_cents), 0)
  into v_refunded, v_refunded_cents
  from public.payments p
  where p.order_id = v_order.id and p.store_id = v_order.store_id and p.status = 'confirmed';

  perform set_config('app.fiscal_reason', left(v_reason, 200), true);

  update public.payments
  set status = 'refunded'
  where order_id = v_order.id and store_id = v_order.store_id and status = 'confirmed';

  -- O cliente já comeu: nada de "o seu pedido foi cancelado".
  begin
    update public.email_jobs
    set status = 'cancelled', error = 'Pedido entregue anulado pelo dono: sem email ao cliente.'
    where store_id = v_order.store_id
      and event_key = v_order.id::text || ':cancelled'
      and status = 'queued';
  exception when others then
    null;
  end;

  select exists (
    select 1
    from public.cash_sessions cs
    where cs.store_id = v_order.store_id
      and cs.closed_at is not null
      and v_order.created_at >= coalesce((cs.report ->> 'period_start')::timestamptz, cs.opened_at)
      and v_order.created_at < cs.closed_at
  ) into v_shift_closed;

  insert into public.event_log (store_id, order_id, actor_user_id, type, payload)
  values (
    v_order.store_id,
    v_order.id,
    v_uid,
    'order.voided',
    jsonb_build_object(
      'reason', v_reason,
      'previous_status', v_order.status,
      'new_status', 'cancelled',
      'order_number', v_order.order_number,
      'total_cents', v_order.total_cents,
      'restored_qty', v_restored,
      'refunded_payments', v_refunded,
      'refunded_cents', v_refunded_cents,
      'shift_closed', v_shift_closed
    )
  );

  return jsonb_build_object(
    'order_id', v_order.id,
    'status', 'cancelled',
    'restored_qty', v_restored,
    'refunded_cents', v_refunded_cents,
    'shift_closed', v_shift_closed,
    'duplicate', false
  );
end;
$$;

notify pgrst, 'reload schema';
