-- HAWSMASH 2.0 — 1066: funil por origem, normalizado, por loja e por período.
--
-- Trazido do SLICE (docs/RASTREIO.md), onde foi afinado com dados reais de
-- anúncios. O que estava errado aqui:
--
--   1. `funnel_rates` e `funnel_by_source` eram views SECURITY DEFINER (o
--      default do Postgres): corriam como o dono e saltavam a RLS de
--      `analytics_events`. Um gerente da Matola via o funil de Maputo — regra 3
--      do CLAUDE.md. O PLANO-LIVE já as tinha anotado.
--   2. Não excluíam `session_id = 'unknown'` (eventos anteriores ao cookie de
--      sessão) — uma "sessão" gigante no topo do funil.
--   3. Faltava a etapa do carrinho: saltava-se de "viu o cardápio" para
--      "iniciou checkout", escondendo a maior fuga.
--   4. A origem agrupava por `utm->>'utm_source'` cru, ignorando o canal que
--      o servidor já classifica desde a 1029. E sem normalizar: `MetaAds`,
--      `fb`, `120250536398130239` e `{{campaign.id}}` eram quatro linhas para
--      o mesmo anúncio, com o nome da campanha no campo do meio.
--   5. Sem período nem loja: o funil era sempre "desde sempre, tudo junto".
--
-- Normalizar em dois sítios (RASTREIO.md §6.7): apps/web/lib/attribution.ts
-- grava os eventos novos já limpos e é a fonte de verdade. As funções abaixo
-- repetem a mesma tabela de equivalências para o histórico já gravado — a
-- tabela é append-only, não se reescreve com UPDATE. Mexer numa obriga a
-- mexer na outra.

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Normalização (pura, imutável)
-- ────────────────────────────────────────────────────────────────────────────

-- '+' vira espaço, espaços colapsam, minúsculas; placeholders são ausência.
create or replace function private.attr_clean(v text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when c is null then null
    when c like '%{{%' or c like '%}}%' then null
    when c ~ '^(--sanitized--|\(?(not set|not provided)\)?|undefined|null|none|-+)$' then null
    else c
  end
  from (
    select nullif(btrim(regexp_replace(replace(lower(coalesce(v, '')), '+', ' '), '\s+', ' ', 'g')), '') as c
  ) t;
$$;

-- Id numérico de campanha do Meta: não é origem, mas prova que é anúncio.
create or replace function private.attr_is_meta_id(v text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(btrim(v) ~ '^\d{6,}$', false);
$$;

-- Fonte canónica, ou null quando o valor não serve como fonte.
create or replace function private.attr_norm_source(v text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when s is null or private.attr_is_meta_id(s) then null
    when s in ('metaads', 'meta', 'meta ads', 'meta-ads', 'fb', 'fbads', 'fb ads',
               'facebook ads', 'facebook_ads', 'facebook-ads', 'facebook.com',
               'm.facebook.com', 'l.facebook.com', 'lm.facebook.com') then 'facebook'
    when s in ('ig', 'insta', 'ig ads', 'instagram ads', 'instagram_feed', 'igshopping',
               'instagram.com', 'l.instagram.com') then 'instagram'
    when s in ('an', 'audience network') then 'audience_network'
    when s in ('msg', 'messenger.com') then 'messenger'
    when s in ('googleads', 'google ads', 'google_ads', 'adwords',
               'google.com', 'google.co.mz') then 'google'
    when s in ('wa', 'zap', 'whatsapp business', 'wa.me', 'whatsapp.com',
               'api.whatsapp.com') then 'whatsapp'
    when s in ('tik tok', 'tiktokads', 'tt', 'tiktok.com', 'vm.tiktok.com') then 'tiktok'
    when s in ('chatgpt.com', 'chat.openai.com', 'openai') then 'chatgpt'
    when s in ('x.com', 'twitter.com', 't.co') then 'x'
    when s in ('youtube.com', 'youtu.be', 'yt') then 'youtube'
    when s in ('qrcode', 'qr-code', 'qr_code') then 'qr'
    else s
  end
  from (select regexp_replace(private.attr_clean(v), '^www\.', '') as s) t;
$$;

-- Meio canónico. '' = sem meio; null = não é um meio (é nome de campanha).
create or replace function private.attr_norm_medium(v text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when m is null then ''
    when m in ('(nenhum)', 'direct', 'direto', 'directo') then ''
    when m in ('cpc', 'ppc', 'cpm', 'paid', 'ads', 'ad', 'anuncio', 'anúncio',
               'sem', 'paidsearch', 'paid_search') then 'cpc'
    when m in ('paid_social', 'paidsocial', 'paid social', 'paid-social', 'social_paid') then 'paid_social'
    when m in ('display', 'banner', 'retargeting', 'remarketing') then m
    when m in ('social', 'rede social', 'socialmedia', 'social media', 'social_media',
               'organic_social', 'social_organic', 'stories', 'bio', 'ig', 'fb') then 'social'
    when m in ('organic', 'organico', 'orgânico', 'search', 'seo') then 'organic'
    when m in ('ai', 'ia', 'llm') then 'ai'
    when m in ('email', 'e-mail', 'mail', 'newsletter') then 'email'
    when m in ('sms', 'mensagem') then 'sms'
    when m in ('qr', 'qrcode', 'qr_code', 'mesa', 'cartaz', 'flyer', 'print') then 'qr'
    when m in ('influencer', 'creator', 'parceria', 'partner') then 'influencer'
    when m in ('referral', 'indicacao', 'indicação') then 'referral'
    else null
  end
  from (select private.attr_clean(v) as m) t;
$$;

-- Canal a partir de fonte + meio já normalizados (espelha classifyChannel).
create or replace function private.attr_channel(p_source text, p_medium text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_medium = 'cpc' then
      case when p_source in ('instagram', 'facebook', 'audience_network', 'messenger', 'tiktok',
                             'x', 'youtube', 'linkedin', 'threads', 'telegram', 'snapchat',
                             'pinterest', 'reddit')
           then 'paid_social' else 'paid_search' end
    when p_medium in ('paid_social', 'display', 'banner', 'retargeting', 'remarketing') then 'paid_social'
    when p_medium = 'email' then 'email'
    when p_medium = 'sms' then 'sms'
    when p_medium = 'qr' then 'qr'
    when p_medium = 'influencer' then 'influencer'
    when p_medium = 'ai' then 'ai_assistant'
    when p_medium = 'social' then
      case when p_source = 'whatsapp' then 'whatsapp' else 'organic_social' end
    when p_medium = 'referral' then 'referral'
    when p_source = 'whatsapp' then 'whatsapp'
    when p_source = 'qr' or p_source like 'qr\_%' then 'qr'
    when p_source in ('chatgpt', 'perplexity', 'gemini', 'copilot', 'claude', 'meta.ai') then 'ai_assistant'
    when p_source in ('instagram', 'facebook', 'audience_network', 'messenger', 'tiktok',
                      'x', 'youtube', 'linkedin', 'threads', 'telegram', 'snapchat',
                      'pinterest', 'reddit') then 'organic_social'
    when p_source in ('google', 'bing', 'yahoo', 'duckduckgo', 'yandex', 'ecosia', 'brave')
      then 'organic_search'
    when p_source in ('direto', 'interno') then 'direct'
    else 'referral'
  end;
$$;

-- Resolve um evento para (canal, fonte, meio, campanha). As colunas que o
-- servidor grava desde a 1029 mandam; o `utm` do corpo só cobre o que é
-- anterior a elas.
create or replace function private.attr_resolve(
  p_channel  text,
  p_source   text,
  p_medium   text,
  p_campaign text,
  p_utm      jsonb,
  out channel  text,
  out source   text,
  out medium   text,
  out campaign text
)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_src_raw  text := private.attr_clean(coalesce(p_source, p_utm ->> 'utm_source'));
  v_med_raw  text := private.attr_clean(coalesce(p_medium, p_utm ->> 'utm_medium'));
  v_camp_raw text := private.attr_clean(coalesce(p_campaign, p_utm ->> 'utm_campaign'));
  v_src      text := private.attr_norm_source(v_src_raw);
  v_med      text := private.attr_norm_medium(v_med_raw);
  v_meta     boolean;
begin
  -- Valores de enchimento antigos não são fontes.
  if v_src in ('desconhecido') then v_src := null; end if;

  source := coalesce(v_src,
                     case when private.attr_is_meta_id(v_src_raw) then 'facebook' end,
                     'direto');

  v_meta := private.attr_is_meta_id(v_src_raw)
            or (v_src_raw is not null
                and source in ('facebook', 'instagram', 'audience_network', 'messenger'));

  medium := coalesce(nullif(v_med, ''),
                     case when v_meta and source <> 'direto' then 'cpc' end,
                     '(nenhum)');

  -- O nome que o anúncio pôs no meio é, na prática, o nome da campanha — e
  -- ganha ao id numérico, porque é o que o dono reconhece.
  campaign := case
    when v_camp_raw is not null and not private.attr_is_meta_id(v_camp_raw) then v_camp_raw
    when v_med is null and v_med_raw is not null then v_med_raw
    when v_camp_raw is not null then v_camp_raw
    when v_src is null and private.attr_is_meta_id(v_src_raw) then v_src_raw
  end;

  -- Canal específico gravado pelo servidor fica (gclid, QR, WhatsApp...).
  -- 'direct'/'referral' são o que a classificação antiga fazia ao lixo dos
  -- anúncios, por isso esses recalculam-se a partir do normalizado.
  channel := case
    when p_channel is not null and p_channel not in ('direct', 'referral', 'internal')
      then p_channel
    else private.attr_channel(source, medium)
  end;

  -- Link etiquetado sem meio: o TS grava 'referral' (buildTouch).
  if medium = '(nenhum)' and channel = 'referral' then medium := 'referral'; end if;
end;
$$;

revoke all on function private.attr_clean(text) from public, anon;
revoke all on function private.attr_is_meta_id(text) from public, anon;
revoke all on function private.attr_norm_source(text) from public, anon;
revoke all on function private.attr_norm_medium(text) from public, anon;
revoke all on function private.attr_channel(text, text) from public, anon;
revoke all on function private.attr_resolve(text, text, text, text, jsonb) from public, anon;
grant execute on function private.attr_clean(text) to authenticated, service_role;
grant execute on function private.attr_is_meta_id(text) to authenticated, service_role;
grant execute on function private.attr_norm_source(text) to authenticated, service_role;
grant execute on function private.attr_norm_medium(text) to authenticated, service_role;
grant execute on function private.attr_channel(text, text) to authenticated, service_role;
grant execute on function private.attr_resolve(text, text, text, text, jsonb) to authenticated, service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Uma linha por sessão — a base de todo o funil
--
-- security_invoker: corre com a RLS de quem lê. O gerente só vê as sessões
-- das suas lojas; o tráfego antes da escolha de loja (store_id nulo) só o
-- dono o vê — exactamente a policy de analytics_events (1004).
-- ────────────────────────────────────────────────────────────────────────────

drop view if exists public.funnel_by_source;
drop view if exists public.funnel_rates;
drop view if exists public.analytics_sessions;

create view public.analytics_sessions
with (security_invoker = true)
as
with ev as (
  select e.id, e.session_id, e.created_at, e.type, e.value_cents, e.store_id,
         r.channel, r.source, r.medium, r.campaign
  from public.analytics_events e
  cross join lateral private.attr_resolve(e.channel, e.source, e.medium, e.campaign, e.utm) r
  where e.session_id is not null
    and e.session_id <> 'unknown'   -- eventos anteriores ao cookie de sessão
)
select
  session_id,
  min(created_at)                                                        as started_at,
  (array_agg(store_id order by created_at, id)
     filter (where store_id is not null))[1]                             as store_id,
  -- Primeiro toque da sessão: a origem do primeiro evento manda.
  (array_agg(channel  order by created_at, id))[1]                       as channel,
  (array_agg(source   order by created_at, id))[1]                       as source,
  (array_agg(medium   order by created_at, id))[1]                       as medium,
  (array_agg(campaign order by created_at, id))[1]                       as campaign,
  bool_or(type = 'view_menu')                                            as saw_menu,
  bool_or(type = 'add_to_cart')                                          as added_to_cart,
  bool_or(type = 'begin_checkout')                                       as began_checkout,
  bool_or(type = 'add_payment_info')                                     as added_payment,
  bool_or(type = 'purchase')                                             as purchased,
  coalesce(sum(value_cents) filter (where type = 'purchase'), 0)::bigint as revenue_cents
from ev
group by session_id;

revoke all on public.analytics_sessions from public, anon;
grant select on public.analytics_sessions to authenticated, service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. get_funnel_metrics(período, loja) — o que a aba Análise lê
--
-- Substitui a versão sem argumentos (as duas juntas tornavam a chamada
-- ambígua). Mesmas regras de acesso que get_attribution_report (1029):
-- "Todas" é só do dono; o gerente escolhe uma loja sua.
-- ────────────────────────────────────────────────────────────────────────────

drop function if exists public.get_funnel_metrics();

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

  with s as (
    select *
    from public.analytics_sessions a
    where a.started_at >= v_from
      and a.started_at <  v_to
      and (p_store_id is null or a.store_id = p_store_id)
  )
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
  from s;

  with s as (
    select *
    from public.analytics_sessions a
    where a.started_at >= v_from
      and a.started_at <  v_to
      and (p_store_id is null or a.store_id = p_store_id)
  ),
  g as (
    select
      channel, source, medium, campaign,
      count(*)::int                                  as sessions,
      count(*) filter (where added_to_cart)::int     as carts,
      count(*) filter (where began_checkout)::int    as checkouts,
      count(*) filter (where purchased)::int         as purchases,
      coalesce(sum(revenue_cents), 0)::bigint        as revenue_cents
    from s
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
