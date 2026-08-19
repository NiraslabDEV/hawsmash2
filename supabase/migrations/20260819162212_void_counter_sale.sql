-- HAWSMASH 2.0 — F2: anulação auditável de uma venda de balcão.

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

  -- A transição fica centralizada em advance_order; a reposição abaixo faz
  -- parte da mesma transacção e, portanto, reverte se qualquer passo falhar.
  perform public.advance_order(v_order.id, 'CANCEL', v_reason);

  with restored as (
    update public.store_items si
    set stock_qty = si.stock_qty + oi.qty
    from public.order_items oi
    where oi.order_id = v_order.id
      and oi.store_id = v_order.store_id
      and oi.menu_item_id = si.menu_item_id
      and si.store_id = v_order.store_id
      and si.track_stock
    returning oi.qty
  )
  select coalesce(sum(qty), 0)::integer
  into v_restored
  from restored;

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

revoke all on function public.void_sale(uuid, text)
  from public, anon;
grant execute on function public.void_sale(uuid, text)
  to authenticated;
