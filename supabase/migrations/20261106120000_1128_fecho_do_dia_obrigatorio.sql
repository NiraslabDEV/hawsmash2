-- 1128 — o dia só muda com o fecho do dia, e o caixa não fecha com mesa aberta.
--
-- Pedido da loja (Nov/2026): a caixa fechou o segundo turno, esqueceu-se do
-- fecho do dia e, na manhã seguinte, abriu outro turno por cima. O fecho seguinte
-- juntou dois dias. E uma mesa por pagar ficava para trás sem ninguém dar conta.
--
-- 1. O turno e o dia recusam fechar com mesa por pagar (`tables_open:N,M`).
--    Não é só disciplina: o fecho do turno conta o dinheiro pela hora do PEDIDO,
--    por isso uma mesa aberta num turno e paga no seguinte não entrava no
--    esperado de nenhum dos dois. Com o bloqueio, isso deixa de acontecer.
--
-- 2. Não se abre um turno noutra data com o dia anterior por fechar
--    (`day_close_required`). A venda NÃO passa por aqui: o auto-open de
--    create_counter_sale e de close_table_bill continua igual, porque uma venda
--    offline que chega de manhã nunca pode ser recusada (Regra 1). É o POS que
--    guia a caixa ao fecho antes de vender, com rede.
--
-- 3. A conta da mesa deixa de morrer à meia-noite: vive até ao fecho do dia, a
--    mesma fronteira do "Dia actual" dos pedidos (1110). Sem isto, a mesa aberta
--    desaparecia à meia-noite e o bloqueio do ponto 1 não a via.
--
-- O relógio não muda: cada venda continua com a hora real, e os relatórios por
-- data continuam a ser de calendário. O que fica parado é o dia de trabalho.
--
-- Forward-only: substitui quatro funções (1007, 1081, 1091, 1095) e junta três.

-- ---------------------------------------------------------------------------
-- 1. O corte: o que já estava para trás não volta
-- ---------------------------------------------------------------------------
-- Até aqui a conta acabava à meia-noite. Sem este corte, os pedidos antigos que
-- ficaram por pagar reapareciam na mesa e prendiam o caixa na primeira noite.
-- Continuam na base como estavam; só não entram na conta corrente.
alter table public.stores
  add column if not exists tabs_carry_from timestamptz not null
    default (date_trunc('day', now() at time zone 'Africa/Maputo') at time zone 'Africa/Maputo');

comment on column public.stores.tabs_carry_from is
  'A conta da mesa não olha para pedidos anteriores a isto (1128): os que ficaram por pagar antes da regra do fecho do dia.';

-- ---------------------------------------------------------------------------
-- 2. A conta aberta vive até ao fecho do dia
-- ---------------------------------------------------------------------------
create or replace function private.store_day_started_at(p_store uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  -- greatest ignora o null: sem nenhum fecho do dia, conta o corte.
  select greatest(
    s.tabs_carry_from,
    (select max(c.closed_at) from public.cash_day_closes c where c.store_id = p_store)
  )
  from public.stores s
  where s.id = p_store;
$$;

revoke all on function private.store_day_started_at(uuid) from public, anon, authenticated;

create or replace function private.table_tab_order_ids(p_store_id uuid, p_table_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select o.id
  from public.orders o
  where o.store_id = p_store_id
    and o.table_id = p_table_id
    and o.fulfillment_type = 'dine_in'
    and o.table_bill_id is null
    and o.status in ('in_preparation', 'ready', 'delivered')
    and o.created_at >= private.store_day_started_at(p_store_id)
  order by o.created_at, o.id;
$$;

revoke all on function private.table_tab_order_ids(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. As mesas por pagar da loja
-- ---------------------------------------------------------------------------
-- Uma conta a zero fica de fora: o close_table_bill não a cobra
-- (table_has_no_open_orders), e prendia o caixa sem saída.
create or replace function private.store_open_tabs(p_store uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object('number', t.number, 'total_cents', tab.total_cents)
    order by t.number
  ), '[]'::jsonb)
  from public.tables t
  cross join lateral (
    select coalesce(sum(o.total_cents), 0)::bigint as total_cents
    from private.table_tab_order_ids(p_store, t.id) x(id)
    join public.orders o on o.id = x.id
  ) tab
  where t.store_id = p_store
    and tab.total_cents > 0;
$$;

revoke all on function private.store_open_tabs(uuid) from public, anon, authenticated;

-- A mensagem leva os números: é a frase que o caixa precisa de ler.
create or replace function private.refuse_if_tables_open(p_store uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_numbers text;
begin
  select string_agg(mesa ->> 'number', ',' order by (mesa ->> 'number')::integer)
  into v_numbers
  from jsonb_array_elements(private.store_open_tabs(p_store)) mesa;
  if v_numbers is not null then
    raise exception 'tables_open:%', v_numbers using errcode = 'P0036';
  end if;
end;
$$;

revoke all on function private.refuse_if_tables_open(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Abrir turno (1007), com o dia por fechar a travar
-- ---------------------------------------------------------------------------
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

  -- (1128) Um turno novo noutra data não entra por cima de um dia por fechar.
  -- Só aqui: o auto-open da venda não passa por esta função (Regra 1).
  if exists (
    select 1 from public.cash_sessions cs
    where cs.store_id = p_store
      and cs.closed_at is not null
      and cs.day_close_id is null
      and (cs.opened_at at time zone 'Africa/Maputo')::date
        < (pg_catalog.now() at time zone 'Africa/Maputo')::date
  ) then
    raise exception 'day_close_required' using errcode = 'P0037';
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

revoke all on function public.open_cash_session(uuid, integer) from public, anon;
grant execute on function public.open_cash_session(uuid, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Fechar turno (1095), com as mesas a travar
-- ---------------------------------------------------------------------------
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

  -- (1128) Antes da contagem: a mesa por pagar é a primeira coisa a resolver.
  perform private.refuse_if_tables_open(p_store);

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

revoke all on function public.close_cash_session(uuid, integer, text) from public, anon;
grant execute on function public.close_cash_session(uuid, integer, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Fechar o dia (1091), com as mesas a travar
-- ---------------------------------------------------------------------------
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

  -- (1128) Depois do repetido: um fecho já feito devolve-se sempre (Regra 4).
  perform private.refuse_if_tables_open(p_store);

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

-- ---------------------------------------------------------------------------
-- 7. O que o POS lê (1091): o dia de trabalho, se está atrasado, e as mesas
-- ---------------------------------------------------------------------------
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
  v_today date := (pg_catalog.now() at time zone 'Africa/Maputo')::date;
  v_business_date date;
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

  -- (1128) O dia de trabalho é o do primeiro turno que ainda não entrou num
  -- fecho do dia; sem nenhum, é o de hoje.
  select (min(cs.opened_at) at time zone 'Africa/Maputo')::date
  into v_business_date
  from public.cash_sessions cs
  where cs.store_id = p_store and cs.day_close_id is null;
  v_business_date := coalesce(v_business_date, v_today);

  return jsonb_build_object(
    'store_id', p_store,
    'business_date', v_business_date,
    -- DECISÃO: um turno que ainda está aberto passa a meia-noite sem aviso (a
    -- loja pode estar a servir). Só às 06:00 — nenhuma loja vende a essa hora —
    -- se conclui que ficou esquecido. Sem turno aberto, atrasa logo.
    'day_overdue', v_business_date < v_today and (
      v_open is null
      or (pg_catalog.now() at time zone 'Africa/Maputo')::time >= time '06:00'
    ),
    'open_tables', private.store_open_tabs(p_store),
    'open_session', v_open,
    'pending', case when v_sessions is null then null
      else private.cash_day_report(p_store, v_sessions) end,
    'last_day_close', v_last
  );
end;
$$;

revoke all on function public.get_cash_day(uuid) from public, anon;
grant execute on function public.get_cash_day(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
