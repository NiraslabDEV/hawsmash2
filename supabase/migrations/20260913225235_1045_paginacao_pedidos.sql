-- 1045: paginar as linhas antes do jsonb_agg, mantendo RLS e o contrato existente.
-- A versão anterior limitava a única linha agregada: offset > 0 devolvia vazio.
create or replace function public.get_orders(p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_search text := p_filters ->> 'search';
  v_limit int := greatest(1, least(coalesce((p_filters ->> 'limit')::int, 100), 500));
  v_offset int := greatest(coalesce((p_filters ->> 'offset')::int, 0), 0);
  v_store_slug text := nullif(p_filters ->> 'store', '');
  v_result jsonb;
begin
  -- Mesmo snapshot para a página e o total. Os itens só são lidos para a página.
  with filtered as materialized (
    select o.id, o.created_at
    from public.orders o
    left join public.stores s on s.id = o.store_id
    where
      (p_filters ->> 'status' is null or o.status = p_filters ->> 'status')
      and (p_filters -> 'statuses' is null or (p_filters -> 'statuses') ? o.status)
      and (p_filters ->> 'flow' is null or o.flow = p_filters ->> 'flow')
      and (p_filters ->> 'fulfillment_type' is null or o.fulfillment_type = p_filters ->> 'fulfillment_type')
      and (p_filters ->> 'channel' is null or o.channel = p_filters ->> 'channel')
      and (v_store_slug is null or s.slug = v_store_slug)
      and (p_filters ->> 'date_from' is null or o.created_at >= (p_filters ->> 'date_from')::timestamptz)
      and (p_filters ->> 'date_to' is null or o.created_at <= (p_filters ->> 'date_to')::timestamptz)
      and (v_search is null or length(v_search) = 0
        or o.order_number ilike '%' || v_search || '%'
        or o.customer_name ilike '%' || v_search || '%'
        or o.customer_phone ilike '%' || v_search || '%')
  ), page as (
    select f.id, f.created_at
    from filtered f
    order by f.created_at desc, f.id desc
    limit v_limit offset v_offset
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered),
    'limit', v_limit,
    'offset', v_offset,
    'orders', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', o.id,
        'store_id', o.store_id,
        'store_slug', s.slug,
        'store_name', s.short_name,
        'order_number', o.order_number,
        'daily_number', o.daily_number,
        'channel', o.channel,
        'status', o.status,
        'flow', o.flow,
        'fulfillment_type', o.fulfillment_type,
        'delivery_zone_id', o.delivery_zone_id,
        'address', o.address,
        'customer_name', o.customer_name,
        'customer_phone', o.customer_phone,
        'customer_email', o.customer_email,
        'scheduled_for', o.scheduled_for,
        'subtotal_cents', o.subtotal_cents,
        'delivery_fee_cents', o.delivery_fee_cents,
        'total_cents', o.total_cents,
        'payment_method', o.payment_method,
        'payment_proof_path', o.payment_proof_path,
        'needs_review', o.needs_review,
        'notes', o.notes,
        'created_at', o.created_at,
        'updated_at', o.updated_at,
        'items', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'id', oi.id,
            'menu_item_id', oi.menu_item_id,
            'name', oi.name_snapshot,
            'qty', oi.qty,
            'unit_price_cents', oi.unit_price_cents,
            'station', oi.station,
            'notes', oi.notes
          ) order by oi.id), '[]'::jsonb)
          from public.order_items oi
          where oi.order_id = o.id and oi.store_id = o.store_id
        )
      ) order by o.created_at desc, o.id desc), '[]'::jsonb)
      from page p
      join public.orders o on o.id = p.id
      left join public.stores s on s.id = o.store_id
    )
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function public.get_orders(jsonb) from public, anon;
grant execute on function public.get_orders(jsonb) to authenticated, service_role;
