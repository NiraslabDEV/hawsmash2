-- HAWSMASH 2.0 — 1037: Análise por loja, com comparação ao período anterior.
--
-- O painel de Análise somava Maputo e Matola num só número, sem forma de ver
-- o que cada loja fez (CLAUDE §5.5 pede o selector "Maputo · Matola · Todas"
-- em todo o painel — este ecrã tinha ficado de fora) e mostrava a faturação
-- seca, sem contexto de "subiu ou desceu" — o relatório semanal do 1.0
-- (docs/legacy/hawsmash-edge-functions/weekly-report) sempre teve essa seta.
--
-- Esta migration substitui get_dashboard_metrics por uma versão que:
--   · aceita p_store_id (uma loja concreta; nulo = "Todas", só para o owner —
--     mesma regra do resto do painel, nunca `using (true)`);
--   · devolve também o período anterior de igual duração, para o ecrã montar
--     "↑12% vs semana passada" sem uma segunda chamada.
--
-- Forward-only e idempotente (§11.7): assinatura muda (ganha p_store_id), por
-- isso a função antiga é substituída por completo em vez de sobreposta.

drop function if exists public.get_dashboard_metrics(text);

create or replace function public.get_dashboard_metrics(
  p_period text default 'week',   -- 'day' | 'week' | 'month' | 'all'
  p_store_id uuid default null    -- null = todas as lojas (só owner)
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_since        timestamptz;
  v_length       interval;
  v_prev_since   timestamptz;
  v_bucket_trunc text;
  v_confirmed    text[] := array['approved','paid','in_preparation','ready','delivered'];
begin
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
    else null -- 'all': não há "período anterior" para comparar
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

    -- ── Totais (vendas confirmadas) ──────────────────────────────────────────
    'revenue_cents', (
      select coalesce(sum(total_cents), 0)
      from orders
      where status = any(v_confirmed)
        and created_at >= v_since
        and (p_store_id is null or store_id = p_store_id)
    ),

    'avg_ticket_cents', (
      select coalesce(round(avg(total_cents)), 0)
      from orders
      where status = any(v_confirmed)
        and created_at >= v_since
        and (p_store_id is null or store_id = p_store_id)
    ),

    'total_orders', (
      select count(*)
      from orders
      where status not in ('draft', 'cancelled')
        and created_at >= v_since
        and (p_store_id is null or store_id = p_store_id)
    ),

    -- ── Período anterior, mesma duração — para a seta de tendência ──────────
    'previous', case when v_prev_since is null then null else (
      select jsonb_build_object(
        'revenue_cents', coalesce(sum(total_cents), 0),
        'total_orders', count(*)
      )
      from orders
      where status = any(v_confirmed)
        and created_at >= v_prev_since
        and created_at < v_since
        and (p_store_id is null or store_id = p_store_id)
    ) end,

    -- ── Split Levantamento vs Entrega ───────────────────────────────────────
    'pickup_vs_delivery', (
      select coalesce(jsonb_agg(r order by r.fulfillment_type), '[]'::jsonb)
      from (
        select fulfillment_type, count(*) as count, sum(total_cents) as revenue_cents
        from orders
        where status = any(v_confirmed)
          and created_at >= v_since
          and (p_store_id is null or store_id = p_store_id)
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
      join orders o on o.id = e_pay.order_id
      where e_pay.type = 'payment.confirmed'
        and e_pay.created_at >= v_since
        and (p_store_id is null or o.store_id = p_store_id)
    ),

    -- ── Top 10 itens por quantidade vendida ─────────────────────────────────
    'top_items', (
      select coalesce(jsonb_agg(r order by r.qty desc), '[]'::jsonb)
      from (
        select oi.name_snapshot as name, sum(oi.qty) as qty
        from order_items oi
        join orders o on o.id = oi.order_id
        where o.status = any(v_confirmed)
          and o.created_at >= v_since
          and (p_store_id is null or o.store_id = p_store_id)
        group by oi.name_snapshot
        order by qty desc
        limit 10
      ) r
    ),

    -- ── Faturamento por método de pagamento ─────────────────────────────────
    'by_method', (
      select coalesce(jsonb_agg(r), '[]'::jsonb)
      from (
        select payment_method as method, sum(total_cents) as cents
        from orders
        where status = any(v_confirmed)
          and created_at >= v_since
          and (p_store_id is null or store_id = p_store_id)
        group by payment_method
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
          and (p_store_id is null or store_id = p_store_id)
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
        where status = any(v_confirmed)
          and created_at >= v_since
          and customer_name is not null
          and (p_store_id is null or store_id = p_store_id)
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
        where status = any(v_confirmed)
          and created_at >= v_since
          and (p_store_id is null or store_id = p_store_id)
        group by bucket
      ) r
    )

  );
end;
$$;

revoke all on function public.get_dashboard_metrics(text, uuid) from public;
grant  execute on function public.get_dashboard_metrics(text, uuid) to authenticated;
