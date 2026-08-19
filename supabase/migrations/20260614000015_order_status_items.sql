-- F4.3 (CLAUDE.md 16.5): get_order_status passa a devolver order_items para
-- preencher GA4 items[] e Meta contents[] no evento purchase do /order-status.
-- Aditiva: redefine a função (create or replace) preservando os campos anteriores.

create or replace function public.get_order_status(p_order_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_order record;
  v_items jsonb;
begin
  select o.id, o.order_number, o.status, o.flow, o.fulfillment_type,
         o.scheduled_for, o.total_cents, o.payment_method, o.created_at
  into v_order
  from orders o
  where o.id = p_order_id;

  if not found then
    raise exception 'order_not_found' using errcode = 'P0001';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'menu_item_id',     oi.menu_item_id,
        'name_snapshot',    oi.name_snapshot,
        'qty',              oi.qty,
        'unit_price_cents', oi.unit_price_cents
      ) order by oi.id
    ),
    '[]'::jsonb
  )
  into v_items
  from order_items oi
  where oi.order_id = p_order_id;

  return jsonb_build_object(
    'id',               v_order.id,
    'order_number',     v_order.order_number,
    'status',           v_order.status,
    'flow',             v_order.flow,
    'fulfillment_type', v_order.fulfillment_type,
    'scheduled_for',    v_order.scheduled_for,
    'total_cents',      v_order.total_cents,
    'payment_method',   v_order.payment_method,
    'created_at',       v_order.created_at,
    'order_items',      v_items
  );
end;
$$;

grant execute on function public.get_order_status(uuid) to anon;
