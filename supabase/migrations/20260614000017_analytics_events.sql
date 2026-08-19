-- ============================================================================
-- DELIVERY OS — F4.4: First-party analytics events + funil de conversão
-- Ref: CLAUDE.md secções 16.6, 16.9
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Tabela analytics_events (append-only)
-- INSERT: só via /api/track com service role — anon nunca direto.
-- SELECT: só authenticated (painel Análise).
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.analytics_events (
  id             bigserial primary key,
  session_id     text not null,
  customer_phone text null,
  type           text not null,
  value_cents    int  null check (value_cents is null or value_cents >= 0),
  utm            jsonb not null default '{}'::jsonb,
  payload        jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

alter table public.analytics_events enable row level security;

-- staff (authenticated) pode ler tudo
create policy "staff_select" on public.analytics_events
  for select to authenticated using (true);

-- anon: sem policy → INSERT/SELECT bloqueados.
-- O /api/track insere com service_role que bypassa RLS — correto.

-- Índices para as queries do funil
create index if not exists analytics_events_type_idx       on public.analytics_events (type);
create index if not exists analytics_events_session_idx    on public.analytics_events (session_id);
create index if not exists analytics_events_created_at_idx on public.analytics_events (created_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- View: funil de conversão por sessão
-- Etapas: view_menu → begin_checkout → add_payment_info → purchase
-- ─────────────────────────────────────────────────────────────────────────────
create or replace view public.funnel_rates as
with sessions as (
  select
    session_id,
    bool_or(type = 'view_menu')        as saw_menu,
    bool_or(type = 'begin_checkout')   as began_checkout,
    bool_or(type = 'add_payment_info') as added_payment,
    bool_or(type = 'purchase')         as purchased
  from public.analytics_events
  group by session_id
)
select
  count(*)                                                             as total_sessions,
  count(*) filter (where saw_menu)                                    as step_menu,
  count(*) filter (where began_checkout)                              as step_checkout,
  count(*) filter (where added_payment)                               as step_payment,
  count(*) filter (where purchased)                                   as step_purchase,
  round(
    count(*) filter (where began_checkout)::numeric
    / nullif(count(*) filter (where saw_menu), 0) * 100, 1
  )                                                                    as pct_menu_to_checkout,
  round(
    count(*) filter (where added_payment)::numeric
    / nullif(count(*) filter (where began_checkout), 0) * 100, 1
  )                                                                    as pct_checkout_to_payment,
  round(
    count(*) filter (where purchased)::numeric
    / nullif(count(*) filter (where added_payment), 0) * 100, 1
  )                                                                    as pct_payment_to_purchase,
  round(
    count(*) filter (where purchased)::numeric
    / nullif(count(*) filter (where saw_menu), 0) * 100, 1
  )                                                                    as pct_overall
from sessions;

-- ─────────────────────────────────────────────────────────────────────────────
-- View: origem (utm_source) com funil por fonte
-- ─────────────────────────────────────────────────────────────────────────────
create or replace view public.funnel_by_source as
select
  coalesce(nullif(trim(utm->>'utm_source'), ''), 'direto') as source,
  count(distinct session_id)                                as sessions,
  count(distinct session_id) filter (where type = 'purchase') as purchases,
  coalesce(sum(value_cents) filter (where type = 'purchase'), 0) as revenue_cents
from public.analytics_events
group by 1
order by sessions desc;

-- ─────────────────────────────────────────────────────────────────────────────
-- RPC get_funnel_metrics() — só authenticated/service_role.
-- Não grant a anon.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.get_funnel_metrics()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_funnel   jsonb;
  v_sources  jsonb;
begin
  select row_to_json(f)::jsonb into v_funnel from funnel_rates f limit 1;
  select coalesce(jsonb_agg(row_to_json(s)), '[]'::jsonb) into v_sources from funnel_by_source s;

  return jsonb_build_object(
    'funnel',     coalesce(v_funnel, '{}'::jsonb),
    'by_source',  v_sources
  );
end;
$$;

revoke all on function public.get_funnel_metrics() from public, anon;
grant execute on function public.get_funnel_metrics() to authenticated, service_role;
