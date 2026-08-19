-- HAWSMASH 2.0 — F5 / 1007: caixa por loja e por turno.

alter table public.cash_sessions
  add column if not exists shift_label text;
alter table public.cash_sessions
  add column if not exists opening_float_cents integer;
alter table public.cash_sessions
  add column if not exists difference_reason text;

update public.cash_sessions
set shift_label = coalesce(
      nullif(btrim(shift_label), ''),
      'Turno ' || to_char(opened_at at time zone 'Africa/Maputo', 'DD/MM/YYYY HH24:MI')
    ),
    opening_float_cents = coalesce(opening_float_cents, 0)
where shift_label is null
   or btrim(shift_label) = ''
   or opening_float_cents is null;

alter table public.cash_sessions
  alter column shift_label set not null;
alter table public.cash_sessions
  alter column opening_float_cents set default 0;
alter table public.cash_sessions
  alter column opening_float_cents set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'cash_sessions_opening_float_nonnegative'
      and conrelid = 'public.cash_sessions'::regclass
  ) then
    alter table public.cash_sessions
      add constraint cash_sessions_opening_float_nonnegative
      check (opening_float_cents >= 0);
  end if;
end $$;

-- DECISÃO: tolerância inicial de 10 MT. É configuração operacional e pode ser
-- alterada pelo dono sem nova migration; acima dela o motivo é obrigatório.
alter table public.settings
  add column if not exists cash_diff_tolerance_cents integer not null default 1000;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'settings_cash_diff_tolerance_nonnegative'
      and conrelid = 'public.settings'::regclass
  ) then
    alter table public.settings
      add constraint settings_cash_diff_tolerance_nonnegative
      check (cash_diff_tolerance_cents >= 0);
  end if;
end $$;

create table if not exists public.cash_movements (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.cash_sessions(id) on delete restrict,
  store_id uuid not null references public.stores(id) on delete restrict,
  type text not null check (type in ('sangria', 'reforco', 'despesa', 'troco_inicial')),
  amount_cents integer not null check (amount_cents > 0),
  reason text not null check (btrim(reason) <> ''),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

alter table public.cash_movements enable row level security;

revoke all on public.cash_movements from public, anon, authenticated;
grant select on public.cash_movements to authenticated;
grant select, insert, update, delete on public.cash_movements to service_role;

drop policy if exists cash_movements_store_select on public.cash_movements;
create policy cash_movements_store_select on public.cash_movements
for select to authenticated
using ((select private.auth_can_store(store_id)));

create index if not exists cash_sessions_store_open_idx
  on public.cash_sessions (store_id)
  where closed_at is null;
create index if not exists cash_movements_session_created_idx
  on public.cash_movements (session_id, created_at);
create index if not exists cash_movements_store_created_idx
  on public.cash_movements (store_id, created_at desc);

-- Todas as inserções, incluindo o auto-open herdado do POS, passam por este
-- bloqueio. Um retry concorrente do POS ignora a segunda sessão em vez de
-- reverter uma venda já válida.
create or replace function private.serialize_cash_session_open()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.shift_label := coalesce(
    nullif(btrim(new.shift_label), ''),
    'Turno ' || to_char(new.opened_at at time zone 'Africa/Maputo', 'DD/MM/YYYY HH24:MI')
  );
  new.opening_float_cents := coalesce(new.opening_float_cents, 0);

  if new.closed_at is not null then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('cash_session:' || new.store_id::text, 0)
  );

  if exists (
    select 1
    from public.cash_sessions cs
    where cs.store_id = new.store_id
      and cs.closed_at is null
      and cs.id <> new.id
  ) then
    return null;
  end if;

  return new;
end;
$$;

revoke execute on function private.serialize_cash_session_open()
  from public, anon, authenticated;

drop trigger if exists cash_sessions_serialize_open on public.cash_sessions;
create trigger cash_sessions_serialize_open
before insert on public.cash_sessions
for each row execute function private.serialize_cash_session_open();

create or replace function public.open_cash_session(
  p_store uuid,
  p_float integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_role text;
  v_session_id uuid;
  v_shift_label text;
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
  if p_float is null or p_float < 0 then
    raise exception 'invalid_opening_float' using errcode = 'P0007';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('cash_session:' || p_store::text, 0)
  );
  if exists (
    select 1 from public.cash_sessions cs
    where cs.store_id = p_store and cs.closed_at is null
  ) then
    raise exception 'session_already_open' using errcode = 'P0030';
  end if;

  v_shift_label := 'Turno ' ||
    to_char(pg_catalog.now() at time zone 'Africa/Maputo', 'DD/MM/YYYY HH24:MI');

  insert into public.cash_sessions (
    store_id, shift_label, opening_float_cents, opened_by
  ) values (
    p_store, v_shift_label, p_float, v_uid
  ) returning id into v_session_id;

  insert into public.event_log (store_id, actor_user_id, type, payload)
  values (
    p_store,
    v_uid,
    'cash.session_opened',
    jsonb_build_object(
      'session_id', v_session_id,
      'shift_label', v_shift_label,
      'opening_float_cents', p_float
    )
  );

  return v_session_id;
end;
$$;

revoke all on function public.open_cash_session(uuid, integer)
  from public, anon;
grant execute on function public.open_cash_session(uuid, integer)
  to authenticated, service_role;

create or replace function public.add_cash_movement(
  p_store uuid,
  p_type text,
  p_amount_cents integer,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_role text;
  v_session_id uuid;
  v_movement_id uuid;
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
  if p_type is null or p_type not in ('sangria', 'reforco', 'despesa', 'troco_inicial') then
    raise exception 'invalid_cash_movement_type' using errcode = 'P0007';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'invalid_cash_movement_amount' using errcode = 'P0007';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'cash_movement_reason_required' using errcode = 'P0007';
  end if;

  select cs.id into v_session_id
  from public.cash_sessions cs
  where cs.store_id = p_store and cs.closed_at is null
  for update;
  if v_session_id is null then
    raise exception 'no_open_session' using errcode = 'P0032';
  end if;

  insert into public.cash_movements (
    session_id, store_id, type, amount_cents, reason, created_by
  ) values (
    v_session_id, p_store, p_type, p_amount_cents, btrim(p_reason), v_uid
  ) returning id into v_movement_id;

  insert into public.event_log (store_id, actor_user_id, type, payload)
  values (
    p_store,
    v_uid,
    'cash.movement_added',
    jsonb_build_object(
      'session_id', v_session_id,
      'movement_id', v_movement_id,
      'movement_type', p_type,
      'amount_cents', p_amount_cents,
      'reason', btrim(p_reason)
    )
  );

  return v_movement_id;
end;
$$;

revoke all on function public.add_cash_movement(uuid, text, integer, text)
  from public, anon;
grant execute on function public.add_cash_movement(uuid, text, integer, text)
  to authenticated, service_role;

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

-- As variantes herdadas são single-tenant e permanecem inacessíveis à app.
revoke all on function public.open_cash_session() from public, anon, authenticated;
revoke all on function public.close_cash_session(integer, text) from public, anon, authenticated;
