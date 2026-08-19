-- HAWSMASH 2.0 — F7: o pedido diz sempre de que loja é.
--
-- Sem isto, o cliente que encomenda na Matola recebe um email igual ao de
-- Maputo e o painel consolidado não distingue as duas unidades.

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
  select o.id, o.order_number, o.status, o.flow, o.fulfillment_type,
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

-- get_orders: cada linha passa a dizer a loja, e o painel pode filtrar por ela.
create or replace function public.get_orders(p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_search text;
  v_limit int;
  v_offset int;
  v_store_slug text;
  v_result jsonb;
  v_count int;
begin
  v_search := p_filters ->> 'search';
  v_limit := least(coalesce((p_filters ->> 'limit')::int, 100), 500);
  v_offset := greatest(coalesce((p_filters ->> 'offset')::int, 0), 0);
  v_store_slug := nullif(p_filters ->> 'store', '');

  select
    count(*) over ()::int,
    coalesce(jsonb_agg(
      jsonb_build_object(
        'id',                 o.id,
        'store_id',           o.store_id,
        'store_slug',         s.slug,
        'store_name',         s.short_name,
        'order_number',       o.order_number,
        'daily_number',       o.daily_number,
        'channel',            o.channel,
        'status',             o.status,
        'flow',               o.flow,
        'fulfillment_type',   o.fulfillment_type,
        'delivery_zone_id',   o.delivery_zone_id,
        'address',            o.address,
        'customer_name',      o.customer_name,
        'customer_phone',     o.customer_phone,
        'customer_email',     o.customer_email,
        'scheduled_for',      o.scheduled_for,
        'subtotal_cents',     o.subtotal_cents,
        'delivery_fee_cents', o.delivery_fee_cents,
        'total_cents',        o.total_cents,
        'payment_method',     o.payment_method,
        'payment_proof_path', o.payment_proof_path,
        'needs_review',       o.needs_review,
        'notes',              o.notes,
        'created_at',         o.created_at,
        'updated_at',         o.updated_at,
        'items', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'id',              oi.id,
            'menu_item_id',    oi.menu_item_id,
            'name',            oi.name_snapshot,
            'qty',             oi.qty,
            'unit_price_cents',oi.unit_price_cents,
            'station',         oi.station,
            'notes',           oi.notes
          )), '[]'::jsonb)
          from public.order_items oi where oi.order_id = o.id
        )
      ) order by o.created_at desc
    ), '[]'::jsonb)
  into v_count, v_result
  from public.orders o
  left join public.stores s on s.id = o.store_id
  where
    (p_filters ->> 'status' is null or o.status = p_filters ->> 'status')
    and (p_filters ->> 'flow' is null or o.flow = p_filters ->> 'flow')
    and (p_filters ->> 'fulfillment_type' is null
         or o.fulfillment_type = p_filters ->> 'fulfillment_type')
    and (v_store_slug is null or s.slug = v_store_slug)
    and (p_filters ->> 'date_from' is null
         or o.created_at >= (p_filters ->> 'date_from')::timestamptz)
    and (p_filters ->> 'date_to' is null
         or o.created_at <= (p_filters ->> 'date_to')::timestamptz)
    and (v_search is null or length(v_search) = 0
         or o.order_number ilike '%' || v_search || '%'
         or o.customer_name ilike '%' || v_search || '%'
         or o.customer_phone ilike '%' || v_search || '%')
  limit v_limit
  offset v_offset;

  return jsonb_build_object(
    'orders', coalesce(v_result, '[]'::jsonb),
    'total', coalesce(v_count, 0),
    'limit', v_limit,
    'offset', v_offset
  );
end;
$$;

revoke all on function public.get_orders(jsonb) from public, anon;
grant execute on function public.get_orders(jsonb) to authenticated, service_role;
