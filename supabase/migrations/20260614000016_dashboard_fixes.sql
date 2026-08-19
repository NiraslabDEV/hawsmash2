-- ============================================================================
-- DELIVERY OS — Correções de métricas dos painéis (bugfix)
-- Ref: CLAUDE.md secções 5 (estados), 8 (painel), 14
--
-- Problema: vários painéis só contavam pedidos 'delivered', mas no fluxo manual
-- um pedido vira venda real assim que o dono APROVA (approved) ou o Paysuite
-- confirma (paid). Pedidos aprovados ficavam invisíveis em Ativos/Caixa/Análise.
--
-- Decisão (fechada aqui): "venda confirmada" = status in
--   ('approved','paid','in_preparation','ready','delivered').
-- Métricas específicas de entrega (tempo médio, nº entregues) continuam em 'delivered'.
-- ============================================================================

-- ============================================================================
-- 1) get_order_stats(): "Ativos" passa a contar pedidos em curso (approved/paid
--    /in_preparation/ready), não apenas in_preparation+. Faturado mantém-se no
--    conjunto confirmado.
-- ============================================================================

create or replace function public.get_order_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_total_faturado    int := 0;
  v_ativos            int := 0;
  v_aguarda_pagamento int := 0;
  v_em_preparo        int := 0;
  v_prontos           int := 0;
begin
  select coalesce(sum(o.total_cents), 0) into v_total_faturado
  from orders o
  where o.status in ('approved','paid','in_preparation','ready','delivered');

  -- Ativos = pedidos confirmados ainda em curso (exclui entregues e cancelados)
  select count(*) into v_ativos
  from orders o
  where o.status in ('approved','paid','in_preparation','ready');

  select count(*) into v_aguarda_pagamento
  from orders o
  where o.status = 'awaiting_approval';

  select count(*) into v_em_preparo
  from orders o
  where o.status = 'in_preparation';

  select count(*) into v_prontos
  from orders o
  where o.status = 'ready';

  return jsonb_build_object(
    'total_faturado',       v_total_faturado,
    'ativos',               v_ativos,
    'aguarda_pagamento',    v_aguarda_pagamento,
    'em_preparo',           v_em_preparo,
    'prontos',              v_prontos
  );
end;
$$;

grant execute on function public.get_order_stats() to authenticated;

-- ============================================================================
-- 2) get_cash_dashboard(): período = desde o último fecho de caixa (ou sessão
--    aberta), não desde a meia-noite UTC. Assim os pedidos acumulam até ao
--    primeiro fecho e não "desaparecem" à meia-noite.
--    (única alteração face à versão anterior: cálculo de v_period_start)
-- ============================================================================

create or replace function public.get_cash_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid            uuid;
  v_open_session   record;
  v_last_close     timestamptz;
  v_period_start   timestamptz;
  v_now            timestamptz := now();
  v_has_open       bool := false;
  v_total_pedidos  int := 0;
  v_total_faturado int := 0;
  v_entregues      int := 0;
  v_em_aberto_cts  int := 0;
  v_items_hoje     jsonb;
  v_historico      jsonb;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0020';
  end if;

  -- Sessão aberta?
  select * into v_open_session from cash_sessions where closed_at is null limit 1;
  v_has_open := found;

  -- Período: sessão aberta → desde a abertura; senão → desde o último fecho;
  -- se nunca houve fecho → desde o início (todos os pedidos confirmados).
  if v_has_open then
    v_period_start := v_open_session.opened_at;
  else
    select max(closed_at) into v_last_close from cash_sessions where closed_at is not null;
    v_period_start := coalesce(v_last_close, '1970-01-01'::timestamptz);
  end if;

  -- Stats de pedidos confirmados no período
  select
    count(*)::int,
    coalesce(sum(o.total_cents), 0)::int,
    count(*) filter (where o.status = 'delivered')::int
  into v_total_pedidos, v_total_faturado, v_entregues
  from _confirmed_orders_in_period(v_period_start, v_now) o;

  -- Pedidos activos (confirmados mas não entregues) → faturação "em aberto"
  select coalesce(sum(o.total_cents), 0)::int into v_em_aberto_cts
  from _confirmed_orders_in_period(v_period_start, v_now) o
  where o.status in ('approved','paid','in_preparation','ready');

  -- Itens vendidos no período
  select coalesce(jsonb_agg(
    jsonb_build_object('name', iv.name, 'qty', iv.qty, 'total_cents', iv.total_cents)
    order by iv.total_cents desc
  ), '[]') into v_items_hoje
  from (
    select oi.name_snapshot                        as name,
           sum(oi.qty)::int                        as qty,
           sum(oi.qty * oi.unit_price_cents)::int  as total_cents
    from order_items oi
    join orders o on o.id = oi.order_id
    where o.created_at >= v_period_start
      and o.created_at <  v_now
      and o.status in ('approved','paid','in_preparation','ready','delivered')
    group by oi.name_snapshot
  ) iv;

  -- Histórico dos últimos 10 fechos
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id',                   cs.id,
      'opened_at',            cs.opened_at,
      'closed_at',            cs.closed_at,
      'expected_cash_cents',  cs.expected_cash_cents,
      'counted_cash_cents',   cs.counted_cash_cents,
      'difference_cents',     cs.difference_cents,
      'notes',                cs.notes
    ) order by cs.closed_at desc
  ), '[]') into v_historico
  from (
    select * from cash_sessions
    where closed_at is not null
    order by closed_at desc
    limit 10
  ) cs;

  return jsonb_build_object(
    'has_open_session',   v_has_open,
    'open_session',       case when v_has_open
                            then jsonb_build_object('id', v_open_session.id, 'opened_at', v_open_session.opened_at)
                            else null end,
    'period_start',       v_period_start,
    'stats', jsonb_build_object(
      'total_pedidos',        v_total_pedidos,
      'total_faturado_cents', v_total_faturado,
      'total_entregues',      v_entregues,
      'em_aberto_cents',      v_em_aberto_cts
    ),
    'items_hoje',         v_items_hoje,
    'historico',          v_historico
  );
end;
$$;

grant execute on function public.get_cash_dashboard() to authenticated;

-- ============================================================================
-- 3) get_dashboard_metrics(): faturação, ticket médio, top itens, top clientes,
--    split entrega/levantamento, método e série temporal passam a contar
--    pedidos CONFIRMADOS (não só 'delivered'). Métricas de entrega
--    (avg_time_minutes) e total_orders ficam como estavam.
-- ============================================================================

create or replace function public.get_dashboard_metrics(
  p_period text default 'week'  -- 'day' | 'week' | 'month' | 'all'
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_since        timestamptz;
  v_bucket_trunc text;
begin
  v_since := case p_period
    when 'day'   then now() - interval '1 day'
    when 'week'  then now() - interval '7 days'
    when 'month' then now() - interval '30 days'
    when 'all'   then '1970-01-01'::timestamptz
    else now() - interval '7 days'
  end;

  v_bucket_trunc := case p_period
    when 'day' then 'hour'
    else 'day'
  end;

  return jsonb_build_object(

    -- ── Totais (vendas confirmadas) ──────────────────────────────────────────
    'revenue_cents', (
      select coalesce(sum(total_cents), 0)
      from orders
      where status in ('approved','paid','in_preparation','ready','delivered')
        and created_at >= v_since
    ),

    'avg_ticket_cents', (
      select coalesce(round(avg(total_cents)), 0)
      from orders
      where status in ('approved','paid','in_preparation','ready','delivered')
        and created_at >= v_since
    ),

    'total_orders', (
      select count(*)
      from orders
      where status not in ('draft', 'cancelled')
        and created_at >= v_since
    ),

    -- ── Split Levantamento vs Entrega ───────────────────────────────────────
    'pickup_vs_delivery', (
      select coalesce(jsonb_agg(r order by r.fulfillment_type), '[]'::jsonb)
      from (
        select fulfillment_type, count(*) as count, sum(total_cents) as revenue_cents
        from orders
        where status in ('approved','paid','in_preparation','ready','delivered')
          and created_at >= v_since
        group by fulfillment_type
      ) r
    ),

    -- ── Tempo médio pago → entregue (minutos) — só pedidos entregues ─────────
    'avg_time_minutes', (
      select round(avg(
        extract(epoch from (e_del.created_at - e_pay.created_at)) / 60.0
      )::numeric, 1)
      from event_log e_pay
      join event_log e_del
        on  e_del.order_id = e_pay.order_id
        and e_del.type    = 'order.deliver'
      where e_pay.type = 'payment.confirmed'
        and e_pay.created_at >= v_since
    ),

    -- ── Top 10 itens por quantidade vendida ─────────────────────────────────
    'top_items', (
      select coalesce(jsonb_agg(r order by r.qty desc), '[]'::jsonb)
      from (
        select oi.name_snapshot as name, sum(oi.qty) as qty
        from order_items oi
        join orders o on o.id = oi.order_id
        where o.status in ('approved','paid','in_preparation','ready','delivered')
          and o.created_at >= v_since
        group by oi.name_snapshot
        order by qty desc
        limit 10
      ) r
    ),

    -- ── Faturamento por método de pagamento ─────────────────────────────────
    'by_method', (
      select coalesce(jsonb_agg(r), '[]'::jsonb)
      from (
        select o.payment_method as method, sum(o.total_cents) as cents
        from orders o
        where o.status in ('approved','paid','in_preparation','ready','delivered')
          and o.created_at >= v_since
        group by o.payment_method
      ) r
    ),

    -- ── Heatmap: pedidos por hora do dia ────────────────────────────────────
    'hourly', (
      select coalesce(jsonb_agg(r order by r.hour), '[]'::jsonb)
      from (
        select extract(hour from created_at)::int as hour, count(*) as count
        from orders
        where status not in ('draft', 'cancelled')
          and created_at >= v_since
        group by hour
      ) r
    ),

    -- ── Top 10 clientes (por valor total gasto) ────────────────────────────
    'top_customers', (
      select coalesce(jsonb_agg(r order by r.total_cents desc), '[]'::jsonb)
      from (
        select
          customer_name,
          customer_phone,
          count(*) as order_count,
          sum(total_cents) as total_cents
        from orders
        where status in ('approved','paid','in_preparation','ready','delivered')
          and created_at >= v_since
          and customer_name is not null
        group by customer_name, customer_phone
        order by total_cents desc
        limit 10
      ) r
    ),

    -- ── Série temporal: faturamento por bucket (hora ou dia) ────────────────
    'period_buckets', (
      select coalesce(jsonb_agg(r order by r.bucket), '[]'::jsonb)
      from (
        select
          date_trunc(v_bucket_trunc, created_at) as bucket,
          sum(total_cents) as revenue_cents
        from orders
        where status in ('approved','paid','in_preparation','ready','delivered')
          and created_at >= v_since
        group by bucket
      ) r
    )

  );
end;
$$;

revoke all on function public.get_dashboard_metrics(text) from public;
grant  execute on function public.get_dashboard_metrics(text) to authenticated;
