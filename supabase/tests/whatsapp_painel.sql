-- 1126: WhatsApp no painel do dono. Executar só localmente, numa transacção:
--
--   (echo "begin;"; cat supabase/tests/whatsapp_painel.sql; echo "rollback;") | \
--     docker exec -i supabase_db_hawsmash2 psql -U postgres -v ON_ERROR_STOP=1
do $test$
declare
  s uuid := gen_random_uuid();
  other uuid := gen_random_uuid();
  owner_id uuid := gen_random_uuid();
  manager_id uuid := gen_random_uuid();
  v_order uuid := gen_random_uuid();
  r jsonb;
  v_text text;
begin
  insert into auth.users (id) values (owner_id), (manager_id);
  insert into public.staff_profiles (user_id, full_name, role) values (owner_id, 'Teste dono', 'owner'), (manager_id, 'Teste gerente', 'manager');
  insert into public.stores (id, slug, name, short_name, order_prefix)
  values (s, 'wa-painel', 'PLACEHOLDER_P1', 'P1', 'WPA'), (other, 'wa-painel-2', 'PLACEHOLDER_P2', 'P2', 'WPB');
  insert into public.staff_stores (user_id, store_id) values (manager_id, s) on conflict do nothing;

  -- ── 1. Só o dono ──────────────────────────────────────────────────────
  perform set_config('request.jwt.claim.sub', manager_id::text, true);
  begin
    perform public.get_store_whatsapp(s);
    raise exception '1a: gerente leu';
  exception when sqlstate 'P0403' then null;
  end;
  begin
    perform public.save_store_whatsapp(s, '{"enabled":false}');
    raise exception '1b: gerente gravou';
  exception when sqlstate 'P0403' then null;
  end;
  perform set_config('request.jwt.claim.sub', '', true);
  begin
    perform public.get_store_whatsapp(s);
    raise exception '1c: sem sessão leu';
  exception when sqlstate 'P0403' then null;
  end;
  if has_function_privilege('anon', 'public.save_store_whatsapp(uuid, jsonb)', 'execute')
     or has_function_privilege('anon', 'public.get_store_whatsapp(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.whatsapp_receipt_once(text, text)', 'execute') then
    raise exception '1d: RPC exposta a quem não deve';
  end if;

  perform set_config('request.jwt.claim.sub', owner_id::text, true);

  -- ── 2. Regras com nome ────────────────────────────────────────────────
  begin
    perform public.save_store_whatsapp(s, '{"enabled":true}');
    raise exception '2a: ligou sem número';
  exception when sqlstate 'P0400' then
    get stacked diagnostics v_text = message_text;
    if v_text <> 'whatsapp_sender_required' then raise exception '2a: erro %', v_text; end if;
  end;
  begin
    perform public.save_store_whatsapp(s, '{"chat_enabled":true}');
    raise exception '2b: conversa sem avisos';
  exception when sqlstate 'P0400' then
    get stacked diagnostics v_text = message_text;
    if v_text <> 'whatsapp_chat_requires_enabled' then raise exception '2b: erro %', v_text; end if;
  end;
  begin
    perform public.save_store_whatsapp(s, '{"phone":"84 123 4567"}');
    raise exception '2c: telefone fora de E.164';
  exception when sqlstate 'P0400' then null;
  end;
  begin
    perform public.save_store_whatsapp(s, '{"alert_phones":["+258841111111","nao"]}');
    raise exception '2d: telemóvel de alerta inválido';
  exception when sqlstate 'P0400' then null;
  end;
  begin
    perform public.save_store_whatsapp(s, '{"alert_phones":["+258841111111","+258841111112","+258841111113","+258841111114","+258841111115","+258841111116"]}');
    raise exception '2e: mais de 5 telemóveis';
  exception when sqlstate 'P0400' then null;
  end;

  -- ── 3. Ligar e desligar ───────────────────────────────────────────────
  r := public.save_store_whatsapp(s, '{"sender_id":"123456789012345","phone":"+258870301006","enabled":true,"chat_enabled":true,"handoff_phone":"+258860000000","alert_phones":["+258841111111"]}');
  if not (r ->> 'enabled')::boolean or not (r ->> 'chat_enabled')::boolean or r ->> 'sender_id' <> '123456789012345'
     or r -> 'alert_phones' <> '["+258841111111"]'::jsonb then
    raise exception '3a: não gravou %', r;
  end if;
  if not exists (select 1 from public.event_log where store_id = s and type = 'whatsapp.settings_changed' and actor_user_id = owner_id) then
    raise exception '3b: sem rasto em event_log';
  end if;
  if (select payload::text from public.event_log where store_id = s and type = 'whatsapp.settings_changed' order by created_at desc limit 1) like '%123456789012345%' then
    raise exception '3c: event_log com o valor gravado';
  end if;
  begin
    perform public.save_store_whatsapp(other, '{"sender_id":"123456789012345"}');
    raise exception '3d: o mesmo número em duas lojas';
  exception when sqlstate 'P0409' then null;
  end;
  r := public.save_store_whatsapp(s, '{"enabled":false}');
  if (r ->> 'chat_enabled')::boolean then raise exception '3e: desligar os avisos não desligou a conversa'; end if;
  if r ->> 'sender_id' is null then raise exception '3f: desligar apagou o número'; end if;
  r := public.save_store_whatsapp(s, '{"enabled":true,"chat_enabled":true}');

  -- ── 4. Uso do mês: conta o entregue, por tipo, só desta loja ──────────
  insert into public.whatsapp_outbox (store_id, subject_type, subject_id, event, recipient, kind, payload, status, idempotency_key) values
    (s, 'conversation', 'a', 'chat.reply', '+258841230001', 'service', '{"type":"text","text":"x"}', 'delivered', 'pn:1'),
    (s, 'conversation', 'a', 'chat.reply', '+258841230001', 'service', '{"type":"text","text":"x"}', 'read', 'pn:2'),
    (s, 'conversation', 'a', 'chat.reply', '+258841230001', 'service', '{"type":"text","text":"x"}', 'sent', 'pn:3'),
    (s, 'conversation', 'a', 'chat.reply', '+258841230001', 'service', '{"type":"text","text":"x"}', 'failed', 'pn:4'),
    (other, 'conversation', 'b', 'chat.reply', '+258841230001', 'service', '{"type":"text","text":"x"}', 'delivered', 'pn:5');
  insert into public.whatsapp_outbox (store_id, subject_type, subject_id, event, recipient, kind, status, idempotency_key) values
    (s, 'order', 'o1', 'order.paid', '+258841230001', 'utility', 'read', 'pn:6');
  -- Mês anterior não conta.
  insert into public.whatsapp_outbox (store_id, subject_type, subject_id, event, recipient, kind, status, idempotency_key, created_at) values
    (s, 'order', 'o0', 'order.paid', '+258841230001', 'utility', 'read', 'pn:7', now() - interval '40 days');
  insert into public.whatsapp_inbound (store_id, provider_event_id, from_phone, content_type, body)
    values (s, 'pn:in:1', '+258841230001', 'text', 'olá');

  r := public.get_store_whatsapp(s) -> 'month';
  if (r ->> 'service_delivered')::int <> 2 or (r ->> 'utility_delivered')::int <> 1 or (r ->> 'failed')::int <> 1
     or (r ->> 'waiting')::int <> 1 or (r ->> 'inbound')::int <> 1 then
    raise exception '4a: contagem %', r;
  end if;

  -- ── 5. Número escondido: um recibo por mensagem, só com a conversa ligada ──
  if not public.whatsapp_receipt_once('pn:h1', '123456789012345') then raise exception '5a: primeira'; end if;
  if public.whatsapp_receipt_once('pn:h1', '123456789012345') then raise exception '5b: repetida'; end if;
  if public.whatsapp_receipt_once('pn:h2', 'PLACEHOLDER_NAO_EXISTE') then raise exception '5c: número desconhecido'; end if;
  perform public.save_store_whatsapp(s, '{"chat_enabled":false}');
  if public.whatsapp_receipt_once('pn:h3', '123456789012345') then raise exception '5d: conversa desligada'; end if;

  raise notice 'whatsapp_painel: todos os casos passaram';
end $test$;
