-- WhatsApp por loja (ADR 0011) — BLOCO PORTÁTIL.
-- Nenhuma coluna de restaurante: a mensagem refere subject_type + subject_id. Esta migration copia-se
-- sem edição para o Gym OS e para o motor. O que é do HAWSMASH está na 1118.
-- Fila (outbox), recepção, opt-out e deduplicação de webhooks. Nada aqui envia: o envio é do cron.

-- ── Loja: número e interruptor ──────────────────────────────────────────────
alter table public.stores
  add column if not exists whatsapp_enabled boolean not null default false,
  add column if not exists whatsapp_sender_id text,
  add column if not exists whatsapp_phone text;

do $$ begin
  alter table public.stores add constraint stores_whatsapp_sender_required
    check (not whatsapp_enabled or nullif(trim(whatsapp_sender_id), '') is not null);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.stores add constraint stores_whatsapp_phone_e164
    check (whatsapp_phone is null or whatsapp_phone ~ '^\+[1-9][0-9]{7,14}$');
exception when duplicate_object then null; end $$;
-- Um número do fornecedor pertence a uma só loja: é por ele que a mensagem recebida encontra a loja.
create unique index if not exists stores_whatsapp_sender_unique on public.stores (whatsapp_sender_id)
  where whatsapp_sender_id is not null;

-- ── Fila ────────────────────────────────────────────────────────────────────
create table if not exists public.whatsapp_outbox (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id),
  subject_type text not null check (subject_type ~ '^[a-z_]{2,30}$'),
  subject_id text not null check (length(subject_id) between 1 and 100),
  event text not null check (event ~ '^[a-z_]+(\.[a-z_]+)+$' and length(event) <= 60),
  recipient text not null check (recipient ~ '^\+[1-9][0-9]{7,14}$'),
  vars jsonb not null default '{}' check (jsonb_typeof(vars) = 'object'),
  kind text not null default 'utility' check (kind in ('utility', 'authentication', 'marketing')),
  status text not null default 'queued'
    check (status in ('queued', 'sending', 'accepted', 'sent', 'delivered', 'read', 'failed', 'cancelled')),
  -- Chave da mensagem lógica: o mesmo evento do mesmo assunto nunca entra duas vezes (regra 4).
  idempotency_key text not null unique check (length(idempotency_key) between 1 and 200),
  provider_message_id text unique,
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  due_at timestamptz not null default now(),
  -- Aviso de pedido com três horas já não serve a ninguém: expira em vez de chegar tarde.
  expires_at timestamptz,
  claimed_at timestamptz,
  accepted_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists whatsapp_outbox_due_idx on public.whatsapp_outbox (due_at) where status = 'queued';
create index if not exists whatsapp_outbox_store_idx on public.whatsapp_outbox (store_id, created_at desc);
create index if not exists whatsapp_outbox_subject_idx on public.whatsapp_outbox (store_id, subject_type, subject_id);

-- ── Recepção ────────────────────────────────────────────────────────────────
create table if not exists public.whatsapp_inbound (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id),
  provider_event_id text not null unique,
  provider_message_id text,
  from_phone text not null check (from_phone ~ '^\+[1-9][0-9]{7,14}$'),
  content_type text not null check (length(content_type) between 1 and 40),
  body text check (body is null or length(body) <= 4096),
  received_at timestamptz not null default now()
);
create index if not exists whatsapp_inbound_store_idx on public.whatsapp_inbound (store_id, received_at desc);

-- DECISÃO: opt-out por telefone em toda a instalação (uma marca, várias lojas). Quem diz SAIR a Maputo
-- não quer receber da Matola. Códigos de acesso (authentication) continuam: foi a pessoa que os pediu.
create table if not exists public.whatsapp_optouts (
  phone text primary key check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  store_id uuid references public.stores(id),
  source text not null check (length(source) between 2 and 60),
  created_at timestamptz not null default now()
);

create table if not exists private.whatsapp_webhook_receipts (
  event_id text primary key check (length(event_id) between 1 and 200),
  received_at timestamptz not null default now()
);
revoke all on private.whatsapp_webhook_receipts from public, anon, authenticated;

-- ── RLS: só o dono lê, só da loja que pode ver; escrever é só do servidor ───
alter table public.whatsapp_outbox enable row level security;
alter table public.whatsapp_inbound enable row level security;
alter table public.whatsapp_optouts enable row level security;
revoke all on public.whatsapp_outbox, public.whatsapp_inbound, public.whatsapp_optouts from public, anon, authenticated;
grant select on public.whatsapp_outbox, public.whatsapp_inbound, public.whatsapp_optouts to authenticated;
grant all on public.whatsapp_outbox, public.whatsapp_inbound, public.whatsapp_optouts to service_role;

drop policy if exists whatsapp_outbox_owner_read on public.whatsapp_outbox;
create policy whatsapp_outbox_owner_read on public.whatsapp_outbox for select to authenticated
  using ((select private.auth_is_owner()) and (select private.auth_can_store(store_id)));
drop policy if exists whatsapp_inbound_owner_read on public.whatsapp_inbound;
create policy whatsapp_inbound_owner_read on public.whatsapp_inbound for select to authenticated
  using ((select private.auth_is_owner()) and (select private.auth_can_store(store_id)));
drop policy if exists whatsapp_optouts_owner_read on public.whatsapp_optouts;
create policy whatsapp_optouts_owner_read on public.whatsapp_optouts for select to authenticated
  using ((select private.auth_is_owner()));

-- ── Telemóvel moçambicano → E.164 (espelho de toWhatsAppPhone em packages/whatsapp) ──
create or replace function private.whatsapp_phone_mz(p_raw text)
returns text language plpgsql immutable set search_path = '' as $$
declare v text;
begin
  if p_raw is null or p_raw ~ '[^0-9 +().-]' then return null; end if;
  v := regexp_replace(p_raw, '[^0-9]', '', 'g');
  if v like '00%' then v := substr(v, 3); end if;
  if length(v) = 10 and v like '0%' then v := substr(v, 2); end if;
  if length(v) = 12 and v like '258%' then v := substr(v, 4); end if;
  if v ~ '^8[2-7][0-9]{7}$' then return '+258' || v; end if;
  return null;
end $$;

-- ── Enfileirar ──────────────────────────────────────────────────────────────
-- Chamado pelos gatilhos de cada projecto. Loja sem WhatsApp ligado, telefone inválido ou opt-out:
-- devolve null sem erro. Nunca rebenta a transacção de quem chamou.
create or replace function public.whatsapp_enqueue(
  p_store_id uuid,
  p_subject_type text,
  p_subject_id text,
  p_event text,
  p_recipient text,
  p_vars jsonb default '{}',
  p_kind text default 'utility',
  p_due_at timestamptz default null,
  p_expires_at timestamptz default null,
  p_idempotency_key text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if p_recipient is null or p_recipient !~ '^\+[1-9][0-9]{7,14}$' then return null; end if;
  if not exists (select 1 from public.stores s where s.id = p_store_id and s.whatsapp_enabled) then return null; end if;
  if p_kind <> 'authentication' and exists (select 1 from public.whatsapp_optouts o where o.phone = p_recipient) then
    return null;
  end if;
  insert into public.whatsapp_outbox
    (store_id, subject_type, subject_id, event, recipient, vars, kind, due_at, expires_at, idempotency_key)
  values
    (p_store_id, p_subject_type, p_subject_id, p_event, p_recipient, coalesce(p_vars, '{}'), p_kind,
     coalesce(p_due_at, now()), p_expires_at,
     coalesce(p_idempotency_key, p_subject_type || ':' || p_subject_id || ':' || p_event))
  on conflict (idempotency_key) do nothing
  returning id into v_id;
  if v_id is not null then
    insert into public.event_log (store_id, type, payload)
    values (p_store_id, 'whatsapp.queued',
            jsonb_build_object('outbox_id', v_id, 'event', p_event, 'subject_type', p_subject_type, 'subject_id', p_subject_id));
  end if;
  return v_id;
end $$;
revoke all on function public.whatsapp_enqueue(uuid, text, text, text, text, jsonb, text, timestamptz, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.whatsapp_enqueue(uuid, text, text, text, text, jsonb, text, timestamptz, timestamptz, text)
  to service_role;

-- Retira da fila o que ainda não saiu de um assunto (ex.: pedido cancelado já não leva o lembrete).
create or replace function public.whatsapp_cancel_subject(
  p_store_id uuid, p_subject_type text, p_subject_id text, p_events text[] default null
) returns integer language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  update public.whatsapp_outbox
     set status = 'cancelled', last_error = 'Cancelado pelo assunto.', updated_at = now()
   where store_id = p_store_id and subject_type = p_subject_type and subject_id = p_subject_id
     and status = 'queued' and (p_events is null or event = any (p_events));
  get diagnostics v_count = row_count;
  return v_count;
end $$;
revoke all on function public.whatsapp_cancel_subject(uuid, text, text, text[]) from public, anon, authenticated;
grant execute on function public.whatsapp_cancel_subject(uuid, text, text, text[]) to service_role;

-- ── Despacho ────────────────────────────────────────────────────────────────
create or replace function public.whatsapp_claim(p_limit integer default 20)
returns setof public.whatsapp_outbox language plpgsql security definer set search_path = '' as $$
begin
  -- DECISÃO: ao contrário do SMTP (1104), o fornecedor deduplica pela idempotency-key = id da linha.
  -- Uma linha presa em "sending" (processo morreu) volta à fila: reenviar com a mesma chave não duplica.
  update public.whatsapp_outbox
     set status = 'queued', claimed_at = null, updated_at = now()
   where status = 'sending' and claimed_at < now() - interval '10 minutes';
  update public.whatsapp_outbox
     set status = 'cancelled', last_error = 'Expirou antes de sair.', updated_at = now()
   where status = 'queued' and expires_at is not null and expires_at <= now();
  update public.whatsapp_outbox w
     set status = 'cancelled', last_error = 'Telefone em opt-out.', updated_at = now()
   where w.status = 'queued' and w.kind <> 'authentication'
     and exists (select 1 from public.whatsapp_optouts o where o.phone = w.recipient);

  return query
  with picked as (
    select w.id from public.whatsapp_outbox w
      join public.stores s on s.id = w.store_id
     where w.status = 'queued' and w.due_at <= now() and s.whatsapp_enabled
     order by w.due_at, w.id
     limit least(greatest(coalesce(p_limit, 20), 1), 50)
     for update of w skip locked
  )
  update public.whatsapp_outbox w
     set status = 'sending', claimed_at = now(), attempts = w.attempts + 1, updated_at = now()
    from picked p where w.id = p.id
  returning w.*;
end $$;
revoke all on function public.whatsapp_claim(integer) from public, anon, authenticated;
grant execute on function public.whatsapp_claim(integer) to service_role;

create or replace function public.whatsapp_finish(
  p_id uuid,
  p_ok boolean,
  p_provider_message_id text default null,
  p_retryable boolean default false,
  p_error text default null,
  p_retry_after_seconds integer default null
) returns text language plpgsql security definer set search_path = '' as $$
declare w public.whatsapp_outbox;
begin
  select * into w from public.whatsapp_outbox where id = p_id and status = 'sending' for update;
  if w.id is null then return 'ignored'; end if;
  if p_ok then
    update public.whatsapp_outbox
       set status = 'accepted', provider_message_id = coalesce(p_provider_message_id, provider_message_id),
           accepted_at = now(), last_error = null, updated_at = now()
     where id = w.id;
    return 'accepted';
  end if;
  if p_retryable and w.attempts < 5 then
    update public.whatsapp_outbox
       set status = 'queued', claimed_at = null, last_error = left(p_error, 500), updated_at = now(),
           due_at = now() + make_interval(secs => greatest(coalesce(p_retry_after_seconds, 0), 60 * power(2, w.attempts - 1)::integer))
     where id = w.id;
    return 'retry';
  end if;
  update public.whatsapp_outbox
     set status = 'failed', last_error = left(p_error, 500), updated_at = now()
   where id = w.id;
  insert into public.event_log (store_id, type, payload)
  values (w.store_id, 'whatsapp.failed', jsonb_build_object('outbox_id', w.id, 'event', w.event, 'error', left(p_error, 200)));
  return 'failed';
end $$;
revoke all on function public.whatsapp_finish(uuid, boolean, text, boolean, text, integer) from public, anon, authenticated;
grant execute on function public.whatsapp_finish(uuid, boolean, text, boolean, text, integer) to service_role;

-- ── Webhook ─────────────────────────────────────────────────────────────────
-- Estado só avança (accepted → sent → delivered → read). "failed" só antes de entregue.
create or replace function public.whatsapp_apply_status(
  p_event_id text, p_provider_message_id text, p_status text, p_error text default null
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
  w public.whatsapp_outbox;
  v_rank constant jsonb := '{"queued":0,"sending":0,"accepted":1,"sent":2,"delivered":3,"read":4}';
begin
  if p_status not in ('sent', 'delivered', 'read', 'failed') then return false; end if;
  insert into private.whatsapp_webhook_receipts (event_id) values (p_event_id) on conflict do nothing;
  if not found then return false; end if;
  select * into w from public.whatsapp_outbox where provider_message_id = p_provider_message_id for update;
  if w.id is null or w.status in ('failed', 'cancelled') then return false; end if;
  if p_status = 'failed' then
    if w.status in ('delivered', 'read') then return false; end if;
    update public.whatsapp_outbox set status = 'failed', last_error = left(p_error, 500), updated_at = now() where id = w.id;
    insert into public.event_log (store_id, type, payload)
    values (w.store_id, 'whatsapp.failed', jsonb_build_object('outbox_id', w.id, 'event', w.event, 'error', left(p_error, 200)));
    return true;
  end if;
  if (v_rank ->> p_status)::integer <= coalesce((v_rank ->> w.status)::integer, 0) then return false; end if;
  update public.whatsapp_outbox
     set status = p_status,
         delivered_at = case when p_status in ('delivered', 'read') then coalesce(delivered_at, now()) else delivered_at end,
         read_at = case when p_status = 'read' then now() else read_at end,
         updated_at = now()
   where id = w.id;
  return true;
end $$;
revoke all on function public.whatsapp_apply_status(text, text, text, text) from public, anon, authenticated;
grant execute on function public.whatsapp_apply_status(text, text, text, text) to service_role;

-- Mensagem recebida: a loja é a do número que a recebeu. Número desconhecido → null, nada gravado.
create or replace function public.whatsapp_record_inbound(
  p_event_id text, p_sender_id text, p_from text, p_provider_message_id text,
  p_content_type text, p_body text, p_opt_out boolean default false
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_store uuid;
begin
  select s.id into v_store from public.stores s where s.whatsapp_sender_id = p_sender_id;
  if v_store is null or p_from !~ '^\+[1-9][0-9]{7,14}$' then return null; end if;
  insert into private.whatsapp_webhook_receipts (event_id) values (p_event_id) on conflict do nothing;
  if not found then return v_store; end if;
  insert into public.whatsapp_inbound (store_id, provider_event_id, provider_message_id, from_phone, content_type, body)
  values (v_store, p_event_id, p_provider_message_id, p_from, left(coalesce(p_content_type, 'unknown'), 40), left(p_body, 4096))
  on conflict (provider_event_id) do nothing;
  if p_opt_out then
    insert into public.whatsapp_optouts (phone, store_id, source) values (p_from, v_store, 'whatsapp_reply')
    on conflict (phone) do nothing;
    update public.whatsapp_outbox set status = 'cancelled', last_error = 'Telefone em opt-out.', updated_at = now()
     where recipient = p_from and status = 'queued' and kind <> 'authentication';
    insert into public.event_log (store_id, type, payload) values (v_store, 'whatsapp.opt_out', '{}'::jsonb);
  end if;
  return v_store;
end $$;
revoke all on function public.whatsapp_record_inbound(text, text, text, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.whatsapp_record_inbound(text, text, text, text, text, text, boolean) to service_role;
