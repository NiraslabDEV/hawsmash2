-- ============================================================================
-- DELIVERY OS — Correção: Caixa conta SEMPRE desde o último fecho
-- Ref: CLAUDE.md secção 8; decisão do ROADMAP "get_cash_dashboard mostra desde
-- o último fecho".
--
-- Bug: a versão 0016 usava opened_at como início do período quando havia sessão
-- aberta. Resultado: pedidos confirmados ANTES de abrir a sessão (ex.: pedidos
-- da noite, antes de o dono abrir a caixa de manhã) ficavam invisíveis na Caixa
-- — um furo para um negócio de delivery 24/7.
--
-- Correção: período = desde o ÚLTIMO FECHO (ou desde o início se nunca fechou),
-- independente de haver sessão aberta. A sessão aberta continua a ser mostrada
-- como marcador ("Sessão aberta desde HH:MM"), mas não corta o período.
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

  -- Sessão aberta? (só para mostrar o marcador "Sessão aberta desde ...")
  select * into v_open_session from cash_sessions where closed_at is null limit 1;
  v_has_open := found;

  -- Período = SEMPRE desde o último fecho; se nunca houve fecho → desde o início.
  select max(closed_at) into v_last_close from cash_sessions where closed_at is not null;
  v_period_start := coalesce(v_last_close, '1970-01-01'::timestamptz);

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
