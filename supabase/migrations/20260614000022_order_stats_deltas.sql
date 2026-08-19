-- ============================================================================
-- DELIVERY OS — Deltas "vs ontem" + contagens por status (painel iFood)
-- Estende get_order_stats com:
--   • valores de ONTEM (faturado/pedidos/cancelados + média de avaliação) para
--     o painel calcular ▲/▼ % real (sem inventar dados);
--   • status_counts: nº de pedidos por status (all-time, sem draft) para os
--     badges das abas (Todos / Novos / Aceitos / Em preparo / …).
-- Mantém TODOS os campos anteriores (não quebra o painel atual).
-- Fuso horário: Africa/Maputo (igual à migration 0021).
-- ============================================================================

create or replace function public.get_order_stats()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_total_faturado    int := 0;
  v_ativos            int := 0;
  v_aguarda_pagamento int := 0;
  v_em_preparo        int := 0;
  v_prontos           int := 0;
  v_today             timestamptz;
  v_yesterday         timestamptz;
  v_faturado_hoje     int := 0;
  v_pedidos_hoje      int := 0;
  v_cancelados_hoje   int := 0;
  v_entregues_hoje    int := 0;
  v_faturado_ontem    int := 0;
  v_pedidos_ontem     int := 0;
  v_cancelados_ontem  int := 0;
  v_avg_rating        numeric;
  v_avg_rating_hoje   numeric;
  v_avg_rating_ontem  numeric;
  v_status_counts     jsonb;
begin
  -- início do dia (e de ontem) no fuso de Maputo, em UTC
  v_today     := date_trunc('day', now() at time zone 'Africa/Maputo') at time zone 'Africa/Maputo';
  v_yesterday := v_today - interval '1 day';

  -- ── métricas all-time (inalteradas) ──────────────────────────────────────
  select coalesce(sum(total_cents), 0) into v_total_faturado
  from orders where status in ('approved','paid','in_preparation','ready','delivered');

  select count(*) into v_ativos
  from orders where status in ('approved','paid','in_preparation','ready');

  select count(*) into v_aguarda_pagamento from orders where status = 'awaiting_approval';
  select count(*) into v_em_preparo        from orders where status = 'in_preparation';
  select count(*) into v_prontos           from orders where status = 'ready';

  -- ── métricas de HOJE (inalteradas) ───────────────────────────────────────
  select coalesce(sum(total_cents), 0) into v_faturado_hoje
  from orders
  where status in ('approved','paid','in_preparation','ready','delivered')
    and created_at >= v_today;

  select count(*) into v_pedidos_hoje
  from orders where status not in ('draft','cancelled') and created_at >= v_today;

  select count(*) into v_cancelados_hoje
  from orders where status = 'cancelled' and created_at >= v_today;

  select count(*) into v_entregues_hoje
  from orders where status = 'delivered' and created_at >= v_today;

  -- ── métricas de ONTEM (novo — para os deltas) ────────────────────────────
  select coalesce(sum(total_cents), 0) into v_faturado_ontem
  from orders
  where status in ('approved','paid','in_preparation','ready','delivered')
    and created_at >= v_yesterday and created_at < v_today;

  select count(*) into v_pedidos_ontem
  from orders
  where status not in ('draft','cancelled')
    and created_at >= v_yesterday and created_at < v_today;

  select count(*) into v_cancelados_ontem
  from orders
  where status = 'cancelled'
    and created_at >= v_yesterday and created_at < v_today;

  -- ── avaliação média: all-time (valor mostrado) + hoje/ontem (delta) ──────
  select round(avg(rating)::numeric, 1) into v_avg_rating from order_feedback;
  select round(avg(rating)::numeric, 1) into v_avg_rating_hoje
  from order_feedback where created_at >= v_today;
  select round(avg(rating)::numeric, 1) into v_avg_rating_ontem
  from order_feedback where created_at >= v_yesterday and created_at < v_today;

  -- ── contagem por status para os badges das abas (all-time, sem draft) ────
  select coalesce(jsonb_object_agg(status, cnt), '{}'::jsonb) into v_status_counts
  from (select status, count(*) as cnt from orders where status <> 'draft' group by status) s;

  return jsonb_build_object(
    'total_faturado',    v_total_faturado,
    'ativos',            v_ativos,
    'aguarda_pagamento', v_aguarda_pagamento,
    'em_preparo',        v_em_preparo,
    'prontos',           v_prontos,
    'faturado_hoje',     v_faturado_hoje,
    'pedidos_hoje',      v_pedidos_hoje,
    'cancelados_hoje',   v_cancelados_hoje,
    'entregues_hoje',    v_entregues_hoje,
    'faturado_ontem',    v_faturado_ontem,
    'pedidos_ontem',     v_pedidos_ontem,
    'cancelados_ontem',  v_cancelados_ontem,
    'avg_rating',        v_avg_rating,
    'avg_rating_hoje',   v_avg_rating_hoje,
    'avg_rating_ontem',  v_avg_rating_ontem,
    'status_counts',     v_status_counts
  );
end;
$$;

grant execute on function public.get_order_stats() to authenticated;
