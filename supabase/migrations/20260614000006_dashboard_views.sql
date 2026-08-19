-- ============================================================================
-- F1.3 — Dashboard de Análise (single-tenant)
-- RPC get_dashboard_metrics(p_period): métricas agregadas para painel de análise.
--
-- Períodos aceitos: 'day' (últimas 24h), 'week' (últimos 7 dias),
--                  'month' (últimos 30 dias), 'all' (tudo).
-- Single-tenant: sem tenant_id, sem plan gating.
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
  v_since       timestamptz;
  v_bucket_trunc text;
begin
  -- 1. Intervalo de tempo
  v_since := case p_period
    when 'day'   then now() - interval '1 day'
    when 'week'  then now() - interval '7 days'
    when 'month' then now() - interval '30 days'
    when 'all'   then '1970-01-01'::timestamptz
    else now() - interval '7 days'
  end;

  -- Granularidade dos buckets de faturamento
  v_bucket_trunc := case p_period
    when 'day' then 'hour'
    else 'day'
  end;

  return jsonb_build_object(

    -- ── Totais ──────────────────────────────────────────────────────────────
    'revenue_cents', (
      select coalesce(sum(total_cents), 0)
      from orders
      where status = 'delivered'
        and created_at >= v_since
    ),

    'avg_ticket_cents', (
      select coalesce(round(avg(total_cents)), 0)
      from orders
      where status = 'delivered'
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
        where status = 'delivered'
          and created_at >= v_since
        group by fulfillment_type
      ) r
    ),

    -- ── Tempo médio pago → entregue (minutos) ───────────────────────────────
    -- event_log: 'payment.confirmed' (confirm_payment) → 'order.deliver' (advance_order)
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
        where o.status     = 'delivered'
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
        where o.status = 'delivered'
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
        where status = 'delivered'
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
        where status    = 'delivered'
          and created_at >= v_since
        group by bucket
      ) r
    )

  );
end;
$$;

-- Somente staff autenticado pode chamar
revoke all on function public.get_dashboard_metrics(text) from public;
grant  execute on function public.get_dashboard_metrics(text) to authenticated;