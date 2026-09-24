-- 1073: origem comercial separada do pagamento e da entrega.
-- DECISÃO: POS inclui mesa e client_sale_id (inclusive entregas feitas no POS).
create or replace function private.is_pos_order(p_channel text, p_client_sale_id uuid)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(p_channel in ('counter','dine_in'), false) or p_client_sale_id is not null;
$$;
revoke all on function private.is_pos_order(text,uuid) from public,anon;
grant execute on function private.is_pos_order(text,uuid) to authenticated,service_role;

create or replace view public.online_analytics_events with (security_invoker=true) as
select e.id,e.session_id,e.created_at,e.type,e.value_cents,e.store_id,
       e.channel,e.source,e.medium,e.campaign,e.utm
from public.analytics_events e
where coalesce(e.payload->>'origin','online') <> 'pos'
  and e.type not in ('upsell_view','upsell_accept')
  and coalesce(e.channel,'') not in ('balcao','counter','pos')
  and not exists (
    select 1 from public.orders o
    where o.id::text = coalesce(e.payload->>'order_id',e.payload->>'orderId')
      and private.is_pos_order(o.channel,o.client_sale_id)
  );
revoke all on public.online_analytics_events from public,anon;
grant select on public.online_analytics_events to authenticated,service_role;

create or replace view public.analytics_sessions
with (security_invoker = true)
as
with ev as (
  select e.id, e.session_id, e.created_at, e.type, e.value_cents, e.store_id,
         r.channel, r.source, r.medium, r.campaign
  from public.online_analytics_events e
  cross join lateral private.attr_resolve(e.channel, e.source, e.medium, e.campaign, e.utm) r
  where e.session_id is not null
    and e.session_id <> 'unknown'   -- eventos anteriores ao cookie de sessão
)
select
  session_id,
  min(created_at)                                                        as started_at,
  (array_agg(store_id order by created_at, id)
     filter (where store_id is not null))[1]                             as store_id,
  -- Primeiro toque da sessão: a origem do primeiro evento manda.
  (array_agg(channel  order by created_at, id))[1]                       as channel,
  (array_agg(source   order by created_at, id))[1]                       as source,
  (array_agg(medium   order by created_at, id))[1]                       as medium,
  (array_agg(campaign order by created_at, id))[1]                       as campaign,
  bool_or(type = 'view_menu')                                            as saw_menu,
  bool_or(type = 'add_to_cart')                                          as added_to_cart,
  bool_or(type = 'begin_checkout')                                       as began_checkout,
  bool_or(type = 'add_payment_info')                                     as added_payment,
  bool_or(type = 'purchase')                                             as purchased,
  coalesce(sum(value_cents) filter (where type = 'purchase'), 0)::bigint as revenue_cents
from ev
group by session_id;

revoke all on public.analytics_sessions from public, anon;
grant select on public.analytics_sessions to authenticated, service_role;


create or replace function public.get_attribution_report(
  p_from     timestamptz default null,
  p_to       timestamptz default null,
  p_store_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from timestamptz := coalesce(p_from, now() - interval '30 days');
  v_to   timestamptz := coalesce(p_to, now() + interval '1 day');
  v_result jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated' using errcode = 'P0020';
  end if;

  if p_store_id is null then
    if not private.auth_is_owner() then
      raise exception 'attribution_access_denied' using errcode = 'P0403';
    end if;
  elsif not private.auth_can_store(p_store_id) then
    raise exception 'attribution_access_denied' using errcode = 'P0403';
  end if;

  if private.auth_role() not in ('owner', 'manager') then
    raise exception 'attribution_access_denied' using errcode = 'P0403';
  end if;

  if v_to <= v_from then
    raise exception 'invalid_period' using errcode = 'P0007';
  end if;

  with money_orders as (
    select o.id, o.store_id, o.total_cents, o.channel as order_channel
    from public.orders o
    where not private.is_pos_order(o.channel, o.client_sale_id)
      and o.status in ('paid', 'approved', 'in_preparation', 'ready', 'delivered')
      and o.created_at >= v_from
      and o.created_at <  v_to
      and (p_store_id is null or o.store_id = p_store_id)
  ),
  attributed as (
    select
      m.id,
      m.total_cents,
      case when m.order_channel = 'counter' then 'balcao'
           else coalesce(a.channel, 'direct') end as channel,
      case when m.order_channel = 'counter' then 'balcao'
           else coalesce(a.source, 'direto') end as source,
      case when m.order_channel = 'counter' then 'balcao'
           else coalesce(a.medium, '(nenhum)') end as medium,
      a.campaign,
      case when m.order_channel = 'counter' then 'balcao'
           else coalesce(a.first_channel, a.channel, 'direct') end as first_channel,
      case when m.order_channel = 'counter' then 'balcao'
           else coalesce(a.first_source, a.source, 'direto') end as first_source
    from money_orders m
    left join public.order_attribution a on a.order_id = m.id
  ),
  sessions_by_channel as (
    select
      coalesce(nullif(e.channel, ''), 'direct') as channel,
      count(distinct e.session_id) as sessions
    from public.online_analytics_events e
    where e.created_at >= v_from
      and e.created_at <  v_to
      and e.session_id is not null
      and e.session_id <> 'unknown'
      and (p_store_id is null or e.store_id = p_store_id)
    group by 1
  ),
  orders_by_channel as (
    select channel,
           count(*)::int as orders,
           coalesce(sum(total_cents), 0)::bigint as revenue_cents
    from attributed
    group by 1
  ),
  by_channel as (
    select
      coalesce(o.channel, s.channel) as channel,
      coalesce(s.sessions, 0)::int   as sessions,
      coalesce(o.orders, 0)          as orders,
      coalesce(o.revenue_cents, 0)   as revenue_cents
    from orders_by_channel o
    full outer join sessions_by_channel s on s.channel = o.channel
  ),
  by_source as (
    select a.source, a.medium,
           count(*)::int as orders,
           coalesce(sum(a.total_cents), 0)::bigint as revenue_cents
    from attributed a
    group by 1, 2
  ),
  by_campaign as (
    select a.campaign, a.source, a.channel,
           count(*)::int as orders,
           coalesce(sum(a.total_cents), 0)::bigint as revenue_cents
    from attributed a
    where a.campaign is not null
    group by 1, 2, 3
  ),
  discovery as (
    select a.first_channel as channel,
           count(*)::int as orders,
           coalesce(sum(a.total_cents), 0)::bigint as revenue_cents
    from attributed a
    group by 1
  ),
  totals as (
    select
      count(*)::int as orders,
      coalesce(sum(total_cents), 0)::bigint as revenue_cents
    from attributed
  ),
  session_total as (
    select count(distinct e.session_id)::int as sessions
    from public.online_analytics_events e
    where e.created_at >= v_from
      and e.created_at <  v_to
      and e.session_id is not null
      and e.session_id <> 'unknown'
      and (p_store_id is null or e.store_id = p_store_id)
  )
  select jsonb_build_object(
    'period', jsonb_build_object('from', v_from, 'to', v_to),
    'totals', jsonb_build_object(
      'orders',        (select orders from totals),
      'revenue_cents', (select revenue_cents from totals),
      'sessions',      (select sessions from session_total)
    ),
    'by_channel', coalesce((
      select jsonb_agg(jsonb_build_object(
        'channel',       c.channel,
        'sessions',      c.sessions,
        'orders',        c.orders,
        'revenue_cents', c.revenue_cents,
        'conversion_pct', case when c.sessions > 0
                               then round(c.orders::numeric / c.sessions * 100, 1)
                               else null end
      ) order by c.revenue_cents desc, c.sessions desc)
      from by_channel c
    ), '[]'::jsonb),
    'by_source', coalesce((
      select jsonb_agg(jsonb_build_object(
        'source',        s.source,
        'medium',        s.medium,
        'orders',        s.orders,
        'revenue_cents', s.revenue_cents
      ) order by s.revenue_cents desc)
      from by_source s
    ), '[]'::jsonb),
    'by_campaign', coalesce((
      select jsonb_agg(jsonb_build_object(
        'campaign',      k.campaign,
        'source',        k.source,
        'channel',       k.channel,
        'orders',        k.orders,
        'revenue_cents', k.revenue_cents
      ) order by k.revenue_cents desc)
      from by_campaign k
    ), '[]'::jsonb),
    'discovery', coalesce((
      select jsonb_agg(jsonb_build_object(
        'channel',       d.channel,
        'orders',        d.orders,
        'revenue_cents', d.revenue_cents
      ) order by d.revenue_cents desc)
      from discovery d
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_attribution_report(timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.get_attribution_report(timestamptz, timestamptz, uuid) to authenticated;

create or replace function public.get_sales_metrics(
  p_period text default 'week',   -- 'day' | 'week' | 'month' | 'all'
  p_store_id uuid default null,
  p_origin text default 'all'
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_since        timestamptz;
  v_length       interval;
  v_prev_since   timestamptz;
  v_bucket_trunc text;
  v_confirmed    text[] := array['approved','paid','in_preparation','ready','delivered'];
begin
  if p_origin is null or p_origin not in ('all','online','pos') then
    raise exception 'invalid_origin' using errcode = 'P0007';
  end if;
  if (select auth.uid()) is null then
    raise exception 'not_authenticated' using errcode = 'P0020';
  end if;
  if private.auth_role() not in ('owner', 'manager') then
    raise exception 'dashboard_access_denied' using errcode = 'P0403';
  end if;
  if p_store_id is null then
    if not private.auth_is_owner() then
      raise exception 'dashboard_access_denied' using errcode = 'P0403';
    end if;
  else
    if not private.auth_can_store(p_store_id) then
      raise exception 'dashboard_access_denied' using errcode = 'P0403';
    end if;
  end if;

  v_length := case p_period
    when 'day'   then interval '1 day'
    when 'week'  then interval '7 days'
    when 'month' then interval '30 days'
    else null
  end;

  v_since := case p_period
    when 'day'   then now() - interval '1 day'
    when 'week'  then now() - interval '7 days'
    when 'month' then now() - interval '30 days'
    when 'all'   then '1970-01-01'::timestamptz
    else now() - interval '7 days'
  end;

  v_prev_since := case when v_length is null then null else v_since - v_length end;

  v_bucket_trunc := case p_period
    when 'day' then 'hour'
    else 'day'
  end;

  return jsonb_build_object(

    'store_id', p_store_id,

    'revenue_cents', (
      select coalesce(sum(total_cents), 0)
      from public.orders
      where status = any(v_confirmed)
        and created_at >= v_since
        and (p_store_id is null or store_id = p_store_id)
        and (p_origin = 'all' or (p_origin = 'pos') = private.is_pos_order(channel, client_sale_id))
    ),

    'avg_ticket_cents', (
      select coalesce(round(avg(total_cents)), 0)
      from public.orders
      where status = any(v_confirmed)
        and created_at >= v_since
        and (p_store_id is null or store_id = p_store_id)
        and (p_origin = 'all' or (p_origin = 'pos') = private.is_pos_order(channel, client_sale_id))
    ),

    'total_orders', (
      select count(*)
      from public.orders
      where status not in ('draft', 'cancelled')
        and created_at >= v_since
        and (p_store_id is null or store_id = p_store_id)
        and (p_origin = 'all' or (p_origin = 'pos') = private.is_pos_order(channel, client_sale_id))
    ),

    'previous', case when v_prev_since is null then null else (
      select jsonb_build_object(
        'revenue_cents', coalesce(sum(total_cents), 0),
        'total_orders', count(*)
      )
      from public.orders
      where status = any(v_confirmed)
        and created_at >= v_prev_since
        and created_at < v_since
        and (p_store_id is null or store_id = p_store_id)
        and (p_origin = 'all' or (p_origin = 'pos') = private.is_pos_order(channel, client_sale_id))
    ) end,

    'pickup_vs_delivery', (
      select coalesce(jsonb_agg(r order by r.fulfillment_type), '[]'::jsonb)
      from (
        select fulfillment_type, count(*) as count, sum(total_cents) as revenue_cents
        from public.orders
        where status = any(v_confirmed)
          and created_at >= v_since
          and (p_store_id is null or store_id = p_store_id)
        and (p_origin = 'all' or (p_origin = 'pos') = private.is_pos_order(channel, client_sale_id))
        group by fulfillment_type
      ) r
    ),

    'avg_time_minutes', (
      select round(avg(
        extract(epoch from (e_del.created_at - e_pay.created_at)) / 60.0
      )::numeric, 1)
      from public.event_log e_pay
      join public.event_log e_del
        on  e_del.order_id = e_pay.order_id
        and e_del.type    = 'order.deliver'
      join public.orders o on o.id = e_pay.order_id
      where e_pay.type = 'payment.confirmed'
        and e_pay.created_at >= v_since
        and (p_store_id is null or o.store_id = p_store_id)
        and (p_origin = 'all' or (p_origin = 'pos') = private.is_pos_order(o.channel, o.client_sale_id))
    ),

    'top_items', (
      select coalesce(jsonb_agg(r order by r.qty desc), '[]'::jsonb)
      from (
        select oi.name_snapshot as name, sum(oi.qty) as qty
        from public.order_items oi
        join public.orders o on o.id = oi.order_id
        where o.status = any(v_confirmed)
          and o.created_at >= v_since
          and (p_store_id is null or o.store_id = p_store_id)
        and (p_origin = 'all' or (p_origin = 'pos') = private.is_pos_order(o.channel, o.client_sale_id))
        group by oi.name_snapshot
        order by qty desc
        limit 10
      ) r
    ),

    'by_method', (
      select coalesce(jsonb_agg(r), '[]'::jsonb)
      from (
        select payment_method as method, sum(total_cents) as cents
        from public.orders
        where status = any(v_confirmed)
          and created_at >= v_since
          and (p_store_id is null or store_id = p_store_id)
        and (p_origin = 'all' or (p_origin = 'pos') = private.is_pos_order(channel, client_sale_id))
        group by payment_method
      ) r
    ),

    'hourly', (
      select coalesce(jsonb_agg(r order by r.hour), '[]'::jsonb)
      from (
        select extract(hour from created_at at time zone 'Africa/Maputo')::int as hour, count(*) as count
        from public.orders
        where status not in ('draft', 'cancelled')
          and created_at >= v_since
          and (p_store_id is null or store_id = p_store_id)
        and (p_origin = 'all' or (p_origin = 'pos') = private.is_pos_order(channel, client_sale_id))
        group by hour
      ) r
    ),

    -- Um cliente é o telefone, não o nome que escreveu daquela vez. Quem não
    -- deixou telefone (balcão sem identificação) continua agrupado por nome,
    -- como sempre — não há outra chave para esses.
    'top_customers', (
      select coalesce(jsonb_agg(r order by r.total_cents desc), '[]'::jsonb)
      from (
        select
          (array_agg(customer_name order by created_at desc) filter (where customer_name is not null))[1] as customer_name,
          max(customer_phone) as customer_phone,
          count(*) as order_count,
          sum(total_cents) as total_cents
        from public.orders
        where status = any(v_confirmed)
          and created_at >= v_since
          and customer_name is not null
          and (p_store_id is null or store_id = p_store_id)
        and (p_origin = 'all' or (p_origin = 'pos') = private.is_pos_order(channel, client_sale_id))
        group by coalesce(customer_phone, 'sem-telefone:' || customer_name)
        order by sum(total_cents) desc
        limit 10
      ) r
    ),

    'period_buckets', (
      select coalesce(jsonb_agg(r order by r.bucket), '[]'::jsonb)
      from (
        select
          date_trunc(v_bucket_trunc, created_at at time zone 'Africa/Maputo') at time zone 'Africa/Maputo' as bucket,
          sum(total_cents) as revenue_cents
        from public.orders
        where status = any(v_confirmed)
          and created_at >= v_since
          and (p_store_id is null or store_id = p_store_id)
        and (p_origin = 'all' or (p_origin = 'pos') = private.is_pos_order(channel, client_sale_id))
        group by bucket
      ) r
    )

  );
end;
$$;

revoke all on function public.get_sales_metrics(text,uuid,text) from public,anon;
grant execute on function public.get_sales_metrics(text,uuid,text) to authenticated;
-- Conserva a RPC antiga para os outros consumidores, sem sobrecargas ambíguas.
create or replace function public.get_dashboard_metrics(p_period text default 'week',p_store_id uuid default null)
returns jsonb language sql stable security invoker set search_path='' as $$
  select public.get_sales_metrics(p_period,p_store_id,'all');
$$;
notify pgrst, 'reload schema';
