-- 1036 — corrige a 1032.
--
-- A 1032 reescreveu `get_order_status` para devolver a senha do dia e trocou
-- duas coisas por engano no caminho:
--
--   1. `order by oi.created_at` — `order_items` não tem essa coluna. A função
--      passou a rebentar com "column oi.created_at does not exist" em TODOS
--      os pedidos: a página de acompanhamento deixou de abrir. Volta a ser
--      `order by oi.id`, como estava.
--   2. Pedido inexistente passou a devolver null em vez de levantar
--      `order_not_found`. O cliente acabava no mesmo sítio, mas a rota deixou
--      de responder 404. Volta o `raise`.
--
-- Apanhado no staging, antes de qualquer cliente ver. A senha (`daily_number`)
-- fica, que era o ponto da 1032.

create or replace function public.get_order_status(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_order record;
  v_items jsonb;
begin
  select o.id, o.order_number, o.daily_number, o.status, o.flow, o.fulfillment_type,
         o.scheduled_for, o.total_cents, o.payment_method, o.created_at,
         s.slug as store_slug, s.short_name as store_name, s.address as store_address,
         s.phone as store_phone, s.maps_url as store_maps_url
  into v_order
  from public.orders o
  left join public.stores s on s.id = o.store_id
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
  from public.order_items oi
  where oi.order_id = p_order_id;

  return jsonb_build_object(
    'id',               v_order.id,
    'order_number',     v_order.order_number,
    -- A senha do dia: null nos pedidos antigos, que caem no order_number.
    'daily_number',     v_order.daily_number,
    'status',           v_order.status,
    'flow',             v_order.flow,
    'fulfillment_type', v_order.fulfillment_type,
    'scheduled_for',    v_order.scheduled_for,
    'total_cents',      v_order.total_cents,
    'payment_method',   v_order.payment_method,
    'created_at',       v_order.created_at,
    'order_items',      v_items,
    'store', jsonb_build_object(
      'slug',       v_order.store_slug,
      'short_name', v_order.store_name,
      'address',    v_order.store_address,
      'phone',      v_order.store_phone,
      'maps_url',   v_order.store_maps_url
    )
  );
end;
$$;

revoke all on function public.get_order_status(uuid) from public;
grant execute on function public.get_order_status(uuid) to anon, authenticated, service_role;
