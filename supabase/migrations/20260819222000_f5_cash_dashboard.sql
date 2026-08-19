-- F5: painel de caixa por loja e consolidado para o dono.

create or replace function private.cash_store_dashboard(
  p_store uuid,
  p_now timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_store public.stores%rowtype;
  v_open public.cash_sessions%rowtype;
  v_last_close timestamptz;
  v_period_start timestamptz;
  v_cash bigint := 0;
  v_mpesa bigint := 0;
  v_emola bigint := 0;
  v_card bigint := 0;
  v_sangria bigint := 0;
  v_reforco bigint := 0;
  v_despesa bigint := 0;
  v_troco_inicial bigint := 0;
  v_total bigint := 0;
  v_expected bigint := 0;
  v_orders integer := 0;
  v_history jsonb := '[]'::jsonb;
  v_movements jsonb := '[]'::jsonb;
begin
  select s.* into v_store from public.stores s where s.id = p_store;
  if not found then
    raise exception 'store_not_found' using errcode = 'P0002';
  end if;

  select cs.* into v_open
  from public.cash_sessions cs
  where cs.store_id = p_store and cs.closed_at is null
  order by cs.opened_at desc
  limit 1;

  select max(cs.closed_at) into v_last_close
  from public.cash_sessions cs
  where cs.store_id = p_store and cs.closed_at is not null;

  v_period_start := coalesce(
    v_last_close,
    v_open.opened_at,
    '1970-01-01 00:00:00+00'::timestamptz
  );

  with eligible_orders as (
    select o.id, o.payment_method, o.total_cents
    from public.orders o
    where o.store_id = p_store
      and o.created_at >= v_period_start
      and o.created_at < p_now
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

  select count(*)::integer into v_orders
  from public.orders o
  where o.store_id = p_store
    and o.created_at >= v_period_start
    and o.created_at < p_now
    and o.status in ('approved', 'paid', 'in_preparation', 'ready', 'delivered');

  if v_open.id is not null then
    select
      coalesce(sum(cm.amount_cents) filter (where cm.type = 'sangria'), 0),
      coalesce(sum(cm.amount_cents) filter (where cm.type = 'reforco'), 0),
      coalesce(sum(cm.amount_cents) filter (where cm.type = 'despesa'), 0),
      coalesce(sum(cm.amount_cents) filter (where cm.type = 'troco_inicial'), 0)
    into v_sangria, v_reforco, v_despesa, v_troco_inicial
    from public.cash_movements cm
    where cm.store_id = p_store and cm.session_id = v_open.id;

    select coalesce(jsonb_agg(jsonb_build_object(
      'id', cm.id,
      'type', cm.type,
      'amount_cents', cm.amount_cents,
      'reason', cm.reason,
      'created_by', cm.created_by,
      'created_at', cm.created_at
    ) order by cm.created_at desc), '[]'::jsonb)
    into v_movements
    from public.cash_movements cm
    where cm.store_id = p_store and cm.session_id = v_open.id;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', history.id,
    'shift_label', history.shift_label,
    'opened_at', history.opened_at,
    'closed_at', history.closed_at,
    'expected_cash_cents', history.expected_cash_cents,
    'counted_cash_cents', history.counted_cash_cents,
    'difference_cents', history.difference_cents,
    'difference_reason', history.difference_reason
  ) order by history.closed_at desc), '[]'::jsonb)
  into v_history
  from (
    select cs.*
    from public.cash_sessions cs
    where cs.store_id = p_store and cs.closed_at is not null
    order by cs.closed_at desc
    limit 10
  ) history;

  v_total := v_cash + v_mpesa + v_emola + v_card;
  v_expected := coalesce(v_open.opening_float_cents, 0) + v_cash - v_sangria +
    v_reforco + v_troco_inicial - v_despesa;

  return jsonb_build_object(
    'store_id', v_store.id,
    'store_slug', v_store.slug,
    'store_name', v_store.short_name,
    'period_start', v_period_start,
    'has_open_session', v_open.id is not null,
    'open_session', case when v_open.id is null then null else jsonb_build_object(
      'id', v_open.id,
      'shift_label', v_open.shift_label,
      'opened_at', v_open.opened_at,
      'opening_float_cents', v_open.opening_float_cents,
      'opened_by', v_open.opened_by
    ) end,
    'total_pedidos', v_orders,
    'total_faturado_cents', v_total,
    'cash_sales_cents', v_cash,
    'mpesa_cents', v_mpesa,
    'emola_cents', v_emola,
    'credit_card_cents', v_card,
    'sangria_cents', v_sangria,
    'reforco_cents', v_reforco,
    'despesa_cents', v_despesa,
    'troco_inicial_cents', v_troco_inicial,
    'expected_cash_cents', v_expected,
    'movements', v_movements,
    'history', v_history
  );
end;
$$;

revoke execute on function private.cash_store_dashboard(uuid, timestamptz)
  from public, anon, authenticated;

drop function if exists public.get_cash_dashboard();

create or replace function public.get_cash_dashboard(p_store uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_role text;
  v_now timestamptz := pg_catalog.now();
  v_store record;
  v_data jsonb;
  v_stores jsonb := '[]'::jsonb;
  v_total bigint := 0;
  v_cash bigint := 0;
  v_mpesa bigint := 0;
  v_emola bigint := 0;
  v_card bigint := 0;
  v_expected bigint := 0;
  v_orders integer := 0;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0020';
  end if;
  v_role := private.auth_role();
  if v_role is null or v_role = 'kitchen' then
    raise exception 'cash_access_denied' using errcode = 'P0403';
  end if;
  if p_store is not null and not private.auth_can_store(p_store) then
    raise exception 'store_access_denied' using errcode = 'P0403';
  end if;

  for v_store in
    select s.id
    from public.stores s
    where s.active
      and (p_store is null or s.id = p_store)
      and private.auth_can_store(s.id)
    order by s.short_name
  loop
    v_data := private.cash_store_dashboard(v_store.id, v_now);
    v_stores := v_stores || jsonb_build_array(v_data);
    v_total := v_total + (v_data ->> 'total_faturado_cents')::bigint;
    v_cash := v_cash + (v_data ->> 'cash_sales_cents')::bigint;
    v_mpesa := v_mpesa + (v_data ->> 'mpesa_cents')::bigint;
    v_emola := v_emola + (v_data ->> 'emola_cents')::bigint;
    v_card := v_card + (v_data ->> 'credit_card_cents')::bigint;
    v_expected := v_expected + (v_data ->> 'expected_cash_cents')::bigint;
    v_orders := v_orders + (v_data ->> 'total_pedidos')::integer;
  end loop;

  if jsonb_array_length(v_stores) = 0 then
    raise exception 'store_access_denied' using errcode = 'P0403';
  end if;

  return jsonb_build_object(
    'generated_at', v_now,
    'role', v_role,
    'can_consolidate', v_role = 'owner',
    'selected_store_id', p_store,
    'stores', v_stores,
    'consolidated', jsonb_build_object(
      'total_pedidos', v_orders,
      'total_faturado_cents', v_total,
      'cash_sales_cents', v_cash,
      'mpesa_cents', v_mpesa,
      'emola_cents', v_emola,
      'credit_card_cents', v_card,
      'expected_cash_cents', v_expected
    )
  );
end;
$$;

revoke all on function public.get_cash_dashboard(uuid) from public, anon;
grant execute on function public.get_cash_dashboard(uuid) to authenticated, service_role;
