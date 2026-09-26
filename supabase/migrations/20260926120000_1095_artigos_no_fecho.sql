-- HAWSMASH 2.0 — 1095: os artigos vendidos no fecho de turno e no fecho do dia.
--
-- Pedido do dono (26 Set): o talão do fecho — de turno e do dia — e o email
-- que vai com ele passam a trazer tudo o que foi vendido, artigo a artigo.
--
-- O fecho de turno congela a lista no seu `report.sold`, com as mesmas regras
-- do dinheiro do fecho (1007): os pedidos da loja desde o último fecho até
-- agora, nos estados que contam como venda. Um pedido anulado não entra.
-- A lista junta por produto e variante; o valor de cada linha já leva os
-- extras, como o total do pedido.
--
-- O fecho do dia (1091) soma a lista que cada turno congelou. Os turnos
-- fechados antes desta migration não a têm: para esses, conta-se agora a
-- partir dos pedidos do período do turno — os mesmos que o turno contou.
--
-- A lista é informação, não dinheiro: se a contar falhar, o fecho fecha na
-- mesma, sem ela (regra 1 — o papel nunca trava o caixa).
--
-- Forward-only: substitui duas funções e acrescenta uma, sem tocar em dados.

create or replace function private.cash_sold(
  p_store uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with eligible_orders as (
    select o.id, o.delivery_fee_cents, o.discount_cents
    from public.orders o
    where o.store_id = p_store
      and o.created_at >= p_from
      and o.created_at < p_to
      and o.status in ('approved', 'paid', 'in_preparation', 'ready', 'delivered')
  ), lines as (
    select
      oi.name_snapshot as name,
      nullif(btrim(oi.variant_name_snapshot), '') as variant,
      oi.qty::bigint as qty,
      oi.qty::bigint * oi.unit_price_cents::bigint as total_cents
    from public.order_items oi
    join eligible_orders o on o.id = oi.order_id
  ), grouped as (
    select name, variant, sum(qty) as qty, sum(total_cents) as total_cents
    from lines
    group by name, variant
  )
  select jsonb_build_object(
    'items', coalesce(
      (select jsonb_agg(jsonb_build_object(
          'name', g.name,
          'variant', g.variant,
          'qty', g.qty,
          'total_cents', g.total_cents
        ) order by g.qty desc, g.name, g.variant nulls first)
       from grouped g),
      '[]'::jsonb
    ),
    'items_total_cents', (select coalesce(sum(g.total_cents), 0) from grouped g),
    'delivery_fees_cents', (select coalesce(sum(o.delivery_fee_cents), 0) from eligible_orders o),
    'discounts_cents', (select coalesce(sum(o.discount_cents), 0) from eligible_orders o)
  );
$$;

revoke execute on function private.cash_sold(uuid, timestamptz, timestamptz)
  from public, anon, authenticated;

-- A 1007, igual, com a lista dos artigos no `report`.
create or replace function public.close_cash_session(
  p_store uuid,
  p_counted integer,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_role text;
  v_session public.cash_sessions%rowtype;
  v_closed_at timestamptz := pg_catalog.now();
  v_period_start timestamptz;
  v_cash bigint := 0;
  v_mpesa bigint := 0;
  v_emola bigint := 0;
  v_card bigint := 0;
  v_sangria bigint := 0;
  v_reforco bigint := 0;
  v_despesa bigint := 0;
  v_troco_inicial bigint := 0;
  v_expected bigint;
  v_difference bigint;
  v_tolerance integer;
  v_orders_count integer := 0;
  v_sold jsonb;
  v_report jsonb;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0020';
  end if;

  v_role := private.auth_role();
  if v_role is null or v_role not in ('owner', 'manager', 'cashier') then
    raise exception 'cash_access_denied' using errcode = 'P0403';
  end if;
  if p_store is null or not private.auth_can_store(p_store) then
    raise exception 'store_access_denied' using errcode = 'P0403';
  end if;
  if p_counted is null or p_counted < 0 then
    raise exception 'invalid_counted_cents' using errcode = 'P0031';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('cash_session:' || p_store::text, 0)
  );
  select cs.* into v_session
  from public.cash_sessions cs
  where cs.store_id = p_store and cs.closed_at is null
  for update;
  if not found then
    raise exception 'no_open_session' using errcode = 'P0032';
  end if;

  select coalesce(max(cs.closed_at), v_session.opened_at)
  into v_period_start
  from public.cash_sessions cs
  where cs.store_id = p_store
    and cs.id <> v_session.id
    and cs.closed_at is not null
    and cs.closed_at <= v_session.opened_at;

  with eligible_orders as (
    select o.id, o.payment_method, o.total_cents
    from public.orders o
    where o.store_id = p_store
      and o.created_at >= v_period_start
      and o.created_at < v_closed_at
      and o.status in ('approved', 'paid', 'in_preparation', 'ready', 'delivered')
  ), amounts as (
    select p.method, p.amount_cents::bigint
    from public.payments p
    join eligible_orders o on o.id = p.order_id
    where p.store_id = p_store and p.status = 'confirmed'
    union all
    select o.payment_method, o.total_cents::bigint
    from eligible_orders o
    where not exists (
      select 1 from public.payments p
      where p.order_id = o.id and p.status = 'confirmed'
    )
  )
  select
    coalesce(sum(amount_cents) filter (where method = 'cash'), 0),
    coalesce(sum(amount_cents) filter (where method = 'mpesa'), 0),
    coalesce(sum(amount_cents) filter (where method = 'emola'), 0),
    coalesce(sum(amount_cents) filter (where method = 'credit_card'), 0)
  into v_cash, v_mpesa, v_emola, v_card
  from amounts;

  select count(*)::integer into v_orders_count
  from public.orders o
  where o.store_id = p_store
    and o.created_at >= v_period_start
    and o.created_at < v_closed_at
    and o.status in ('approved', 'paid', 'in_preparation', 'ready', 'delivered');

  select
    coalesce(sum(cm.amount_cents) filter (where cm.type = 'sangria'), 0),
    coalesce(sum(cm.amount_cents) filter (where cm.type = 'reforco'), 0),
    coalesce(sum(cm.amount_cents) filter (where cm.type = 'despesa'), 0),
    coalesce(sum(cm.amount_cents) filter (where cm.type = 'troco_inicial'), 0)
  into v_sangria, v_reforco, v_despesa, v_troco_inicial
  from public.cash_movements cm
  where cm.session_id = v_session.id and cm.store_id = p_store;

  v_expected := v_session.opening_float_cents + v_cash - v_sangria +
    v_reforco + v_troco_inicial - v_despesa;
  v_difference := p_counted::bigint - v_expected;

  select s.cash_diff_tolerance_cents into v_tolerance
  from public.settings s where s.id = 1;
  v_tolerance := coalesce(v_tolerance, 1000);
  if abs(v_difference) > v_tolerance and (p_reason is null or btrim(p_reason) = '') then
    raise exception 'difference_reason_required' using errcode = 'P0033';
  end if;

  -- Os artigos são informação: uma falha a contá-los não trava o fecho.
  begin
    v_sold := private.cash_sold(p_store, v_period_start, v_closed_at);
  exception when others then
    v_sold := null;
  end;

  v_report := jsonb_build_object(
    'session_id', v_session.id,
    'store_id', p_store,
    'shift_label', v_session.shift_label,
    'opened_at', v_session.opened_at,
    'period_start', v_period_start,
    'closed_at', v_closed_at,
    'opening_float_cents', v_session.opening_float_cents,
    'cash_sales_cents', v_cash,
    'sangria_cents', v_sangria,
    'reforco_cents', v_reforco,
    'despesa_cents', v_despesa,
    'troco_inicial_cents', v_troco_inicial,
    'expected_cash_cents', v_expected,
    'counted_cash_cents', p_counted,
    'difference_cents', v_difference,
    'difference_reason', nullif(btrim(p_reason), ''),
    'total_pedidos', v_orders_count,
    'total_faturado_cents', v_cash + v_mpesa + v_emola + v_card,
    'payments', jsonb_build_object(
      'cash', v_cash,
      'mpesa', v_mpesa,
      'emola', v_emola,
      'credit_card', v_card
    )
  );
  if v_sold is not null then
    v_report := v_report || jsonb_build_object('sold', v_sold);
  end if;

  update public.cash_sessions
  set closed_by = v_uid,
      closed_at = v_closed_at,
      counted_cash_cents = p_counted,
      expected_cash_cents = v_expected::integer,
      difference_cents = v_difference::integer,
      difference_reason = nullif(btrim(p_reason), ''),
      report = v_report
  where id = v_session.id and store_id = p_store and closed_at is null;

  insert into public.event_log (store_id, actor_user_id, type, payload)
  values (
    p_store,
    v_uid,
    'cash.session_closed',
    jsonb_build_object(
      'session_id', v_session.id,
      'expected_cash_cents', v_expected,
      'counted_cash_cents', p_counted,
      'difference_cents', v_difference,
      'difference_reason', nullif(btrim(p_reason), '')
    )
  );

  return v_report;
end;
$$;

revoke all on function public.close_cash_session(uuid, integer, text)
  from public, anon;
grant execute on function public.close_cash_session(uuid, integer, text)
  to authenticated, service_role;

-- A soma do dia: a lista que cada turno congelou; para os turnos de antes
-- desta migration, a que os pedidos do seu período dão hoje.
create or replace function private.cash_day_sold(p_store uuid, p_sessions uuid[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with per_shift as (
    select coalesce(
      case when pg_catalog.jsonb_typeof(cs.report -> 'sold') = 'object' then cs.report -> 'sold' end,
      private.cash_sold(
        p_store,
        coalesce((cs.report ->> 'period_start')::timestamptz, cs.opened_at),
        cs.closed_at
      )
    ) as sold
    from public.cash_sessions cs
    where cs.store_id = p_store
      and cs.id = any(p_sessions)
      and cs.closed_at is not null
  ), lines as (
    select
      item ->> 'name' as name,
      nullif(item ->> 'variant', '') as variant,
      private.cash_report_cents(item, '{qty}') as qty,
      private.cash_report_cents(item, '{total_cents}') as total_cents
    from per_shift s
    cross join lateral pg_catalog.jsonb_array_elements(
      case when pg_catalog.jsonb_typeof(s.sold -> 'items') = 'array'
        then s.sold -> 'items' else '[]'::jsonb end
    ) as item
  ), grouped as (
    select name, variant, sum(qty) as qty, sum(total_cents) as total_cents
    from lines
    where name is not null
    group by name, variant
  )
  select jsonb_build_object(
    'items', coalesce(
      (select jsonb_agg(jsonb_build_object(
          'name', g.name,
          'variant', g.variant,
          'qty', g.qty,
          'total_cents', g.total_cents
        ) order by g.qty desc, g.name, g.variant nulls first)
       from grouped g),
      '[]'::jsonb
    ),
    'items_total_cents', (select coalesce(sum(g.total_cents), 0) from grouped g),
    'delivery_fees_cents',
      (select coalesce(sum(private.cash_report_cents(s.sold, '{delivery_fees_cents}')), 0) from per_shift s),
    'discounts_cents',
      (select coalesce(sum(private.cash_report_cents(s.sold, '{discounts_cents}')), 0) from per_shift s)
  );
$$;

revoke execute on function private.cash_day_sold(uuid, uuid[])
  from public, anon, authenticated;

-- A 1091, igual, com a lista do dia no relatório.
create or replace function private.cash_day_report(p_store uuid, p_sessions uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_shifts jsonb;
  v_count integer := 0;
  v_first_opened timestamptz;
  v_last_closed timestamptz;
  v_opening_float bigint := 0;
  v_closing_cash bigint := 0;
  v_pedidos bigint := 0;
  v_faturado bigint := 0;
  v_cash bigint := 0;
  v_mpesa bigint := 0;
  v_emola bigint := 0;
  v_card bigint := 0;
  v_cash_sales bigint := 0;
  v_sangria bigint := 0;
  v_reforco bigint := 0;
  v_despesa bigint := 0;
  v_troco_inicial bigint := 0;
  v_difference bigint := 0;
  v_sold jsonb;
  v_report jsonb;
begin
  select
    count(*)::integer,
    min(cs.opened_at),
    max(cs.closed_at),
    coalesce(sum(private.cash_report_cents(cs.report, '{total_pedidos}')), 0),
    coalesce(sum(private.cash_report_cents(cs.report, '{total_faturado_cents}')), 0),
    coalesce(sum(private.cash_report_cents(cs.report, '{payments,cash}')), 0),
    coalesce(sum(private.cash_report_cents(cs.report, '{payments,mpesa}')), 0),
    coalesce(sum(private.cash_report_cents(cs.report, '{payments,emola}')), 0),
    coalesce(sum(private.cash_report_cents(cs.report, '{payments,credit_card}')), 0),
    coalesce(sum(private.cash_report_cents(cs.report, '{cash_sales_cents}')), 0),
    coalesce(sum(private.cash_report_cents(cs.report, '{sangria_cents}')), 0),
    coalesce(sum(private.cash_report_cents(cs.report, '{reforco_cents}')), 0),
    coalesce(sum(private.cash_report_cents(cs.report, '{despesa_cents}')), 0),
    coalesce(sum(private.cash_report_cents(cs.report, '{troco_inicial_cents}')), 0),
    coalesce(sum(coalesce(cs.difference_cents, 0)), 0)
  into
    v_count, v_first_opened, v_last_closed, v_pedidos, v_faturado,
    v_cash, v_mpesa, v_emola, v_card, v_cash_sales,
    v_sangria, v_reforco, v_despesa, v_troco_inicial, v_difference
  from public.cash_sessions cs
  where cs.store_id = p_store
    and cs.id = any(p_sessions)
    and cs.closed_at is not null;

  if v_count = 0 then
    return null;
  end if;

  -- O fundo com que o dia começou e o dinheiro que fica na gaveta no fim.
  select cs.opening_float_cents into v_opening_float
  from public.cash_sessions cs
  where cs.store_id = p_store and cs.id = any(p_sessions) and cs.closed_at is not null
  order by cs.opened_at, cs.id
  limit 1;

  select coalesce(cs.counted_cash_cents, 0) into v_closing_cash
  from public.cash_sessions cs
  where cs.store_id = p_store and cs.id = any(p_sessions) and cs.closed_at is not null
  order by cs.closed_at desc, cs.id desc
  limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
    'session_id', cs.id,
    'shift_label', cs.shift_label,
    'opened_at', cs.opened_at,
    'closed_at', cs.closed_at,
    'opened_by_name', opener.full_name,
    'closed_by_name', closer.full_name,
    'opening_float_cents', cs.opening_float_cents,
    'expected_cash_cents', coalesce(cs.expected_cash_cents, 0),
    'counted_cash_cents', coalesce(cs.counted_cash_cents, 0),
    'difference_cents', coalesce(cs.difference_cents, 0),
    'difference_reason', cs.difference_reason,
    'total_pedidos', private.cash_report_cents(cs.report, '{total_pedidos}'),
    'total_faturado_cents', private.cash_report_cents(cs.report, '{total_faturado_cents}')
  ) order by cs.opened_at, cs.id), '[]'::jsonb)
  into v_shifts
  from public.cash_sessions cs
  left join public.staff_profiles opener on opener.user_id = cs.opened_by
  left join public.staff_profiles closer on closer.user_id = cs.closed_by
  where cs.store_id = p_store
    and cs.id = any(p_sessions)
    and cs.closed_at is not null;

  v_report := jsonb_build_object(
    'store_id', p_store,
    'business_date', (v_first_opened at time zone 'Africa/Maputo')::date,
    'shifts_count', v_count,
    'first_opened_at', v_first_opened,
    'last_shift_closed_at', v_last_closed,
    'opening_float_cents', v_opening_float,
    'closing_cash_cents', v_closing_cash,
    'total_pedidos', v_pedidos,
    'total_faturado_cents', v_faturado,
    'payments', jsonb_build_object(
      'cash', v_cash,
      'mpesa', v_mpesa,
      'emola', v_emola,
      'credit_card', v_card
    ),
    'cash_sales_cents', v_cash_sales,
    'sangria_cents', v_sangria,
    'reforco_cents', v_reforco,
    'despesa_cents', v_despesa,
    'troco_inicial_cents', v_troco_inicial,
    'difference_cents', v_difference,
    'shifts', v_shifts
  );

  -- Informação, como no turno: sem lista, o fecho do dia fecha na mesma.
  begin
    v_sold := private.cash_day_sold(p_store, p_sessions);
  exception when others then
    v_sold := null;
  end;
  if v_sold is not null then
    v_report := v_report || jsonb_build_object('sold', v_sold);
  end if;

  return v_report;
end;
$$;

revoke execute on function private.cash_day_report(uuid, uuid[])
  from public, anon, authenticated;
