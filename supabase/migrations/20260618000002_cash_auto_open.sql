-- ============================================================================
-- DELIVERY OS — Caixa: auto-open session quando não há sessão aberta
-- Fix: close_cash_session lançava no_open_session quando o dono nunca clicou
-- "Abrir Sessão" (etapa extra desnecessária). Agora o fecho cria a sessão
-- implicitamente com opened_at = último fecho (ou epoch se nunca houve fecho).
-- ============================================================================

create or replace function public.close_cash_session(
  p_counted_cents int,
  p_notes         text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid           uuid;
  v_session       record;
  v_closed_at     timestamptz;
  v_expected      int := 0;
  v_difference    int;
  v_orders_count  int := 0;
  v_delivered     int := 0;
  v_report        jsonb;
  v_by_method     jsonb;
  v_by_fulfill    jsonb;
  v_items_sold    jsonb;
  v_last_close    timestamptz;
  v_auto_opened   bool := false;
begin
  v_uid       := auth.uid();
  v_closed_at := now();

  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0020';
  end if;

  if p_counted_cents is null or p_counted_cents < 0 then
    raise exception 'invalid_counted_cents' using errcode = 'P0031';
  end if;

  -- Obter a sessão aberta
  select * into v_session from cash_sessions where closed_at is null limit 1;

  -- Se não há sessão aberta, criar uma implicitamente (opened_at = último fecho)
  if not found then
    select max(closed_at) into v_last_close from cash_sessions where closed_at is not null;

    insert into cash_sessions (opened_at, opened_by)
    values (coalesce(v_last_close, '1970-01-01'::timestamptz), v_uid)
    returning * into v_session;

    v_auto_opened := true;

    insert into event_log (type, payload)
    values ('cash.session_auto_opened', jsonb_build_object(
      'session_id', v_session.id,
      'opened_by', v_uid,
      'opened_at', v_session.opened_at
    ));
  end if;

  -- Calcular total esperado a partir dos pedidos confirmados no período
  select
    coalesce(sum(o.total_cents), 0),
    count(*),
    count(*) filter (where o.status = 'delivered')
  into v_expected, v_orders_count, v_delivered
  from _confirmed_orders_in_period(v_session.opened_at, v_closed_at) o;

  v_difference := p_counted_cents - v_expected;

  -- Breakdown por método de pagamento
  select coalesce(jsonb_object_agg(
    pm.payment_method,
    jsonb_build_object('count', pm.cnt, 'total_cents', pm.tot)
  ), '{}') into v_by_method
  from (
    select o.payment_method,
           count(*)::int            as cnt,
           coalesce(sum(o.total_cents), 0)::int as tot
    from _confirmed_orders_in_period(v_session.opened_at, v_closed_at) o
    group by o.payment_method
  ) pm;

  -- Breakdown por tipo de entrega
  select coalesce(jsonb_object_agg(
    ft.fulfillment_type,
    jsonb_build_object('count', ft.cnt, 'total_cents', ft.tot)
  ), '{}') into v_by_fulfill
  from (
    select o.fulfillment_type,
           count(*)::int                        as cnt,
           coalesce(sum(o.total_cents), 0)::int as tot
    from _confirmed_orders_in_period(v_session.opened_at, v_closed_at) o
    group by o.fulfillment_type
  ) ft;

  -- Itens vendidos (nome, qty, total) no período
  select coalesce(jsonb_agg(
    jsonb_build_object('name', iv.name, 'qty', iv.qty, 'total_cents', iv.total_cents)
    order by iv.total_cents desc
  ), '[]') into v_items_sold
  from (
    select oi.name_snapshot                        as name,
           sum(oi.qty)::int                        as qty,
           sum(oi.qty * oi.unit_price_cents)::int  as total_cents
    from order_items oi
    join orders o on o.id = oi.order_id
    where o.created_at >= v_session.opened_at
      and o.created_at <  v_closed_at
      and o.status in ('approved','paid','in_preparation','ready','delivered')
    group by oi.name_snapshot
  ) iv;

  -- Montar snapshot imutável
  v_report := jsonb_build_object(
    'session_id',           v_session.id,
    'opened_at',            v_session.opened_at,
    'closed_at',            v_closed_at,
    'total_pedidos',        v_orders_count,
    'total_entregues',      v_delivered,
    'total_faturado_cents', v_expected,
    'counted_cash_cents',   p_counted_cents,
    'difference_cents',     v_difference,
    'por_metodo',           v_by_method,
    'por_entrega',          v_by_fulfill,
    'items_vendidos',       v_items_sold
  );

  -- Fechar sessão (update atómico + report congelado)
  update cash_sessions
  set closed_at           = v_closed_at,
      closed_by           = v_uid,
      expected_cash_cents = v_expected,
      counted_cash_cents  = p_counted_cents,
      difference_cents    = v_difference,
      notes               = p_notes,
      report              = v_report
  where id = v_session.id;

  insert into event_log (type, payload)
  values ('cash.session_closed', jsonb_build_object(
    'session_id',     v_session.id,
    'expected_cents', v_expected,
    'counted_cents',  p_counted_cents,
    'difference',     v_difference,
    'closed_by',      v_uid,
    'auto_opened',    v_auto_opened
  ));

  return v_report;
end;
$$;

grant execute on function public.close_cash_session(int, text) to authenticated;
