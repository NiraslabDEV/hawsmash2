-- WhatsApp no painel do dono (ADR 0011/0012, T8/T9 do prompt). BLOCO PORTÁTIL: nada aqui sabe o que é um pedido,
-- excepto a contagem de whatsapp_checkouts, que falha em silêncio onde a 1125 não existir (Gym OS).
-- 1. Ligar e desligar por loja deixa de precisar de migration: get/save_store_whatsapp, só owner.
-- 2. Contagem do mês por tipo: é a base da cobrança ao cliente (B-123) e da folga das 1.000 mensagens grátis.
-- 3. Telemóveis que recebem os alertas da loja.
-- 4. Recibo de webhook para quem esconde o número (BSUID): pede-se o número uma vez por mensagem.

-- ── Telemóveis para alertas ─────────────────────────────────────────────────
create or replace function private.whatsapp_valid_phones(p_phones text[])
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(cardinality(p_phones), 0) <= 5
     and not exists (select 1 from unnest(coalesce(p_phones, '{}')) as p where p !~ '^\+[1-9][0-9]{7,14}$');
$$;

alter table public.stores add column if not exists whatsapp_alert_phones text[] not null default '{}';
do $$ begin
  alter table public.stores add constraint stores_whatsapp_alert_phones_valid
    check (private.whatsapp_valid_phones(whatsapp_alert_phones));
exception when duplicate_object then null; end $$;

-- ── Ler: configuração e uso do mês ──────────────────────────────────────────
-- DECISÃO: a Meta cobra o que foi ENTREGUE, por isso o uso conta delivered/read. O mês é o de Maputo;
-- a Meta reinicia as 1.000 grátis no fuso da conta, que se escolhe igual ao criar a WABA.
create or replace function public.get_store_whatsapp(p_store_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  s public.stores;
  v_start timestamptz := date_trunc('month', now() at time zone 'Africa/Maputo') at time zone 'Africa/Maputo';
  v_usage jsonb;
  v_orders integer := 0;
begin
  if not coalesce((select private.auth_is_owner()), false) or not coalesce((select private.auth_can_store(p_store_id)), false) then
    raise exception 'forbidden' using errcode = 'P0403';
  end if;
  select * into s from public.stores where id = p_store_id;
  if s.id is null then raise exception 'store_not_found' using errcode = 'P0002'; end if;

  select jsonb_build_object(
    'service_delivered', count(*) filter (where w.kind = 'service' and w.status in ('delivered', 'read')),
    'utility_delivered', count(*) filter (where w.kind = 'utility' and w.status in ('delivered', 'read')),
    'marketing_delivered', count(*) filter (where w.kind = 'marketing' and w.status in ('delivered', 'read')),
    'authentication_delivered', count(*) filter (where w.kind = 'authentication' and w.status in ('delivered', 'read')),
    'failed', count(*) filter (where w.status = 'failed'),
    'waiting', count(*) filter (where w.status in ('queued', 'sending', 'accepted', 'sent'))
  ) into v_usage
  from public.whatsapp_outbox w
  where w.store_id = p_store_id and w.created_at >= v_start;

  if to_regclass('public.whatsapp_checkouts') is not null then
    execute 'select count(*) from public.whatsapp_checkouts where store_id = $1 and order_id is not null and created_at >= $2'
      into v_orders using p_store_id, v_start;
  end if;

  return jsonb_build_object(
    'enabled', s.whatsapp_enabled,
    'chat_enabled', s.whatsapp_chat_enabled,
    'sender_id', s.whatsapp_sender_id,
    'phone', s.whatsapp_phone,
    'handoff_phone', s.whatsapp_handoff_phone,
    'alert_phones', to_jsonb(s.whatsapp_alert_phones),
    'month', v_usage || jsonb_build_object(
      'since', v_start,
      'inbound', (select count(*) from public.whatsapp_inbound i where i.store_id = p_store_id and i.received_at >= v_start),
      'orders', v_orders
    )
  );
end $$;
revoke all on function public.get_store_whatsapp(uuid) from public, anon;
grant execute on function public.get_store_whatsapp(uuid) to authenticated, service_role;

-- ── Gravar ──────────────────────────────────────────────────────────────────
-- Só o que vier no payload muda. Erros com nome, para o ecrã dizer o que falta em vez de mostrar uma constraint.
create or replace function public.save_store_whatsapp(p_store_id uuid, p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  s public.stores;
  v_enabled boolean;
  v_chat boolean;
  v_sender text;
  v_phone text;
  v_handoff text;
  v_alerts text[];
  v_campos text[];
begin
  if not coalesce((select private.auth_is_owner()), false) or not coalesce((select private.auth_can_store(p_store_id)), false) then
    raise exception 'forbidden' using errcode = 'P0403';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'invalid_payload' using errcode = 'P0400';
  end if;
  select * into s from public.stores where id = p_store_id for update;
  if s.id is null then raise exception 'store_not_found' using errcode = 'P0002'; end if;

  v_enabled := case when jsonb_exists(p_payload, 'enabled') then (p_payload ->> 'enabled')::boolean else s.whatsapp_enabled end;
  v_chat := case when jsonb_exists(p_payload, 'chat_enabled') then (p_payload ->> 'chat_enabled')::boolean else s.whatsapp_chat_enabled end;
  v_sender := case when jsonb_exists(p_payload, 'sender_id') then nullif(btrim(p_payload ->> 'sender_id'), '') else s.whatsapp_sender_id end;
  v_phone := case when jsonb_exists(p_payload, 'phone') then nullif(btrim(p_payload ->> 'phone'), '') else s.whatsapp_phone end;
  v_handoff := case when jsonb_exists(p_payload, 'handoff_phone') then nullif(btrim(p_payload ->> 'handoff_phone'), '') else s.whatsapp_handoff_phone end;
  if jsonb_exists(p_payload, 'alert_phones') then
    if jsonb_typeof(p_payload -> 'alert_phones') <> 'array' then raise exception 'invalid_alert_phones' using errcode = 'P0400'; end if;
    v_alerts := array(select jsonb_array_elements_text(p_payload -> 'alert_phones'));
  else
    v_alerts := s.whatsapp_alert_phones;
  end if;

  if v_sender is not null and v_sender !~ '^[A-Za-z0-9_.-]{3,64}$' then raise exception 'invalid_sender_id' using errcode = 'P0400'; end if;
  if v_phone is not null and v_phone !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'invalid_phone' using errcode = 'P0400'; end if;
  if v_handoff is not null and v_handoff !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'invalid_handoff_phone' using errcode = 'P0400'; end if;
  if not private.whatsapp_valid_phones(v_alerts) then raise exception 'invalid_alert_phones' using errcode = 'P0400'; end if;
  if v_enabled and v_sender is null then raise exception 'whatsapp_sender_required' using errcode = 'P0400'; end if;
  if v_sender is not null and exists (select 1 from public.stores o where o.whatsapp_sender_id = v_sender and o.id <> p_store_id) then
    raise exception 'whatsapp_sender_taken' using errcode = 'P0409';
  end if;
  -- Desligar os avisos desliga a conversa. Ligar a conversa sem avisos é um erro: não há por onde responder.
  if not v_enabled then
    if jsonb_exists(p_payload, 'chat_enabled') and v_chat then
      raise exception 'whatsapp_chat_requires_enabled' using errcode = 'P0400';
    end if;
    v_chat := false;
  end if;

  update public.stores
     set whatsapp_enabled = v_enabled, whatsapp_chat_enabled = v_chat, whatsapp_sender_id = v_sender,
         whatsapp_phone = v_phone, whatsapp_handoff_phone = v_handoff, whatsapp_alert_phones = v_alerts
   where id = p_store_id;

  v_campos := array(select jsonb_object_keys(p_payload));
  insert into public.event_log (store_id, actor_user_id, type, payload)
  values (p_store_id, (select auth.uid()), 'whatsapp.settings_changed',
          jsonb_build_object('campos', to_jsonb(v_campos), 'enabled', v_enabled, 'chat_enabled', v_chat));

  return public.get_store_whatsapp(p_store_id);
end $$;
revoke all on function public.save_store_whatsapp(uuid, jsonb) from public, anon;
grant execute on function public.save_store_whatsapp(uuid, jsonb) to authenticated, service_role;

-- ── Número escondido: um pedido de número por mensagem ──────────────────────
-- true = mensagem nova, de uma loja com a conversa ligada. A fila não serve aqui: só aceita E.164.
create or replace function public.whatsapp_receipt_once(p_event_id text, p_sender_id text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.stores s where s.whatsapp_sender_id = p_sender_id and s.whatsapp_chat_enabled) then
    return false;
  end if;
  insert into private.whatsapp_webhook_receipts (event_id) values (p_event_id) on conflict do nothing;
  return found;
end $$;
revoke all on function public.whatsapp_receipt_once(text, text) from public, anon, authenticated;
grant execute on function public.whatsapp_receipt_once(text, text) to service_role;

notify pgrst, 'reload schema';
