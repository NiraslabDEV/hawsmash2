-- ============================================================================
-- DELIVERY OS — Caixa: sessões de fecho do dia
-- F1.2: cash_sessions + RPCs open/close/dashboard (SECURITY DEFINER)
-- Ref: CLAUDE.md secção 8
-- ============================================================================

-- ============================================================================
-- TABELA
-- ============================================================================

create table cash_sessions (
  id                  uuid        primary key default gen_random_uuid(),
  opened_at           timestamptz not null    default now(),
  opened_by           uuid        references auth.users(id) on delete set null,
  closed_at           timestamptz,
  closed_by           uuid        references auth.users(id) on delete set null,
  expected_cash_cents int,          -- calculado no fecho a partir dos pedidos do período
  counted_cash_cents  int,          -- valor contado pelo staff
  difference_cents    int,          -- counted - expected
  notes               text,
  report              jsonb       not null    default '{}',  -- snapshot imutável do fecho
  created_at          timestamptz not null    default now()
);

-- RLS: só staff (authenticated). anon sem policy.
alter table cash_sessions enable row level security;

create policy "staff_all" on cash_sessions
  for all to authenticated using (true) with check (true);

-- ============================================================================
-- HELPER interno: pedidos confirmados no período
-- "Confirmado" = staff aprovou (manual) ou Paysuite confirmou (digital)
-- ============================================================================

create or replace function _confirmed_orders_in_period(p_from timestamptz, p_to timestamptz)
returns table (
  id                 uuid,
  order_number       text,
  total_cents        int,
  delivery_fee_cents int,
  payment_method     text,
  fulfillment_type   text,
  status             text,
  created_at         timestamptz
)
language sql stable security definer set search_path = public as $$
  select o.id, o.order_number, o.total_cents, o.delivery_fee_cents,
         o.payment_method, o.fulfillment_type, o.status, o.created_at
  from orders o
  where o.created_at >= p_from
    and o.created_at <  p_to
    and o.status in ('approved','paid','in_preparation','ready','delivered');
$$;

-- ============================================================================
-- RPC: open_cash_session() → uuid
-- Abre uma nova sessão. Falha se já houver uma aberta.
-- ============================================================================

create or replace function public.open_cash_session()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid;
  v_session_id uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0020';
  end if;

  -- Só pode haver uma sessão aberta de cada vez
  if exists (select 1 from cash_sessions where closed_at is null) then
    raise exception 'session_already_open' using errcode = 'P0030';
  end if;

  insert into cash_sessions (opened_by)
  values (v_uid)
  returning id into v_session_id;

  insert into event_log (type, payload)
  values ('cash.session_opened', jsonb_build_object('session_id', v_session_id, 'opened_by', v_uid));

  return v_session_id;
end;
$$;

grant execute on function public.open_cash_session() to authenticated;

-- ============================================================================
-- RPC: close_cash_session(p_counted_cents, p_notes) → jsonb
-- Fecha a sessão aberta: calcula esperado, grava snapshot imutável em report.
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

  if not found then
    raise exception 'no_open_session' using errcode = 'P0032';
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
    'closed_by',      v_uid
  ));

  return v_report;
end;
$$;

grant execute on function public.close_cash_session(int, text) to authenticated;

-- ============================================================================
-- RPC: get_cash_dashboard() → jsonb
-- Painel ao vivo: stats do período atual + histórico dos últimos fechos.
-- Período = sessão aberta (se existe) ou desde midnight UTC de hoje.
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

  -- Período: sessão aberta ou hoje (midnight UTC)
  if v_has_open then
    v_period_start := v_open_session.opened_at;
  else
    v_period_start := date_trunc('day', v_now);
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
