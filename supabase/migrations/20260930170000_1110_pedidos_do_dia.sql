-- 1110: a lista de pedidos do painel mostra só o dia em curso.
--
-- Pedido do dono (30/09): na página de pedidos ficam só os do dia; quando se
-- fecha o dia, somem dali e passam a ver-se num filtro próprio (Histórico).
--
-- O dia acaba no fecho do dia da loja (1091), nunca à meia-noite (CLAUDE §9):
-- `day = 'current'` devolve os pedidos criados depois do último fecho do dia
-- da loja de cada pedido. Loja que nunca fechou o dia conta desde a meia-noite
-- de Maputo, para não despejar o histórico inteiro no ecrã do dia.
--
-- A resposta passa a trazer `status_counts`: quantos pedidos há em cada estado
-- com os mesmos filtros da lista, menos o do estado. Os números das abas batem
-- com a lista em vez de contarem desde sempre, e todas as lojas.
--
-- Tudo o resto do contrato da 1045 fica igual: RLS por SECURITY INVOKER,
-- paginação antes da agregação, total do mesmo snapshot.
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
  v_current_day boolean := coalesce(p_filters ->> 'day', '') = 'current';
  v_midnight timestamptz :=
    date_trunc('day', now() at time zone 'Africa/Maputo') at time zone 'Africa/Maputo';
  v_result jsonb;
begin
  -- Mesmo snapshot para a página, o total e as contagens. Os itens só são
  -- lidos para a página.
  with day_start as materialized (
    -- A RLS de cash_day_closes deixa ler só as lojas de quem pergunta; sem
    -- linha, a loja conta desde a meia-noite.
    select c.store_id, max(c.closed_at) as started_at
    from public.cash_day_closes c
    where v_current_day
    group by c.store_id
  ), base as materialized (
    select o.id, o.created_at, o.status
    from public.orders o
    left join public.stores s on s.id = o.store_id
    left join day_start d on d.store_id = o.store_id
    where
      (p_filters ->> 'flow' is null or o.flow = p_filters ->> 'flow')
      and (p_filters ->> 'fulfillment_type' is null or o.fulfillment_type = p_filters ->> 'fulfillment_type')
      and (p_filters ->> 'channel' is null or o.channel = p_filters ->> 'channel')
      and (v_store_slug is null or s.slug = v_store_slug)
      and (not v_current_day or o.created_at >= coalesce(d.started_at, v_midnight))
      and (p_filters ->> 'date_from' is null or o.created_at >= (p_filters ->> 'date_from')::timestamptz)
      and (p_filters ->> 'date_to' is null or o.created_at <= (p_filters ->> 'date_to')::timestamptz)
      and (v_search is null or length(v_search) = 0
        or o.order_number ilike '%' || v_search || '%'
        or o.customer_name ilike '%' || v_search || '%'
        or o.customer_phone ilike '%' || v_search || '%')
  ), filtered as materialized (
    select b.id, b.created_at
    from base b
    where
      (p_filters ->> 'status' is null or b.status = p_filters ->> 'status')
      and (p_filters -> 'statuses' is null or (p_filters -> 'statuses') ? b.status)
  ), page as (
    select f.id, f.created_at
    from filtered f
    order by f.created_at desc, f.id desc
    limit v_limit offset v_offset
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered),
    'status_counts', (
      select coalesce(jsonb_object_agg(x.status, x.n), '{}'::jsonb)
      from (select b.status, count(*) as n from base b group by b.status) x
    ),
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
