-- HAWSMASH 2.0 — 1123: as métricas dos garçons.
--
-- Pedido do dono (05 Nov): o garçom passa a ter um módulo próprio no painel, com
-- "todas as métricas": quem tirou mais pedidos, quem vendeu mais, e por aí fora.
--
-- Uma só leitura, `get_waiter_metrics`, para o ranking, os totais da equipa e o
-- detalhe de um garçom (`p_waiter_id`). Sem escrita, sem colunas novas: sai tudo
-- de `orders`, `order_items` e `event_log`.
--
-- O que cada número quer dizer, para não haver duas contas:
--   venda        pedidos lançados pelo garçom em preparo, prontos ou entregues.
--                Cancelado não é venda: conta à parte. `total_cents` já desce
--                quando se retira um artigo (1102).
--   mesas        mesas diferentes por dia: a mesa 5 de ontem e a de hoje são duas.
--   extras       o que os extras (menu_addons) somaram, ao preço gravado na linha.
--   servidos     quem levou à mesa (`table.order_served`), mesmo que outro tenha
--                lançado. É o único número que não vem de quem lançou o pedido.
--   minutos      mediana entre lançar e entregar. Mediana, não média: um pedido
--                marcado como entregue só no fim do turno não estraga o número.
--   pago/aberto  com ou sem `table_bill_id`. O garçom não recebe dinheiro: isto é
--                a venda dele que o caixa já cobrou, não dinheiro na mão dele.
--
-- O período é [p_from, p_to[, e dias e horas contam no fuso de Maputo.
--
-- Só o gerente da loja e o dono: são valores de venda. "Todas as lojas"
-- (p_store_id null) é só do dono. Forward-only e idempotente.

-- `event_log` não tinha índice por pedido, e esta leitura pergunta por pedido.
-- Parcial: só os três tipos que aqui interessam.
create index if not exists event_log_order_metricas_idx
  on public.event_log (order_id, type, created_at)
  where type in ('order.deliver', 'table.item_removed', 'table.order_served');

create or replace function public.get_waiter_metrics(
  p_store_id uuid,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_waiter_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from timestamptz := coalesce(p_from, '-infinity'::timestamptz);
  v_to timestamptz := coalesce(p_to, 'infinity'::timestamptz);
  v_result jsonb;
begin
  if p_store_id is null then
    if (select auth.uid()) is null then
      raise exception 'not_authenticated' using errcode = 'P0020';
    end if;
    if not coalesce(private.auth_is_owner(), false) then
      raise exception 'waiter_access_denied' using errcode = 'P0403';
    end if;
  else
    perform private.assert_waiter_admin(p_store_id);
  end if;

  with equipa as (
    select w.id, w.store_id, w.full_name, w.active
    from public.waiters w
    where (p_store_id is null or w.store_id = p_store_id)
      and (p_waiter_id is null or w.id = p_waiter_id)
  ),
  lancados as (
    select o.id, o.waiter_id, o.table_id, o.status, o.total_cents, o.table_bill_id, o.created_at,
      (o.created_at at time zone 'Africa/Maputo') as local_at
    from public.orders o
    join equipa e on e.id = o.waiter_id
    where o.created_at >= v_from and o.created_at < v_to
  ),
  vendas as (
    select * from lancados where status in ('in_preparation', 'ready', 'delivered')
  ),
  linhas as (
    select v.waiter_id, oi.qty, oi.unit_price_cents, oi.name_snapshot, oi.variant_name_snapshot,
      oi.qty * coalesce((
        select sum((a.value ->> 'price_cents')::integer)
        from jsonb_array_elements(case when jsonb_typeof(oi.addons) = 'array' then oi.addons else '[]'::jsonb end) a
      ), 0) as extras_cents
    from vendas v
    join public.order_items oi on oi.order_id = v.id
  ),
  por_venda as (
    select v.waiter_id,
      count(*)::integer as orders,
      coalesce(sum(v.total_cents), 0)::bigint as revenue_cents,
      coalesce(sum(v.total_cents) filter (where v.table_bill_id is not null), 0)::bigint as paid_cents,
      coalesce(sum(v.total_cents) filter (where v.table_bill_id is null), 0)::bigint as open_cents,
      count(distinct (v.table_id, v.local_at::date))::integer as tables,
      count(distinct v.local_at::date)::integer as active_days,
      max(v.created_at) as last_order_at
    from vendas v
    group by v.waiter_id
  ),
  por_linha as (
    select l.waiter_id,
      coalesce(sum(l.qty), 0)::integer as items,
      coalesce(sum(l.extras_cents), 0)::bigint as extras_cents
    from linhas l
    group by l.waiter_id
  ),
  cancelados as (
    select l.waiter_id, count(*)::integer as cancelled_orders
    from lancados l
    where l.status = 'cancelled'
    group by l.waiter_id
  ),
  retirados as (
    select l.waiter_id,
      count(*)::integer as removed_events,
      coalesce(sum((ev.payload ->> 'removed_cents')::integer), 0)::bigint as removed_cents
    from lancados l
    join public.event_log ev on ev.order_id = l.id and ev.type = 'table.item_removed'
    group by l.waiter_id
  ),
  entregas as (
    select v.waiter_id,
      percentile_cont(0.5) within group (
        order by extract(epoch from (d.delivered_at - v.created_at)) / 60.0
      ) as median_minutes
    from vendas v
    cross join lateral (
      select min(ev.created_at) as delivered_at
      from public.event_log ev
      where ev.order_id = v.id and ev.type = 'order.deliver'
    ) d
    where d.delivered_at is not null
    group by v.waiter_id
  ),
  -- Servidos conta na data em que se serviu, e para quem serviu.
  servidos as (
    select (ev.payload ->> 'waiter_id')::uuid as waiter_id, count(*)::integer as served
    from public.event_log ev
    join public.orders o on o.id = ev.order_id
    where ev.type = 'table.order_served'
      and ev.created_at >= v_from and ev.created_at < v_to
      and (p_store_id is null or o.store_id = p_store_id)
    group by 1
  ),
  ranking as (
    select e.id, e.full_name, e.active,
      s.short_name as store_short_name,
      coalesce(pv.orders, 0) as orders,
      coalesce(pv.revenue_cents, 0) as revenue_cents,
      case when coalesce(pv.orders, 0) > 0 then round(pv.revenue_cents::numeric / pv.orders)::bigint else 0 end as avg_ticket_cents,
      coalesce(pl.items, 0) as items,
      coalesce(pv.tables, 0) as tables,
      coalesce(pv.active_days, 0) as active_days,
      coalesce(pl.extras_cents, 0) as extras_cents,
      coalesce(sv.served, 0) as served,
      round(en.median_minutes::numeric, 1) as median_minutes_to_serve,
      coalesce(c.cancelled_orders, 0) as cancelled_orders,
      coalesce(r.removed_events, 0) as removed_events,
      coalesce(r.removed_cents, 0) as removed_cents,
      coalesce(pv.paid_cents, 0) as paid_cents,
      coalesce(pv.open_cents, 0) as open_cents,
      pv.last_order_at
    from equipa e
    join public.stores s on s.id = e.store_id
    left join por_venda pv on pv.waiter_id = e.id
    left join por_linha pl on pl.waiter_id = e.id
    left join cancelados c on c.waiter_id = e.id
    left join retirados r on r.waiter_id = e.id
    left join entregas en on en.waiter_id = e.id
    left join servidos sv on sv.waiter_id = e.id
    -- Um garçom desactivado só aparece se fez alguma coisa neste período.
    where e.active or pv.orders is not null or c.cancelled_orders is not null or sv.served is not null
  )
  select jsonb_build_object(
    'waiters', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.orders desc, r.revenue_cents desc, r.full_name) from ranking r
    ), '[]'::jsonb),
    'totals', (
      select jsonb_build_object(
        'orders', coalesce(sum(r.orders), 0),
        'revenue_cents', coalesce(sum(r.revenue_cents), 0),
        'avg_ticket_cents', case when coalesce(sum(r.orders), 0) > 0
          then round(sum(r.revenue_cents)::numeric / sum(r.orders))::bigint else 0 end,
        'items', coalesce(sum(r.items), 0),
        'tables', coalesce(sum(r.tables), 0),
        'extras_cents', coalesce(sum(r.extras_cents), 0),
        'cancelled_orders', coalesce(sum(r.cancelled_orders), 0),
        'removed_cents', coalesce(sum(r.removed_cents), 0),
        'paid_cents', coalesce(sum(r.paid_cents), 0),
        'open_cents', coalesce(sum(r.open_cents), 0)
      )
      from ranking r
    ),
    'by_day', coalesce((
      select jsonb_agg(jsonb_build_object('day', d.day, 'orders', d.orders, 'revenue_cents', d.revenue_cents) order by d.day)
      from (
        select to_char(v.local_at, 'YYYY-MM-DD') as day, count(*)::integer as orders, sum(v.total_cents)::bigint as revenue_cents
        from vendas v group by 1
      ) d
    ), '[]'::jsonb),
    'by_hour', coalesce((
      select jsonb_agg(jsonb_build_object('hour', h.hour, 'orders', h.orders) order by h.hour)
      from (
        select extract(hour from v.local_at)::integer as hour, count(*)::integer as orders
        from vendas v group by 1
      ) h
    ), '[]'::jsonb),
    'top_items', coalesce((
      select jsonb_agg(jsonb_build_object('name', t.name, 'qty', t.qty, 'revenue_cents', t.revenue_cents)
        order by t.qty desc, t.revenue_cents desc, t.name)
      from (
        select
          case when l.variant_name_snapshot is null
              or position(lower(l.variant_name_snapshot) in lower(l.name_snapshot)) > 0
            then l.name_snapshot
            else l.name_snapshot || ' ' || l.variant_name_snapshot end as name,
          sum(l.qty)::integer as qty,
          sum(l.qty * l.unit_price_cents)::bigint as revenue_cents
        from linhas l group by 1
        order by 2 desc, 3 desc, 1
        limit 10
      ) t
    ), '[]'::jsonb),
    -- Quanto da sala passa pelos garçons. Nunca filtrado por garçom: é a loja.
    'table_origin', (
      select jsonb_build_object(
        'waiter', jsonb_build_object(
          'orders', count(*) filter (where o.waiter_id is not null),
          'revenue_cents', coalesce(sum(o.total_cents) filter (where o.waiter_id is not null), 0)),
        'counter', jsonb_build_object(
          'orders', count(*) filter (where o.waiter_id is null and o.client_sale_id is not null),
          'revenue_cents', coalesce(sum(o.total_cents) filter (where o.waiter_id is null and o.client_sale_id is not null), 0)),
        'qr', jsonb_build_object(
          'orders', count(*) filter (where o.waiter_id is null and o.client_sale_id is null),
          'revenue_cents', coalesce(sum(o.total_cents) filter (where o.waiter_id is null and o.client_sale_id is null), 0))
      )
      from public.orders o
      where o.table_id is not null
        and o.fulfillment_type = 'dine_in'
        and o.status in ('in_preparation', 'ready', 'delivered')
        and o.created_at >= v_from and o.created_at < v_to
        and (p_store_id is null or o.store_id = p_store_id)
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_waiter_metrics(uuid, timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.get_waiter_metrics(uuid, timestamptz, timestamptz, uuid) to authenticated;

notify pgrst, 'reload schema';
