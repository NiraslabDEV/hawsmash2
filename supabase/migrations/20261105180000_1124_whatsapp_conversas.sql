-- WhatsApp — conversas (ADR 0012). BLOCO PORTÁTIL, como a 1117: nada aqui sabe o que é um pedido.
-- 1. Respostas da conversa (kind 'service', payload) passam pela mesma fila: histórico, retry e
--    idempotência por mensagem recebida (a mesma mensagem processada duas vezes não responde duas vezes).
-- 2. Recepção guarda o id do botão, a media e o nome do perfil, e é processada com claim: o webhook
--    processa na hora; o cron apanha o que ficou a meio (processo morto, timeout).
-- 3. Estado da conversa por loja e telefone, com versão (concorrência optimista).

-- ── Loja: conversa ligada à parte dos avisos ───────────────────────────────
alter table public.stores
  add column if not exists whatsapp_chat_enabled boolean not null default false,
  add column if not exists whatsapp_handoff_phone text;
do $$ begin
  alter table public.stores add constraint stores_whatsapp_chat_requires_enabled
    check (not whatsapp_chat_enabled or whatsapp_enabled);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.stores add constraint stores_whatsapp_handoff_e164
    check (whatsapp_handoff_phone is null or whatsapp_handoff_phone ~ '^\+[1-9][0-9]{7,14}$');
exception when duplicate_object then null; end $$;

-- ── Fila: mensagens de sessão ───────────────────────────────────────────────
alter table public.whatsapp_outbox add column if not exists payload jsonb;
alter table public.whatsapp_outbox drop constraint if exists whatsapp_outbox_kind_check;
alter table public.whatsapp_outbox add constraint whatsapp_outbox_kind_check
  check (kind in ('utility', 'authentication', 'marketing', 'service'));
do $$ begin
  alter table public.whatsapp_outbox add constraint whatsapp_outbox_service_payload
    check ((kind = 'service') = (payload is not null) and (payload is null or jsonb_typeof(payload) = 'object'));
exception when duplicate_object then null; end $$;

-- ── Recepção: botão, media, perfil e processamento ──────────────────────────
alter table public.whatsapp_inbound
  add column if not exists reply_id text check (reply_id is null or length(reply_id) <= 256),
  add column if not exists media_id text check (media_id is null or length(media_id) <= 200),
  add column if not exists media_mime text check (media_mime is null or length(media_mime) <= 100),
  add column if not exists profile_name text check (profile_name is null or length(profile_name) <= 120),
  add column if not exists processing_at timestamptz,
  add column if not exists processed_at timestamptz,
  add column if not exists attempts integer not null default 0 check (attempts >= 0),
  add column if not exists process_error text;
create index if not exists whatsapp_inbound_pending_idx on public.whatsapp_inbound (received_at)
  where processed_at is null;

-- ── Conversa ────────────────────────────────────────────────────────────────
create table if not exists public.whatsapp_conversations (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id),
  phone text not null check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  state jsonb not null default '{}' check (jsonb_typeof(state) = 'object' and length(state::text) <= 32000),
  version integer not null default 0 check (version >= 0),
  profile_name text check (profile_name is null or length(profile_name) <= 120),
  -- A Meta só deixa responder livremente nas 24 h depois da última mensagem do cliente.
  last_inbound_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, phone)
);
create index if not exists whatsapp_conversations_store_idx on public.whatsapp_conversations (store_id, updated_at desc);

alter table public.whatsapp_conversations enable row level security;
revoke all on public.whatsapp_conversations from public, anon, authenticated;
grant select on public.whatsapp_conversations to authenticated;
grant all on public.whatsapp_conversations to service_role;
drop policy if exists whatsapp_conversations_owner_read on public.whatsapp_conversations;
create policy whatsapp_conversations_owner_read on public.whatsapp_conversations for select to authenticated
  using ((select private.auth_is_owner()) and (select private.auth_can_store(store_id)));

-- ── Receber ─────────────────────────────────────────────────────────────────
-- Substitui whatsapp_record_inbound (1117): o mesmo contrato, mais o que a conversa precisa.
-- Número desconhecido → null, nada gravado. Entrega repetida → is_new = false, nada processado de novo.
drop function if exists public.whatsapp_record_inbound(text, text, text, text, text, text, boolean);

create or replace function public.whatsapp_receive(
  p_event_id text, p_sender_id text, p_from text, p_provider_message_id text,
  p_content_type text, p_body text, p_reply_id text default null, p_media_id text default null,
  p_media_mime text default null, p_profile_name text default null, p_opt_out boolean default false
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_store public.stores;
  v_id uuid;
  v_name text := nullif(left(btrim(coalesce(p_profile_name, '')), 120), '');
begin
  select * into v_store from public.stores s where s.whatsapp_sender_id = p_sender_id;
  if v_store.id is null or p_from !~ '^\+[1-9][0-9]{7,14}$' then return null; end if;
  insert into private.whatsapp_webhook_receipts (event_id) values (p_event_id) on conflict do nothing;
  if not found then
    return jsonb_build_object('store_id', v_store.id, 'inbound_id', null, 'is_new', false,
                              'chat_enabled', v_store.whatsapp_chat_enabled);
  end if;
  insert into public.whatsapp_inbound
    (store_id, provider_event_id, provider_message_id, from_phone, content_type, body,
     reply_id, media_id, media_mime, profile_name,
     -- Sem conversa ligada não há nada a processar: a linha nasce processada.
     processed_at)
  values
    (v_store.id, p_event_id, p_provider_message_id, p_from, left(coalesce(p_content_type, 'unknown'), 40), left(p_body, 4096),
     left(p_reply_id, 256), left(p_media_id, 200), left(p_media_mime, 100), v_name,
     case when v_store.whatsapp_chat_enabled then null else now() end)
  on conflict (provider_event_id) do nothing
  returning id into v_id;

  insert into public.whatsapp_conversations (store_id, phone, profile_name, last_inbound_at)
  values (v_store.id, p_from, v_name, now())
  on conflict (store_id, phone) do update
    set last_inbound_at = now(),
        profile_name = coalesce(excluded.profile_name, public.whatsapp_conversations.profile_name);

  if p_opt_out then
    insert into public.whatsapp_optouts (phone, store_id, source) values (p_from, v_store.id, 'whatsapp_reply')
    on conflict (phone) do nothing;
    -- As respostas da conversa (service) ficam: foi a pessoa que escreveu.
    update public.whatsapp_outbox set status = 'cancelled', last_error = 'Telefone em opt-out.', updated_at = now()
     where recipient = p_from and status = 'queued' and kind not in ('authentication', 'service');
    insert into public.event_log (store_id, type, payload) values (v_store.id, 'whatsapp.opt_out', '{}'::jsonb);
  end if;
  return jsonb_build_object('store_id', v_store.id, 'inbound_id', v_id, 'is_new', v_id is not null,
                            'chat_enabled', v_store.whatsapp_chat_enabled);
end $$;
revoke all on function public.whatsapp_receive(text, text, text, text, text, text, text, text, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.whatsapp_receive(text, text, text, text, text, text, text, text, text, text, boolean)
  to service_role;

-- ── Processar uma mensagem recebida (claim) ─────────────────────────────────
-- Só um processo de cada vez por mensagem. Preso há mais de 2 min volta a poder ser apanhado;
-- à terceira tentativa desiste (a pessoa escreve outra vez — nunca um ciclo infinito de respostas).
create or replace function public.whatsapp_inbound_claim(p_id uuid)
returns setof public.whatsapp_inbound language plpgsql security definer set search_path = '' as $$
begin
  return query
  update public.whatsapp_inbound
     set processing_at = now(), attempts = attempts + 1
   where id = p_id and processed_at is null and attempts < 3
     and (processing_at is null or processing_at < now() - interval '2 minutes')
  returning *;
end $$;
revoke all on function public.whatsapp_inbound_claim(uuid) from public, anon, authenticated;
grant execute on function public.whatsapp_inbound_claim(uuid) to service_role;

create or replace function public.whatsapp_inbound_finish(p_id uuid, p_error text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.whatsapp_inbound
     set processed_at = case when p_error is null or attempts >= 3 then now() else null end,
         processing_at = null,
         process_error = left(p_error, 500)
   where id = p_id and processed_at is null;
end $$;
revoke all on function public.whatsapp_inbound_finish(uuid, text) from public, anon, authenticated;
grant execute on function public.whatsapp_inbound_finish(uuid, text) to service_role;

-- O que o cron deve apanhar: recebido há mais de 20 s (o webhook teve a sua vez) e há menos de 30 min
-- (responder uma hora depois a "olá" é pior do que não responder).
create or replace function public.whatsapp_inbound_pending(p_limit integer default 20)
returns setof uuid language sql security definer set search_path = '' as $$
  select i.id from public.whatsapp_inbound i
   where i.processed_at is null and i.attempts < 3
     and i.received_at < now() - interval '20 seconds'
     and i.received_at > now() - interval '30 minutes'
     and (i.processing_at is null or i.processing_at < now() - interval '2 minutes')
   order by i.received_at
   limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;
revoke all on function public.whatsapp_inbound_pending(integer) from public, anon, authenticated;
grant execute on function public.whatsapp_inbound_pending(integer) to service_role;

-- ── Estado da conversa ──────────────────────────────────────────────────────
create or replace function public.whatsapp_conversation_get(p_store_id uuid, p_phone text)
returns public.whatsapp_conversations language plpgsql security definer set search_path = '' as $$
declare c public.whatsapp_conversations;
begin
  if p_phone !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'invalid_phone' using errcode = 'P0400'; end if;
  insert into public.whatsapp_conversations (store_id, phone) values (p_store_id, p_phone)
  on conflict (store_id, phone) do nothing;
  select * into c from public.whatsapp_conversations where store_id = p_store_id and phone = p_phone;
  return c;
end $$;
revoke all on function public.whatsapp_conversation_get(uuid, text) from public, anon, authenticated;
grant execute on function public.whatsapp_conversation_get(uuid, text) to service_role;

-- Grava só se ninguém gravou entretanto (duas mensagens seguidas da mesma pessoa).
create or replace function public.whatsapp_conversation_save(p_id uuid, p_version integer, p_state jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.whatsapp_conversations
     set state = p_state, version = version + 1, updated_at = now()
   where id = p_id and version = p_version;
  return found;
end $$;
revoke all on function public.whatsapp_conversation_save(uuid, integer, jsonb) from public, anon, authenticated;
grant execute on function public.whatsapp_conversation_save(uuid, integer, jsonb) to service_role;

-- ── Enfileirar respostas ────────────────────────────────────────────────────
-- Uma linha por mensagem, pela ordem dada. A chave é `prefixo:n`: processar a mesma mensagem
-- recebida outra vez devolve as mesmas linhas em vez de criar novas. Sem opt-out: a pessoa escreveu.
create or replace function public.whatsapp_enqueue_session(
  p_store_id uuid, p_subject_type text, p_subject_id text, p_recipient text,
  p_messages jsonb, p_key_prefix text
) returns setof uuid language plpgsql security definer set search_path = '' as $$
declare
  v_msg jsonb;
  v_n bigint;
  v_id uuid;
begin
  if p_recipient is null or p_recipient !~ '^\+[1-9][0-9]{7,14}$' then return; end if;
  if jsonb_typeof(p_messages) <> 'array' or jsonb_array_length(p_messages) > 10 then
    raise exception 'invalid_messages' using errcode = 'P0400';
  end if;
  if not exists (select 1 from public.stores s where s.id = p_store_id and s.whatsapp_enabled) then return; end if;
  for v_msg, v_n in select value, ordinality from jsonb_array_elements(p_messages) with ordinality loop
    if jsonb_typeof(v_msg) <> 'object' or length(v_msg::text) > 8000 then
      raise exception 'invalid_messages' using errcode = 'P0400';
    end if;
    insert into public.whatsapp_outbox
      (store_id, subject_type, subject_id, event, recipient, kind, payload, due_at, expires_at, idempotency_key)
    values
      (p_store_id, p_subject_type, p_subject_id, 'chat.reply', p_recipient, 'service', v_msg,
       -- A ordem conta: "pedido criado" antes de "paga para este número".
       now() + make_interval(secs => v_n / 1000.0), now() + interval '15 minutes',
       left(p_key_prefix, 190) || ':' || v_n)
    on conflict (idempotency_key) do update set updated_at = public.whatsapp_outbox.updated_at
    returning id into v_id;
    return next v_id;
  end loop;
end $$;
revoke all on function public.whatsapp_enqueue_session(uuid, text, text, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.whatsapp_enqueue_session(uuid, text, text, text, jsonb, text) to service_role;

-- Reclama linhas concretas (as respostas acabadas de enfileirar) para saírem já, sem esperar pelo cron.
create or replace function public.whatsapp_claim_ids(p_ids uuid[])
returns setof public.whatsapp_outbox language plpgsql security definer set search_path = '' as $$
begin
  return query
  with picked as (
    select w.id from public.whatsapp_outbox w
      join public.stores s on s.id = w.store_id
     where w.id = any (p_ids) and w.status = 'queued' and s.whatsapp_enabled
       and (w.expires_at is null or w.expires_at > now())
     order by w.due_at, w.id
     for update of w skip locked
  )
  update public.whatsapp_outbox w
     set status = 'sending', claimed_at = now(), attempts = w.attempts + 1, updated_at = now()
    from picked p where w.id = p.id
  returning w.*;
end $$;
revoke all on function public.whatsapp_claim_ids(uuid[]) from public, anon, authenticated;
grant execute on function public.whatsapp_claim_ids(uuid[]) to service_role;

-- O claim do cron (1117) cancelava tudo o que não fosse código de acesso para quem disse SAIR.
-- As respostas da conversa ficam de fora: foi a pessoa que escreveu.
create or replace function public.whatsapp_claim(p_limit integer default 20)
returns setof public.whatsapp_outbox language plpgsql security definer set search_path = '' as $$
begin
  update public.whatsapp_outbox
     set status = 'queued', claimed_at = null, updated_at = now()
   where status = 'sending' and claimed_at < now() - interval '10 minutes';
  update public.whatsapp_outbox
     set status = 'cancelled', last_error = 'Expirou antes de sair.', updated_at = now()
   where status = 'queued' and expires_at is not null and expires_at <= now();
  update public.whatsapp_outbox w
     set status = 'cancelled', last_error = 'Telefone em opt-out.', updated_at = now()
   where w.status = 'queued' and w.kind not in ('authentication', 'service')
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

notify pgrst, 'reload schema';
