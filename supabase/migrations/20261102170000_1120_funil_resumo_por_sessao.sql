-- 1120: o funil da Análise deixa de reler todo o histórico a cada abertura.
--
-- Sintoma (02/11, relatório de Outubro): Análise → Aquisição mostrava "Alguns
-- dados de aquisição estão indisponíveis" — o funil não terminava dentro do
-- statement_timeout do `authenticated`.
--
-- Causa: `analytics_sessions` (1066/1073) é uma view que agrupa por sessão
-- TODOS os eventos alguma vez gravados e só depois filtra pelo período — o
-- filtro de data não desce abaixo do GROUP BY. Cada evento passa por
-- private.attr_resolve (plpgsql, várias regex) e get_funnel_metrics lia a view
-- duas vezes. O custo crescia com o histórico inteiro, mesmo em "24h": quanto
-- mais o site vende, mais cedo o painel deixa de abrir.
--
-- Correcção: o resumo de cada sessão vive numa tabela
-- (`analytics_session_stats`), mantida por trigger a cada evento e indexada
-- pelo início da sessão. O painel lê só as sessões do período. A view
-- `analytics_sessions` passa a ler a tabela — mesmas colunas, mesmo
-- significado, para quem já a usa.
--
-- O resumo é recalculado a partir dos eventos da sessão (não incrementado),
-- com a mesma regra da 1073: o que é exacto continua exacto.
--
-- Regra 1: resumir é best-effort. Uma falha ao resumir nunca rejeita o
-- evento (exception → warning); private.rebuild_analytics_sessions repõe.
--
-- Também muda: as sessões em get_attribution_report ("Origem das vendas")
-- passam a vir do mesmo resumo — sessões iniciadas no período, pelo canal do
-- primeiro toque normalizado. Antes contava-se a sessão em cada canal cru que
-- tocasse, e o cartão de sessões e o funil podiam mostrar números diferentes.

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Eventos online: a exclusão de pedidos POS passa a usar o índice
--
-- `o.id::text = payload->>'order_id'` obrigava a ler a tabela de pedidos
-- inteira; com o resumo por sessão isso aconteceria a cada evento gravado.
-- ────────────────────────────────────────────────────────────────────────────

create or replace function private.try_uuid(v text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when v ~* '^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$'
      then v::uuid
  end;
$$;
revoke all on function private.try_uuid(text) from public, anon;
grant execute on function private.try_uuid(text) to authenticated, service_role;

create or replace view public.online_analytics_events with (security_invoker=true) as
select e.id,e.session_id,e.created_at,e.type,e.value_cents,e.store_id,
       e.channel,e.source,e.medium,e.campaign,e.utm
from public.analytics_events e
where coalesce(e.payload->>'origin','online') <> 'pos'
  and e.type not in ('upsell_view','upsell_accept')
  and coalesce(e.channel,'') not in ('balcao','counter','pos')
  and not exists (
    select 1 from public.orders o
    where o.id = private.try_uuid(coalesce(e.payload->>'order_id',e.payload->>'orderId'))
      and private.is_pos_order(o.channel,o.client_sale_id)
  );
revoke all on public.online_analytics_events from public,anon;
grant select on public.online_analytics_events to authenticated,service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Uma linha por sessão
-- ────────────────────────────────────────────────────────────────────────────

create table if not exists public.analytics_session_stats (
  session_id     text primary key,
  started_at     timestamptz not null,
  store_id       uuid,
  channel        text,
  source         text,
  medium         text,
  campaign       text,
  saw_menu       boolean not null default false,
  added_to_cart  boolean not null default false,
  began_checkout boolean not null default false,
  added_payment  boolean not null default false,
  purchased      boolean not null default false,
  revenue_cents  bigint  not null default 0,
  updated_at     timestamptz not null default now()
);

create index if not exists analytics_session_stats_started_idx
  on public.analytics_session_stats (started_at desc);
create index if not exists analytics_session_stats_store_started_idx
  on public.analytics_session_stats (store_id, started_at desc);

-- A mesma leitura que analytics_events (1004): o dono vê tudo, incluindo o
-- tráfego antes da escolha de loja; o gerente só as sessões das suas lojas.
alter table public.analytics_session_stats enable row level security;
drop policy if exists analytics_session_stats_store_select on public.analytics_session_stats;
create policy analytics_session_stats_store_select on public.analytics_session_stats
for select to authenticated
using (
  (select private.auth_is_owner())
  or (store_id is not null and (select private.auth_can_store(store_id)))
);

-- Só se escreve pelas funções abaixo.
revoke all on public.analytics_session_stats from public, anon, authenticated, service_role;
grant select on public.analytics_session_stats to authenticated, service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Recalcular sessões a partir dos seus eventos
-- ────────────────────────────────────────────────────────────────────────────

create or replace function private.refresh_analytics_sessions(p_session_ids text[])
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_session_ids is null or cardinality(p_session_ids) = 0 then
    return 0;
  end if;

  with ev as (
    select e.id, e.session_id, e.created_at, e.type, e.value_cents, e.store_id,
           e.channel, e.source, e.medium, e.campaign, e.utm
    from public.online_analytics_events e
    where e.session_id = any(p_session_ids)
      and e.session_id <> 'unknown'   -- eventos anteriores ao cookie de sessão
  ),
  -- Primeiro toque da sessão: a origem do primeiro evento manda. Só esse se
  -- resolve, e cada combinação de origem uma única vez — attr_resolve custa
  -- milissegundos por chamada e era chamada para cada evento do histórico.
  first_touch as (
    select distinct on (f.session_id)
      f.session_id, f.channel, f.source, f.medium, f.campaign,
      -- attr_resolve só lê estas três chaves do utm.
      jsonb_build_object('utm_source',   f.utm->>'utm_source',
                         'utm_medium',   f.utm->>'utm_medium',
                         'utm_campaign', f.utm->>'utm_campaign') as utm,
      concat_ws(chr(31),
        coalesce(f.channel, chr(30)), coalesce(f.source, chr(30)),
        coalesce(f.medium, chr(30)), coalesce(f.campaign, chr(30)),
        coalesce(f.utm->>'utm_source', chr(30)), coalesce(f.utm->>'utm_medium', chr(30)),
        coalesce(f.utm->>'utm_campaign', chr(30))) as touch_key
    from ev f
    order by f.session_id, f.created_at, f.id
  ),
  touch as (
    select d.touch_key, r.channel, r.source, r.medium, r.campaign
    from (select distinct on (touch_key) * from first_touch) d
    cross join lateral private.attr_resolve(d.channel, d.source, d.medium, d.campaign, d.utm) r
  ),
  steps as (
    select
      session_id,
      min(created_at)                                                        as started_at,
      (array_agg(store_id order by created_at, id)
         filter (where store_id is not null))[1]                             as store_id,
      coalesce(bool_or(type = 'view_menu'), false)                           as saw_menu,
      coalesce(bool_or(type = 'add_to_cart'), false)                         as added_to_cart,
      coalesce(bool_or(type = 'begin_checkout'), false)                      as began_checkout,
      coalesce(bool_or(type = 'add_payment_info'), false)                    as added_payment,
      coalesce(bool_or(type = 'purchase'), false)                            as purchased,
      coalesce(sum(value_cents) filter (where type = 'purchase'), 0)::bigint as revenue_cents
    from ev
    group by session_id
  ),
  agg as (
    select s.*, t.channel, t.source, t.medium, t.campaign
    from steps s
    join first_touch f on f.session_id = s.session_id
    join touch t on t.touch_key = f.touch_key
  )
  insert into public.analytics_session_stats as t (
    session_id, started_at, store_id, channel, source, medium, campaign,
    saw_menu, added_to_cart, began_checkout, added_payment, purchased, revenue_cents
  )
  select session_id, started_at, store_id, channel, source, medium, campaign,
         saw_menu, added_to_cart, began_checkout, added_payment, purchased, revenue_cents
  from agg
  on conflict (session_id) do update set
    started_at     = excluded.started_at,
    store_id       = excluded.store_id,
    channel        = excluded.channel,
    source         = excluded.source,
    medium         = excluded.medium,
    campaign       = excluded.campaign,
    saw_menu       = excluded.saw_menu,
    added_to_cart  = excluded.added_to_cart,
    began_checkout = excluded.began_checkout,
    added_payment  = excluded.added_payment,
    purchased      = excluded.purchased,
    revenue_cents  = excluded.revenue_cents,
    updated_at     = now()
  where (t.started_at, t.store_id, t.channel, t.source, t.medium, t.campaign,
         t.saw_menu, t.added_to_cart, t.began_checkout, t.added_payment,
         t.purchased, t.revenue_cents)
        is distinct from
        (excluded.started_at, excluded.store_id, excluded.channel, excluded.source,
         excluded.medium, excluded.campaign, excluded.saw_menu, excluded.added_to_cart,
         excluded.began_checkout, excluded.added_payment, excluded.purchased,
         excluded.revenue_cents);
  get diagnostics v_count = row_count;

  -- Sessão sem eventos online (apagados, ou afinal do POS) sai do funil.
  delete from public.analytics_session_stats s
  where s.session_id = any(p_session_ids)
    and not exists (
      select 1 from public.online_analytics_events e
      where e.session_id = s.session_id
    );

  return v_count;
end;
$$;
revoke all on function private.refresh_analytics_sessions(text[]) from public, anon, authenticated;

-- Reparação: recalcula as sessões com eventos desde p_since (null = tudo).
create or replace function private.rebuild_analytics_sessions(p_since timestamptz default null)
returns integer
language sql
volatile
security definer
set search_path = ''
as $$
  select private.refresh_analytics_sessions(array(
    select e.session_id
    from public.analytics_events e
    where (p_since is null or e.created_at >= p_since)
      and e.session_id is not null
      and e.session_id <> 'unknown'
    union
    select s.session_id
    from public.analytics_session_stats s
    where p_since is null or s.started_at >= p_since
  ));
$$;
revoke all on function private.rebuild_analytics_sessions(timestamptz) from public, anon, authenticated;
grant execute on function private.rebuild_analytics_sessions(timestamptz) to service_role;

-- O trigger: cada evento recalcula a sua sessão.
create or replace function private.analytics_events_sync_session()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids text[];
begin
  if tg_op = 'DELETE' then
    v_ids := array[old.session_id];
  elsif tg_op = 'UPDATE' then
    v_ids := array[old.session_id, new.session_id];
  else
    v_ids := array[new.session_id];
  end if;

  v_ids := array(
    select distinct x from unnest(v_ids) x
    where x is not null and x <> 'unknown'
    order by x
  );
  if cardinality(v_ids) = 0 then
    return null;
  end if;

  begin
    -- Dois eventos da mesma sessão em paralelo: o segundo espera pelo commit
    -- do primeiro e recalcula já com ele (cada instrução vê o que está
    -- commitado). Sem isto, o último a escrever apagava o efeito do outro.
    perform pg_advisory_xact_lock(hashtextextended('analytics_session:' || x, 0))
    from unnest(v_ids) x
    order by x;

    perform private.refresh_analytics_sessions(v_ids);
  exception when others then
    -- Regra 1: o evento fica gravado mesmo que o resumo falhe.
    raise warning 'analytics_session_stats: % (%)', sqlerrm, sqlstate;
  end;

  return null;
end;
$$;
revoke all on function private.analytics_events_sync_session() from public, anon, authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Histórico: preenche antes do trigger, apanha o que entrou entretanto
--
-- O preenchimento corre sem trancar a tabela de eventos (o site continua a
-- gravar). O create trigger espera pelos inserts em curso; a seguir, recalcula
-- o que entrou durante o preenchimento.
-- ────────────────────────────────────────────────────────────────────────────

select private.rebuild_analytics_sessions(null);

drop trigger if exists analytics_events_sync_session on public.analytics_events;
create trigger analytics_events_sync_session
after insert or update or delete on public.analytics_events
for each row execute function private.analytics_events_sync_session();

select private.rebuild_analytics_sessions(now() - interval '1 hour');

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Quem lê: a view mantém o contrato, as RPCs lêem só o período
-- ────────────────────────────────────────────────────────────────────────────

create or replace view public.analytics_sessions
with (security_invoker = true)
as
select session_id, started_at, store_id, channel, source, medium, campaign,
       saw_menu, added_to_cart, began_checkout, added_payment, purchased,
       revenue_cents
from public.analytics_session_stats;

revoke all on public.analytics_sessions from public, anon;
grant select on public.analytics_sessions to authenticated, service_role;

create or replace function public.get_funnel_metrics(
  p_from     timestamptz default null,
  p_to       timestamptz default null,
  p_store_id uuid default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_from timestamptz := coalesce(p_from, now() - interval '30 days');
  v_to   timestamptz := coalesce(p_to, now() + interval '1 day');
  v_funnel  jsonb;
  v_sources jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated' using errcode = 'P0020';
  end if;

  if private.auth_role() not in ('owner', 'manager') then
    raise exception 'funnel_access_denied' using errcode = 'P0403';
  end if;

  if p_store_id is null then
    if not private.auth_is_owner() then
      raise exception 'funnel_access_denied' using errcode = 'P0403';
    end if;
  elsif not private.auth_can_store(p_store_id) then
    raise exception 'funnel_access_denied' using errcode = 'P0403';
  end if;

  if v_to <= v_from then
    raise exception 'invalid_period' using errcode = 'P0007';
  end if;

  select jsonb_build_object(
    'total_sessions', count(*),
    'step_menu',      count(*) filter (where saw_menu),
    'step_cart',      count(*) filter (where added_to_cart),
    'step_checkout',  count(*) filter (where began_checkout),
    'step_payment',   count(*) filter (where added_payment),
    'step_purchase',  count(*) filter (where purchased),
    'pct_menu_to_cart', round(
      count(*) filter (where added_to_cart)::numeric
      / nullif(count(*) filter (where saw_menu), 0) * 100, 1),
    -- Pode passar de 100%: o carrinho vive no browser e a sessão expira aos
    -- 30 min, por isso quem volta mais tarde faz checkout sem add_to_cart
    -- NESSA sessão. É cliente que volta, não é bug (RASTREIO.md §6.5).
    'pct_cart_to_checkout', round(
      count(*) filter (where began_checkout)::numeric
      / nullif(count(*) filter (where added_to_cart), 0) * 100, 1),
    'pct_checkout_to_payment', round(
      count(*) filter (where added_payment)::numeric
      / nullif(count(*) filter (where began_checkout), 0) * 100, 1),
    'pct_payment_to_purchase', round(
      count(*) filter (where purchased)::numeric
      / nullif(count(*) filter (where added_payment), 0) * 100, 1),
    'pct_overall', round(
      count(*) filter (where purchased)::numeric
      / nullif(count(*) filter (where saw_menu), 0) * 100, 1)
  )
  into v_funnel
  from public.analytics_session_stats s
  where s.started_at >= v_from
    and s.started_at <  v_to
    and (p_store_id is null or s.store_id = p_store_id);

  with g as (
    select
      channel, source, medium, campaign,
      count(*)::int                                  as sessions,
      count(*) filter (where added_to_cart)::int     as carts,
      count(*) filter (where began_checkout)::int    as checkouts,
      count(*) filter (where purchased)::int         as purchases,
      coalesce(sum(revenue_cents), 0)::bigint        as revenue_cents
    from public.analytics_session_stats s
    where s.started_at >= v_from
      and s.started_at <  v_to
      and (p_store_id is null or s.store_id = p_store_id)
    group by channel, source, medium, campaign
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'channel',       g.channel,
    'source',        g.source,
    'medium',        g.medium,
    'campaign',      g.campaign,
    'sessions',      g.sessions,
    'carts',         g.carts,
    'checkouts',     g.checkouts,
    'purchases',     g.purchases,
    'revenue_cents', g.revenue_cents,
    'pct_cart',      round(g.carts::numeric / nullif(g.sessions, 0) * 100, 1),
    'pct_conv',      round(g.purchases::numeric / nullif(g.sessions, 0) * 100, 1)
  ) order by g.sessions desc, g.revenue_cents desc), '[]'::jsonb)
  into v_sources
  from (select * from g order by sessions desc, revenue_cents desc limit 50) g;

  return jsonb_build_object(
    'period',    jsonb_build_object('from', v_from, 'to', v_to),
    'funnel',    v_funnel,
    'by_source', v_sources
  );
end;
$$;

revoke all on function public.get_funnel_metrics(timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.get_funnel_metrics(timestamptz, timestamptz, uuid) to authenticated;

create or replace function public.get_attribution_report(
  p_from     timestamptz default null,
  p_to       timestamptz default null,
  p_store_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from timestamptz := coalesce(p_from, now() - interval '30 days');
  v_to   timestamptz := coalesce(p_to, now() + interval '1 day');
  v_result jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated' using errcode = 'P0020';
  end if;

  if p_store_id is null then
    if not private.auth_is_owner() then
      raise exception 'attribution_access_denied' using errcode = 'P0403';
    end if;
  elsif not private.auth_can_store(p_store_id) then
    raise exception 'attribution_access_denied' using errcode = 'P0403';
  end if;

  if private.auth_role() not in ('owner', 'manager') then
    raise exception 'attribution_access_denied' using errcode = 'P0403';
  end if;

  if v_to <= v_from then
    raise exception 'invalid_period' using errcode = 'P0007';
  end if;

  with money_orders as (
    select o.id, o.store_id, o.total_cents, o.channel as order_channel
    from public.orders o
    where not private.is_pos_order(o.channel, o.client_sale_id)
      and o.status in ('paid', 'approved', 'in_preparation', 'ready', 'delivered')
      and o.created_at >= v_from
      and o.created_at <  v_to
      and (p_store_id is null or o.store_id = p_store_id)
  ),
  attributed as (
    select
      m.id,
      m.total_cents,
      case when m.order_channel = 'counter' then 'balcao'
           else coalesce(a.channel, 'direct') end as channel,
      case when m.order_channel = 'counter' then 'balcao'
           else coalesce(a.source, 'direto') end as source,
      case when m.order_channel = 'counter' then 'balcao'
           else coalesce(a.medium, '(nenhum)') end as medium,
      a.campaign,
      case when m.order_channel = 'counter' then 'balcao'
           else coalesce(a.first_channel, a.channel, 'direct') end as first_channel,
      case when m.order_channel = 'counter' then 'balcao'
           else coalesce(a.first_source, a.source, 'direto') end as first_source
    from money_orders m
    left join public.order_attribution a on a.order_id = m.id
  ),
  period_sessions as (
    select coalesce(nullif(s.channel, ''), 'direct') as channel
    from public.analytics_session_stats s
    where s.started_at >= v_from
      and s.started_at <  v_to
      and (p_store_id is null or s.store_id = p_store_id)
  ),
  sessions_by_channel as (
    select channel, count(*) as sessions
    from period_sessions
    group by 1
  ),
  orders_by_channel as (
    select channel,
           count(*)::int as orders,
           coalesce(sum(total_cents), 0)::bigint as revenue_cents
    from attributed
    group by 1
  ),
  by_channel as (
    select
      coalesce(o.channel, s.channel) as channel,
      coalesce(s.sessions, 0)::int   as sessions,
      coalesce(o.orders, 0)          as orders,
      coalesce(o.revenue_cents, 0)   as revenue_cents
    from orders_by_channel o
    full outer join sessions_by_channel s on s.channel = o.channel
  ),
  by_source as (
    select a.source, a.medium,
           count(*)::int as orders,
           coalesce(sum(a.total_cents), 0)::bigint as revenue_cents
    from attributed a
    group by 1, 2
  ),
  by_campaign as (
    select a.campaign, a.source, a.channel,
           count(*)::int as orders,
           coalesce(sum(a.total_cents), 0)::bigint as revenue_cents
    from attributed a
    where a.campaign is not null
    group by 1, 2, 3
  ),
  discovery as (
    select a.first_channel as channel,
           count(*)::int as orders,
           coalesce(sum(a.total_cents), 0)::bigint as revenue_cents
    from attributed a
    group by 1
  ),
  totals as (
    select
      count(*)::int as orders,
      coalesce(sum(total_cents), 0)::bigint as revenue_cents
    from attributed
  ),
  session_total as (
    select count(*)::int as sessions from period_sessions
  )
  select jsonb_build_object(
    'period', jsonb_build_object('from', v_from, 'to', v_to),
    'totals', jsonb_build_object(
      'orders',        (select orders from totals),
      'revenue_cents', (select revenue_cents from totals),
      'sessions',      (select sessions from session_total)
    ),
    'by_channel', coalesce((
      select jsonb_agg(jsonb_build_object(
        'channel',       c.channel,
        'sessions',      c.sessions,
        'orders',        c.orders,
        'revenue_cents', c.revenue_cents,
        'conversion_pct', case when c.sessions > 0
                               then round(c.orders::numeric / c.sessions * 100, 1)
                               else null end
      ) order by c.revenue_cents desc, c.sessions desc)
      from by_channel c
    ), '[]'::jsonb),
    'by_source', coalesce((
      select jsonb_agg(jsonb_build_object(
        'source',        s.source,
        'medium',        s.medium,
        'orders',        s.orders,
        'revenue_cents', s.revenue_cents
      ) order by s.revenue_cents desc)
      from by_source s
    ), '[]'::jsonb),
    'by_campaign', coalesce((
      select jsonb_agg(jsonb_build_object(
        'campaign',      k.campaign,
        'source',        k.source,
        'channel',       k.channel,
        'orders',        k.orders,
        'revenue_cents', k.revenue_cents
      ) order by k.revenue_cents desc)
      from by_campaign k
    ), '[]'::jsonb),
    'discovery', coalesce((
      select jsonb_agg(jsonb_build_object(
        'channel',       d.channel,
        'orders',        d.orders,
        'revenue_cents', d.revenue_cents
      ) order by d.revenue_cents desc)
      from discovery d
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_attribution_report(timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.get_attribution_report(timestamptz, timestamptz, uuid) to authenticated;

notify pgrst, 'reload schema';
