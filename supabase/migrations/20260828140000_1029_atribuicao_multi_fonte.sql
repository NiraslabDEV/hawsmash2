-- HAWSMASH 2.0 — 1029: atribuicao multi-fonte (de onde veio cada venda).
--
-- O que existia: `analytics_events.utm` guardava a query string do momento do
-- evento e as views `funnel_by_source` agrupavam por `utm->>'utm_source'`.
-- Dois buracos tornavam isso inutilizavel na pratica:
--
--   1. o cookie `dl_session` era LIDO no /api/track mas nunca ESCRITO, logo
--      todas as sessoes eram 'unknown' e o funil era uma sessao gigante;
--   2. a origem so existia enquanto os parametros estivessem na URL — assim
--      que o cliente navegava, a campanha desaparecia e a compra ficava
--      "directa". Nenhuma venda estava ligada a origem que a trouxe.
--
-- Esta migration fecha o lado da base de dados: o evento passa a guardar
-- canal/fonte/campanha ja classificados (pelo servidor, nao pelo browser) e
-- cada pedido passa a ter a sua propria linha de atribuicao, com primeiro e
-- ultimo toque. O lado do cliente e o middleware + lib/attribution.ts.
--
-- Regra que manda aqui: a atribuicao e best-effort (CLAUDE.md §1.1). Falhar a
-- gravar de onde veio um pedido nunca pode impedir o pedido de existir — por
-- isso vive em tabela propria, escrita depois, e nao dentro de create_order.

-- ────────────────────────────────────────────────────────────────────────────
-- 1. analytics_events: canal classificado no servidor
-- ────────────────────────────────────────────────────────────────────────────

alter table public.analytics_events add column if not exists channel       text;
alter table public.analytics_events add column if not exists source        text;
alter table public.analytics_events add column if not exists medium        text;
alter table public.analytics_events add column if not exists campaign      text;
alter table public.analytics_events add column if not exists referrer_host text;

create index if not exists analytics_events_channel_created_at_idx
  on public.analytics_events (channel, created_at desc);

create index if not exists analytics_events_source_created_at_idx
  on public.analytics_events (source, created_at desc);

-- ────────────────────────────────────────────────────────────────────────────
-- 2. order_attribution: uma linha por pedido, imutavel depois de escrita
--
-- Primeiro e ultimo toque guardam-se os dois de proposito. O Instagram que
-- apresentou a marca e o WhatsApp que fechou o pedido merecem credito
-- diferente; um so campo obrigaria a escolher um modelo para sempre.
-- ────────────────────────────────────────────────────────────────────────────

create table if not exists public.order_attribution (
  order_id       uuid primary key references public.orders(id) on delete cascade,
  store_id       uuid references public.stores(id) on delete set null,
  session_id     text,

  -- toque efectivo (ultimo toque com origem — o modelo por omissao)
  channel        text not null default 'direct',
  source         text not null default 'direto',
  medium         text not null default '(nenhum)',
  campaign       text,
  content        text,
  term           text,
  referrer_host  text,
  landing_path   text,

  -- primeiro toque, para o relatorio de descoberta
  first_channel  text,
  first_source   text,
  first_campaign text,

  -- gclid/fbclid/ttclid... e o que permite reconciliar com o Ads e o Meta
  click_ids      jsonb not null default '{}'::jsonb,
  first_touch    jsonb,
  last_touch     jsonb,

  created_at     timestamptz not null default now()
);

create index if not exists order_attribution_store_created_at_idx
  on public.order_attribution (store_id, created_at desc);
create index if not exists order_attribution_channel_idx
  on public.order_attribution (channel);
create index if not exists order_attribution_campaign_idx
  on public.order_attribution (campaign) where campaign is not null;

alter table public.order_attribution enable row level security;

-- Leitura: so quem ja pode ver aquela loja (CLAUDE.md regra 3).
drop policy if exists order_attribution_staff_select on public.order_attribution;
create policy order_attribution_staff_select on public.order_attribution
  for select to authenticated
  using (store_id is null or private.auth_can_store(store_id));

-- Escrita: ninguem directamente. So a RPC security definer abaixo.
revoke all on table public.order_attribution from anon, authenticated;
grant select on table public.order_attribution to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. record_order_attribution — chamada pelo checkout logo apos create_order
--
-- Aberta a anon porque o checkout publico e anonimo, mas fechada por tres
-- lados: so aceita um pedido que existe, so nos primeiros 30 minutos de vida
-- desse pedido, e so uma vez (on conflict do nothing). Sem isso, alguem podia
-- reescrever a origem de vendas antigas e envenenar o relatorio.
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.record_order_attribution(
  p_order_id uuid,
  p_payload  jsonb
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_order   record;
  v_first   jsonb := p_payload -> 'first_touch';
  v_last    jsonb := p_payload -> 'last_touch';
begin
  select id, store_id, created_at into v_order
  from public.orders
  where id = p_order_id;

  if not found then
    return; -- best-effort: nunca rebenta o checkout
  end if;

  if v_order.created_at < now() - interval '30 minutes' then
    return;
  end if;

  insert into public.order_attribution (
    order_id, store_id, session_id,
    channel, source, medium, campaign, content, term,
    referrer_host, landing_path,
    first_channel, first_source, first_campaign,
    click_ids, first_touch, last_touch
  )
  values (
    v_order.id,
    v_order.store_id,
    nullif(left(coalesce(p_payload ->> 'session_id', ''), 64), ''),
    coalesce(nullif(left(coalesce(p_payload ->> 'channel', ''), 40), ''), 'direct'),
    coalesce(nullif(left(coalesce(p_payload ->> 'source', ''), 120), ''), 'direto'),
    coalesce(nullif(left(coalesce(p_payload ->> 'medium', ''), 120), ''), '(nenhum)'),
    nullif(left(coalesce(p_payload ->> 'campaign', ''), 200), ''),
    nullif(left(coalesce(p_payload ->> 'content', ''), 200), ''),
    nullif(left(coalesce(p_payload ->> 'term', ''), 200), ''),
    nullif(left(coalesce(p_payload ->> 'referrer_host', ''), 200), ''),
    nullif(left(coalesce(p_payload ->> 'landing_path', ''), 200), ''),
    nullif(left(coalesce(v_first ->> 'ch', ''), 40), ''),
    nullif(left(coalesce(v_first ->> 's', ''), 120), ''),
    nullif(left(coalesce(v_first ->> 'c', ''), 200), ''),
    coalesce(p_payload -> 'click_ids', '{}'::jsonb),
    v_first,
    v_last
  )
  on conflict (order_id) do nothing;
end;
$$;

revoke all on function public.record_order_attribution(uuid, jsonb) from public;
grant execute on function public.record_order_attribution(uuid, jsonb) to anon, authenticated, service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. get_attribution_report — o relatorio que o dono le
--
-- Receita vem de `orders` (dinheiro real, estados que ja contam), nunca do
-- evento 'purchase' do analytics: um pixel bloqueado nao pode fazer
-- desaparecer facturacao. Sessoes vem do analytics, que e onde vivem.
-- Venda de balcao entra como canal 'balcao' — nao veio de campanha nenhuma,
-- e fingir o contrario inflacionaria o "directo".
-- ────────────────────────────────────────────────────────────────────────────

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
    where o.status in ('paid', 'approved', 'in_preparation', 'ready', 'delivered')
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
  sessions_by_channel as (
    select
      coalesce(nullif(e.channel, ''), 'direct') as channel,
      count(distinct e.session_id) as sessions
    from public.analytics_events e
    where e.created_at >= v_from
      and e.created_at <  v_to
      and e.session_id is not null
      and e.session_id <> 'unknown'
      and (p_store_id is null or e.store_id = p_store_id)
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
    select count(distinct e.session_id)::int as sessions
    from public.analytics_events e
    where e.created_at >= v_from
      and e.created_at <  v_to
      and e.session_id is not null
      and e.session_id <> 'unknown'
      and (p_store_id is null or e.store_id = p_store_id)
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
