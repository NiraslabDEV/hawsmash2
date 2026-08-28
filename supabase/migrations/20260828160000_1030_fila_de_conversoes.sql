-- HAWSMASH 2.0 — 1030: fila de conversões (outbox) + identidade da venda.
--
-- O que existia: `fireConversions()` fazia `fetch()` fire-and-forget para a
-- Meta CAPI e para o Google Ads. Três problemas de fundo:
--
--   1. Se a Meta estivesse em baixo, ou a rede falhasse, a conversão
--      desaparecia. Não havia retoma. Uma venda real ficava invisível para
--      quem paga o anúncio que a gerou.
--   2. Nada impedia o envio duplicado: o webhook do Paysuite e o
--      /api/payments/verify podem ambos confirmar o mesmo pedido, e ambos
--      disparavam. A Meta deduplica por `event_id`, mas o evento `purchase`
--      first-party era inserido duas vezes — o funil contava a mais.
--   3. O upload para o Google Ads ia sem `gclid`. A API de click conversions
--      exige um identificador de clique; aquilo nunca podia ter funcionado.
--
-- A correcção é o padrão outbox: a conversão passa a ser uma LINHA antes de
-- ser um pedido HTTP. Falhar o envio passa a ser um estado com retoma, não um
-- evento perdido — a mesma doutrina de `print_jobs` (§8.1), aplicada ao
-- marketing. `unique (order_id, destination)` entra na lista fechada de
-- idempotência do §11.2.

-- ────────────────────────────────────────────────────────────────────────────
-- 1. O que o pedido sabe sobre o cliente, no momento em que ele comprou
--
-- A Meta chama a isto "match quality": quanto melhor a identificação, mais
-- conversões ela consegue atribuir ao anúncio certo. Nada disto é enviado em
-- claro — o telefone e o email vão sempre em SHA-256 (ver user-data.ts).
-- ────────────────────────────────────────────────────────────────────────────

alter table public.order_attribution add column if not exists fbp              text;
alter table public.order_attribution add column if not exists client_ip        text;
alter table public.order_attribution add column if not exists user_agent       text;
alter table public.order_attribution add column if not exists event_source_url text;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. conversion_jobs — a fila
-- ────────────────────────────────────────────────────────────────────────────

create table if not exists public.conversion_jobs (
  id              bigserial primary key,
  order_id        uuid not null references public.orders(id) on delete cascade,
  store_id        uuid references public.stores(id) on delete set null,
  destination     text not null check (destination in ('meta_capi', 'google_ads')),
  event_name      text not null default 'Purchase',
  value_cents     int  not null default 0 check (value_cents >= 0),

  status          text not null default 'pending'
                    check (status in ('pending', 'sent', 'failed', 'skipped')),
  attempts        int  not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error      text,
  response        jsonb,

  created_at      timestamptz not null default now(),
  sent_at         timestamptz,

  -- É isto que torna seguro chamar `fireConversions` duas vezes: o webhook e
  -- o /payments/verify podem correr os dois para o mesmo pedido.
  unique (order_id, destination)
);

create index if not exists conversion_jobs_due_idx
  on public.conversion_jobs (next_attempt_at)
  where status = 'pending';

create index if not exists conversion_jobs_store_status_idx
  on public.conversion_jobs (store_id, status, created_at desc);

alter table public.conversion_jobs enable row level security;

drop policy if exists conversion_jobs_staff_select on public.conversion_jobs;
create policy conversion_jobs_staff_select on public.conversion_jobs
  for select to authenticated
  using (store_id is null or private.auth_can_store(store_id));

revoke all on table public.conversion_jobs from anon, authenticated;
grant select on table public.conversion_jobs to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. enqueue_conversions — põe a venda na fila (idempotente)
--
-- Só para vendas online: o balcão não veio de anúncio nenhum e mandar uma
-- conversão de uma venda de balcão para a Meta ensinaria o algoritmo a
-- optimizar para tráfego que nunca existiu.
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.enqueue_conversions(p_order_id uuid)
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_order  record;
  v_gclid  text;
  v_count  int := 0;
begin
  select o.id, o.store_id, o.total_cents, o.channel, o.status
    into v_order
  from public.orders o
  where o.id = p_order_id;

  if not found then
    return 0;
  end if;

  if v_order.channel = 'counter' then
    return 0;
  end if;

  -- Só dinheiro real (mesma lista do relatório de atribuição).
  if v_order.status not in ('paid', 'approved', 'in_preparation', 'ready', 'delivered') then
    return 0;
  end if;

  insert into public.conversion_jobs (order_id, store_id, destination, value_cents)
  values (v_order.id, v_order.store_id, 'meta_capi', v_order.total_cents)
  on conflict (order_id, destination) do nothing;
  get diagnostics v_count = row_count;

  -- Google Ads só aceita uma conversão de clique se houver identificador de
  -- clique. Sem `gclid` não há nada para enviar — e fingir que há era o bug.
  select coalesce(
           a.click_ids ->> 'gclid',
           a.click_ids ->> 'gbraid',
           a.click_ids ->> 'wbraid'
         )
    into v_gclid
  from public.order_attribution a
  where a.order_id = v_order.id;

  if v_gclid is not null and v_gclid <> '' then
    insert into public.conversion_jobs (order_id, store_id, destination, value_cents)
    values (v_order.id, v_order.store_id, 'google_ads', v_order.total_cents)
    on conflict (order_id, destination) do nothing;
    v_count := v_count + 1;
  end if;

  return v_count;
end;
$$;

revoke all on function public.enqueue_conversions(uuid) from public, anon, authenticated;
grant execute on function public.enqueue_conversions(uuid) to service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 3b. record_server_purchase_event — o `purchase` do funil, uma só vez
--
-- O webhook do Paysuite e o /api/payments/verify podem confirmar o mesmo
-- pedido; antes disto, ambos inseriam um evento `purchase` e o funil contava
-- a venda duas vezes. `where not exists` resolve na própria transacção.
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.record_server_purchase_event(
  p_order_id    uuid,
  p_value_cents int
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_session text := 'server_' || p_order_id::text;
begin
  insert into public.analytics_events (session_id, type, value_cents, utm, payload, store_id, channel, source)
  select
    v_session,
    'purchase',
    greatest(coalesce(p_value_cents, 0), 0),
    '{}'::jsonb,
    jsonb_build_object('order_id', p_order_id, 'source', 'server'),
    o.store_id,
    coalesce(a.channel, case when o.channel = 'counter' then 'balcao' else 'direct' end),
    coalesce(a.source,  case when o.channel = 'counter' then 'balcao' else 'direto'  end)
  from public.orders o
  left join public.order_attribution a on a.order_id = o.id
  where o.id = p_order_id
    and not exists (
      select 1 from public.analytics_events e
      where e.session_id = v_session and e.type = 'purchase'
    );
end;
$$;

revoke all on function public.record_server_purchase_event(uuid, int) from public, anon, authenticated;
grant execute on function public.record_server_purchase_event(uuid, int) to service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. claim_conversion_jobs — o worker reclama trabalho sem pisar outro worker
--
-- `for update skip locked` é o que permite ter dois workers (o envio imediato
-- e o cron de retoma) sem enviar a mesma conversão duas vezes.
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.claim_conversion_jobs(p_limit int default 20)
returns table (
  id           bigint,
  order_id     uuid,
  store_id     uuid,
  destination  text,
  event_name   text,
  value_cents  int,
  attempts     int
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  return query
  with due as (
    select j.id
    from public.conversion_jobs j
    where j.status = 'pending'
      and j.next_attempt_at <= now()
    order by j.next_attempt_at
    limit greatest(1, least(coalesce(p_limit, 20), 100))
    for update skip locked
  )
  update public.conversion_jobs j
     set attempts = j.attempts + 1,
         -- Empurra a próxima tentativa já: se este worker morrer a meio, o
         -- cron seguinte reclama de novo em vez de a conversão ficar presa.
         next_attempt_at = now() + interval '5 minutes'
    from due
   where j.id = due.id
  returning j.id, j.order_id, j.store_id, j.destination, j.event_name, j.value_cents, j.attempts;
end;
$$;

revoke all on function public.claim_conversion_jobs(int) from public, anon, authenticated;
grant execute on function public.claim_conversion_jobs(int) to service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. complete_conversion_job — fecha ou reagenda com backoff exponencial
--
-- 1 min → 4 min → 16 min → 64 min → ~4h → ~18h. Seis tentativas ao longo de
-- quase um dia: chega para atravessar uma manutenção da Meta sem inundar a
-- API nem exigir que alguém carregue num botão.
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.complete_conversion_job(
  p_id       bigint,
  p_ok       boolean,
  p_error    text default null,
  p_response jsonb default null
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_job record;
  v_max_attempts constant int := 6;
begin
  select * into v_job from public.conversion_jobs where id = p_id;
  if not found then
    return;
  end if;

  if p_ok then
    update public.conversion_jobs
       set status = 'sent',
           sent_at = now(),
           last_error = null,
           response = p_response
     where id = p_id;
    return;
  end if;

  if v_job.attempts >= v_max_attempts then
    update public.conversion_jobs
       set status = 'failed',
           last_error = left(coalesce(p_error, 'erro desconhecido'), 1000),
           response = p_response
     where id = p_id;

    -- Desistir é um acontecimento operacional: entra no log com contexto para
    -- o alerta do §11.5 poder apanhá-lo.
    insert into public.event_log (order_id, store_id, type, payload)
    values (
      v_job.order_id,
      v_job.store_id,
      'conversion.gave_up',
      jsonb_build_object(
        'destination', v_job.destination,
        'attempts',    v_job.attempts,
        'error',       left(coalesce(p_error, ''), 500)
      )
    );
    return;
  end if;

  update public.conversion_jobs
     set status = 'pending',
         last_error = left(coalesce(p_error, 'erro desconhecido'), 1000),
         next_attempt_at = now() + (interval '1 minute' * power(4, v_job.attempts)),
         response = p_response
   where id = p_id;
end;
$$;

revoke all on function public.complete_conversion_job(bigint, boolean, text, jsonb) from public, anon, authenticated;
grant execute on function public.complete_conversion_job(bigint, boolean, text, jsonb) to service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 6. get_conversion_health — o semáforo do painel Sistema (§11.5)
--
-- Uma fila que ninguém vê é uma fila que ninguém esvazia.
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.get_conversion_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated' using errcode = 'P0020';
  end if;

  if private.auth_role() not in ('owner', 'manager') then
    raise exception 'conversion_health_denied' using errcode = 'P0403';
  end if;

  select jsonb_build_object(
    'pending',      count(*) filter (where status = 'pending'),
    'sent',         count(*) filter (where status = 'sent'),
    'failed',       count(*) filter (where status = 'failed'),
    'retrying',     count(*) filter (where status = 'pending' and attempts > 0),
    'oldest_pending_minutes', coalesce(
      round(extract(epoch from (now() - min(created_at) filter (where status = 'pending'))) / 60)::int,
      0
    ),
    'last_error', (
      select jsonb_build_object('destination', destination, 'error', left(last_error, 200))
      from public.conversion_jobs
      where last_error is not null
        and (store_id is null or private.auth_can_store(store_id))
      order by id desc
      limit 1
    )
  ) into v_result
  from public.conversion_jobs
  where created_at > now() - interval '7 days'
    and (store_id is null or private.auth_can_store(store_id));

  return coalesce(v_result, '{}'::jsonb);
end;
$$;

revoke all on function public.get_conversion_health() from public, anon;
grant execute on function public.get_conversion_health() to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 7. record_order_attribution: passa a guardar também a identidade técnica
--    (fbp, ip, user-agent, url) que a CAPI precisa para fazer match.
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
  v_order record;
  v_first jsonb := p_payload -> 'first_touch';
  v_last  jsonb := p_payload -> 'last_touch';
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
    click_ids, first_touch, last_touch,
    fbp, client_ip, user_agent, event_source_url
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
    v_last,
    nullif(left(coalesce(p_payload ->> 'fbp', ''), 120), ''),
    nullif(left(coalesce(p_payload ->> 'client_ip', ''), 60), ''),
    nullif(left(coalesce(p_payload ->> 'user_agent', ''), 400), ''),
    nullif(left(coalesce(p_payload ->> 'event_source_url', ''), 400), '')
  )
  on conflict (order_id) do nothing;
end;
$$;

revoke all on function public.record_order_attribution(uuid, jsonb) from public;
grant execute on function public.record_order_attribution(uuid, jsonb) to anon, authenticated, service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 8. get_conversion_context — tudo o que o worker precisa, numa chamada
--
-- Devolve o pedido + a atribuição + os dados de identificação. Só service_role:
-- traz telefone e email em claro (o hash SHA-256 é feito no worker, em Node).
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.get_conversion_context(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  select jsonb_build_object(
    'order_id',       o.id,
    'order_number',   o.order_number,
    'total_cents',    o.total_cents,
    'created_at',     o.created_at,
    'customer_name',  o.customer_name,
    'customer_phone', o.customer_phone,
    'customer_email', o.customer_email,
    'store_id',       o.store_id,
    'attribution', case when a.order_id is null then null else jsonb_build_object(
      'channel',          a.channel,
      'source',           a.source,
      'campaign',         a.campaign,
      'click_ids',        a.click_ids,
      'fbp',              a.fbp,
      'client_ip',        a.client_ip,
      'user_agent',       a.user_agent,
      'event_source_url', a.event_source_url,
      'created_at',       a.created_at
    ) end,
    'items', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id',   i.menu_item_id,
        'name', i.name_snapshot,
        'qty',  i.qty,
        'price_cents', i.unit_price_cents
      )), '[]'::jsonb)
      from public.order_items i
      where i.order_id = o.id
    )
  ) into v_result
  from public.orders o
  left join public.order_attribution a on a.order_id = o.id
  where o.id = p_order_id;

  return v_result;
end;
$$;

revoke all on function public.get_conversion_context(uuid) from public, anon, authenticated;
grant execute on function public.get_conversion_context(uuid) to service_role;
