-- HAWSMASH 2.0 — 1091: fecho do dia.
--
-- O turno fecha com a contagem da gaveta (1007) e a pessoa seguinte abre o
-- seu. No fim de tudo, o fecho do dia junta os turnos fechados desde o último
-- fecho do dia — nunca "desde a meia-noite" (CLAUDE §9) — num só relatório:
-- vendas por forma de pagamento, movimentos, a diferença de cada turno e quem
-- abriu e fechou cada um.
--
-- Não recalcula dinheiro: soma o que cada turno já congelou no seu `report`.
-- É por isso que o fecho do dia bate sempre com os talões dos turnos, e é por
-- isso que cada turno pertence a um só fecho do dia (`day_close_id`).

create table if not exists public.cash_day_closes (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  -- O dia de Maputo em que abriu o primeiro turno do fecho.
  business_date date not null,
  request_id uuid not null,
  -- Null só nos dias anteriores a esta migration (reconstruídos abaixo).
  closed_by uuid references auth.users(id) on delete restrict,
  closed_at timestamptz not null default now(),
  report jsonb not null,
  created_at timestamptz not null default now(),
  constraint cash_day_closes_request_unique unique (store_id, request_id)
);

alter table public.cash_sessions
  add column if not exists day_close_id uuid references public.cash_day_closes(id) on delete restrict;

create index if not exists cash_sessions_day_pending_idx
  on public.cash_sessions (store_id, opened_at)
  where closed_at is not null and day_close_id is null;
create index if not exists cash_day_closes_store_closed_idx
  on public.cash_day_closes (store_id, closed_at desc);

alter table public.cash_day_closes enable row level security;

revoke all on public.cash_day_closes from public, anon, authenticated;
grant select on public.cash_day_closes to authenticated;
grant select, insert, update, delete on public.cash_day_closes to service_role;

-- A cozinha não vê dinheiro (CLAUDE §6).
drop policy if exists cash_day_closes_store_select on public.cash_day_closes;
create policy cash_day_closes_store_select on public.cash_day_closes
for select to authenticated
using (
  (select private.auth_can_store(store_id))
  and (select private.auth_role()) in ('owner', 'manager', 'cashier')
);

-- Um valor em centavos dentro do `report` de um turno. Os turnos do motor
-- herdado não têm todas as chaves: o que falta conta zero, nunca rebenta.
create or replace function private.cash_report_cents(p_report jsonb, p_path text[])
returns bigint
language sql
immutable
set search_path = ''
as $$
  select case
    when pg_catalog.jsonb_typeof(p_report #> p_path) = 'number'
      then pg_catalog.round((p_report #>> p_path)::numeric)::bigint
    else 0
  end;
$$;

revoke execute on function private.cash_report_cents(jsonb, text[])
  from public, anon, authenticated;

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

  return jsonb_build_object(
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
end;
$$;

revoke execute on function private.cash_day_report(uuid, uuid[])
  from public, anon, authenticated;

-- O que o bridge imprime. Leva também os campos do talão de fecho de turno:
-- o bridge que está hoje nas lojas imprime o dia nesse formato (com "FECHO DO
-- DIA" na linha do turno) até receber o .exe que conhece o `day`.
create or replace function private.cash_day_print_payload(p_report jsonb, p_store_short_name text)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select p_report || jsonb_build_object(
    'template', 'cash_close',
    'day', true,
    'store_short_name', coalesce(p_store_short_name, 'Loja'),
    'shift_label', 'FECHO DO DIA ' || to_char((p_report ->> 'business_date')::date, 'DD/MM/YYYY')
      || ' - ' || (p_report ->> 'shifts_count')
      || case when (p_report ->> 'shifts_count') = '1' then ' turno' else ' turnos' end,
    'opened_at', p_report -> 'first_opened_at',
    'closed_at', p_report -> 'closed_at',
    'counted_cash_cents', p_report -> 'closing_cash_cents',
    'expected_cash_cents',
      private.cash_report_cents(p_report, '{closing_cash_cents}')
      - private.cash_report_cents(p_report, '{difference_cents}'),
    'difference_reason', null
  );
$$;

revoke execute on function private.cash_day_print_payload(jsonb, text)
  from public, anon, authenticated;

-- Os dias anteriores a esta migration ficam fechados, um por loja e por dia de
-- Maputo, sem papel nem email: sem isto, o primeiro fecho do dia juntava todo
-- o histórico. Os turnos de hoje ficam por fechar — entram no fecho desta noite.
do $$
declare
  v_group record;
  v_id uuid;
  v_report jsonb;
begin
  for v_group in
    select
      cs.store_id,
      (cs.opened_at at time zone 'Africa/Maputo')::date as business_date,
      array_agg(cs.id order by cs.opened_at, cs.id) as sessions,
      max(cs.closed_at) as closed_at
    from public.cash_sessions cs
    where cs.closed_at is not null
      and cs.day_close_id is null
      and cs.store_id is not null
      and (cs.opened_at at time zone 'Africa/Maputo')::date
        < (pg_catalog.now() at time zone 'Africa/Maputo')::date
    group by cs.store_id, (cs.opened_at at time zone 'Africa/Maputo')::date
  loop
    v_id := gen_random_uuid();
    v_report := private.cash_day_report(v_group.store_id, v_group.sessions)
      || jsonb_build_object(
        'day_close_id', v_id,
        'closed_at', v_group.closed_at,
        'closed_by_name', null,
        'backfill', true
      );

    insert into public.cash_day_closes (
      id, store_id, business_date, request_id, closed_by, closed_at, report
    ) values (
      v_id, v_group.store_id, v_group.business_date, gen_random_uuid(),
      null, v_group.closed_at, v_report
    );

    update public.cash_sessions
    set day_close_id = v_id
    where store_id = v_group.store_id
      and id = any(v_group.sessions)
      and day_close_id is null;
  end loop;
end $$;

create or replace function public.get_cash_day(p_store uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_role text;
  v_sessions uuid[];
  v_open jsonb;
  v_last jsonb;
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

  select array_agg(cs.id order by cs.opened_at, cs.id)
  into v_sessions
  from public.cash_sessions cs
  where cs.store_id = p_store
    and cs.closed_at is not null
    and cs.day_close_id is null;

  select jsonb_build_object(
    'id', cs.id,
    'shift_label', cs.shift_label,
    'opened_at', cs.opened_at
  )
  into v_open
  from public.cash_sessions cs
  where cs.store_id = p_store and cs.closed_at is null
  order by cs.opened_at desc
  limit 1;

  select jsonb_build_object(
    'id', d.id,
    'business_date', d.business_date,
    'closed_at', d.closed_at,
    'shifts_count', d.report -> 'shifts_count',
    'total_faturado_cents', d.report -> 'total_faturado_cents',
    'difference_cents', d.report -> 'difference_cents'
  )
  into v_last
  from public.cash_day_closes d
  where d.store_id = p_store
  order by d.closed_at desc
  limit 1;

  return jsonb_build_object(
    'store_id', p_store,
    'open_session', v_open,
    'pending', case when v_sessions is null then null
      else private.cash_day_report(p_store, v_sessions) end,
    'last_day_close', v_last
  );
end;
$$;

revoke all on function public.get_cash_day(uuid) from public, anon;
grant execute on function public.get_cash_day(uuid) to authenticated, service_role;

create or replace function public.close_cash_day(p_store uuid, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_role text;
  v_existing public.cash_day_closes%rowtype;
  v_sessions uuid[];
  v_id uuid := gen_random_uuid();
  v_now timestamptz := pg_catalog.now();
  v_report jsonb;
  v_closer_name text;
  v_store_short_name text;
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
  if p_request_id is null then
    raise exception 'day_close_request_id_required' using errcode = 'P0007';
  end if;

  -- O mesmo cadeado da abertura e do fecho de turno: nada abre nem fecha um
  -- turno desta loja a meio do fecho do dia.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('cash_session:' || p_store::text, 0)
  );

  -- Repetir o pedido (rede caiu antes da resposta) devolve o mesmo fecho.
  select d.* into v_existing
  from public.cash_day_closes d
  where d.store_id = p_store and d.request_id = p_request_id;
  if found then
    return v_existing.report || jsonb_build_object('duplicate', true);
  end if;

  if exists (
    select 1 from public.cash_sessions cs
    where cs.store_id = p_store and cs.closed_at is null
  ) then
    raise exception 'session_open' using errcode = 'P0034';
  end if;

  select array_agg(cs.id order by cs.opened_at, cs.id)
  into v_sessions
  from public.cash_sessions cs
  where cs.store_id = p_store
    and cs.closed_at is not null
    and cs.day_close_id is null;
  if v_sessions is null then
    raise exception 'no_shifts_to_close' using errcode = 'P0035';
  end if;

  select sp.full_name into v_closer_name
  from public.staff_profiles sp where sp.user_id = v_uid;

  v_report := private.cash_day_report(p_store, v_sessions) || jsonb_build_object(
    'day_close_id', v_id,
    'closed_at', v_now,
    'closed_by_name', v_closer_name
  );

  insert into public.cash_day_closes (
    id, store_id, business_date, request_id, closed_by, closed_at, report
  ) values (
    v_id, p_store, (v_report ->> 'business_date')::date, p_request_id,
    v_uid, v_now, v_report
  );

  update public.cash_sessions
  set day_close_id = v_id
  where store_id = p_store
    and id = any(v_sessions)
    and day_close_id is null;

  -- Best-effort: uma falha de papel nunca reverte o fecho do dia.
  begin
    select s.short_name into v_store_short_name
    from public.stores s where s.id = p_store;

    insert into public.print_jobs (
      store_id, order_id, request_id, station, kind, reprint_seq, payload
    ) values (
      p_store, null, v_id, 'counter', 'cash_close', 0,
      private.cash_day_print_payload(v_report, v_store_short_name)
    )
    on conflict (store_id, request_id, station, kind)
      where request_id is not null
      do nothing;
  exception when others then
    begin
      insert into public.event_log (store_id, actor_user_id, type, payload)
      values (
        p_store, v_uid, 'cash.day_close_print_failed',
        jsonb_build_object('day_close_id', v_id, 'error', sqlstate)
      );
    exception when others then
      null;
    end;
  end;

  insert into public.event_log (store_id, actor_user_id, type, payload)
  values (
    p_store,
    v_uid,
    'cash.day_closed',
    jsonb_build_object(
      'day_close_id', v_id,
      'business_date', v_report -> 'business_date',
      'shifts_count', v_report -> 'shifts_count',
      'total_faturado_cents', v_report -> 'total_faturado_cents',
      'difference_cents', v_report -> 'difference_cents'
    )
  );

  return v_report;
end;
$$;

revoke all on function public.close_cash_day(uuid, uuid) from public, anon;
grant execute on function public.close_cash_day(uuid, uuid) to authenticated, service_role;
