-- ============================================================================
-- DELIVERY OS — KPIs extra no painel Pedidos (dashboard estilo iFood)
-- Estende get_order_stats com métricas "de hoje" (fuso Africa/Maputo) +
-- avaliação média. Mantém os campos anteriores (não quebra o painel atual).
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
  v_faturado_hoje     int := 0;
  v_pedidos_hoje      int := 0;
  v_cancelados_hoje   int := 0;
  v_entregues_hoje    int := 0;
  v_avg_rating        numeric;
begin
  -- início do dia no fuso de Maputo, convertido para UTC
  v_today := date_trunc('day', now() at time zone 'Africa/Maputo') at time zone 'Africa/Maputo';

  select coalesce(sum(total_cents), 0) into v_total_faturado
  from orders where status in ('approved','paid','in_preparation','ready','delivered');

  select count(*) into v_ativos
  from orders where status in ('approved','paid','in_preparation','ready');

  select count(*) into v_aguarda_pagamento from orders where status = 'awaiting_approval';
  select count(*) into v_em_preparo from orders where status = 'in_preparation';
  select count(*) into v_prontos from orders where status = 'ready';

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

  select round(avg(rating)::numeric, 1) into v_avg_rating from order_feedback;

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
    'avg_rating',        v_avg_rating
  );
end;
$$;

grant execute on function public.get_order_stats() to authenticated;
