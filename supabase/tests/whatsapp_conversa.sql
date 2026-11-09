-- 1124 (conversas, portátil) + 1125 (pedido na conversa). Executar só localmente, numa transacção:
--
--   docker exec -i supabase_db_hawsmash2 psql -U postgres -v ON_ERROR_STOP=1 \
--     < <(echo begin; cat supabase/tests/whatsapp_conversa.sql; echo rollback)
--
-- Cada verificação levanta uma excepção com o número do caso; nada fica gravado.
do $test$
declare
  s uuid := gen_random_uuid();
  off_store uuid := gen_random_uuid();
  burger uuid := gen_random_uuid();
  v_phone constant text := '+258841230001';
  r jsonb;
  r2 jsonb;
  v_ids uuid[];
  v_ids2 uuid[];
  v_conv public.whatsapp_conversations;
  v_in public.whatsapp_inbound;
  v_inbound uuid;
  v_order uuid;
  v_site_order uuid;
  v_checkout uuid := gen_random_uuid();
  v_count integer;
  v_text text;
  v_payload jsonb;
begin
  -- ── Fixture ────────────────────────────────────────────────────────────
  insert into public.stores (id, slug, name, short_name, order_prefix, accepting_orders, delivery_enabled, pickup_enabled,
                             whatsapp_sender_id, whatsapp_enabled, whatsapp_chat_enabled, mpesa_number)
  values (s, 'wa-conversa', 'PLACEHOLDER_WA', 'WA', 'WAC', true, true, true, 'PLACEHOLDER_SENDER_CONV', true, true, '840000000'),
         (off_store, 'wa-sem-conversa', 'PLACEHOLDER_WA2', 'WA2', 'WAD', true, true, true, 'PLACEHOLDER_SENDER_OFF', true, false, null);
  update public.settings set accepting_orders = true where id = 1;
  insert into public.menu_items (id, category_id, name, price_cents, available)
    select burger, id, 'Burger WA teste', 45000, true from public.menu_categories order by sort limit 1;
  update public.store_items set available = true where store_id = s and menu_item_id = burger;

  -- ── 1. Interruptor: conversa só com os avisos ligados ─────────────────
  begin
    update public.stores set whatsapp_enabled = false where id = s;
    raise exception '1: conversa ligada com WhatsApp desligado';
  exception when check_violation then null;
  end;

  -- ── 2. Receber: nova, repetida, número desconhecido, loja sem conversa ──
  r := public.whatsapp_receive('wa:msg:t1', 'PLACEHOLDER_SENDER_CONV', v_phone, 'wamid.t1', 'text', 'olá', null, null, null, 'Ana', false);
  if not (r ->> 'is_new')::boolean or (r ->> 'chat_enabled')::boolean is not true or r ->> 'inbound_id' is null then
    raise exception '2a: recepção nova %', r;
  end if;
  v_inbound := (r ->> 'inbound_id')::uuid;
  r2 := public.whatsapp_receive('wa:msg:t1', 'PLACEHOLDER_SENDER_CONV', v_phone, 'wamid.t1', 'text', 'olá', null, null, null, 'Ana', false);
  if (r2 ->> 'is_new')::boolean or r2 ->> 'inbound_id' is not null then raise exception '2b: repetida processada outra vez %', r2; end if;
  if public.whatsapp_receive('wa:msg:t2', 'PLACEHOLDER_NAO_EXISTE', v_phone, 'm', 'text', 'x') is not null then
    raise exception '2c: número desconhecido gravou';
  end if;
  r := public.whatsapp_receive('wa:msg:t3', 'PLACEHOLDER_SENDER_OFF', v_phone, 'm3', 'text', 'olá');
  select * into v_in from public.whatsapp_inbound where id = (r ->> 'inbound_id')::uuid;
  if v_in.processed_at is null then raise exception '2d: loja sem conversa deixou mensagem por processar'; end if;
  select * into v_conv from public.whatsapp_conversations where store_id = s and phone = v_phone;
  if v_conv.last_inbound_at is null or v_conv.profile_name <> 'Ana' then raise exception '2e: janela de 24 h não registada'; end if;

  -- ── 3. SAIR cancela avisos, não as respostas da conversa ──────────────
  perform public.whatsapp_enqueue(s, 'order', 'aviso-1', 'order.paid', v_phone);
  v_ids := array(select public.whatsapp_enqueue_session(s, 'conversation', v_conv.id::text, v_phone,
    '[{"type":"text","text":"resposta"}]'::jsonb, 'in:optout'));
  perform public.whatsapp_receive('wa:msg:t4', 'PLACEHOLDER_SENDER_CONV', v_phone, 'm4', 'text', 'SAIR', null, null, null, null, true);
  if (select status from public.whatsapp_outbox where subject_id = 'aviso-1') <> 'cancelled' then raise exception '3a: aviso não cancelado'; end if;
  if (select status from public.whatsapp_outbox where id = v_ids[1]) <> 'queued' then raise exception '3b: resposta da conversa cancelada'; end if;
  perform public.whatsapp_claim(50);
  if (select status from public.whatsapp_outbox where id = v_ids[1]) = 'cancelled' then raise exception '3c: claim do cron cancelou a resposta'; end if;

  -- ── 4. Respostas: ordem e idempotência por mensagem recebida ──────────
  v_ids := array(select public.whatsapp_enqueue_session(s, 'conversation', v_conv.id::text, v_phone,
    '[{"type":"text","text":"um"},{"type":"text","text":"dois"}]'::jsonb, 'in:' || v_inbound));
  v_ids2 := array(select public.whatsapp_enqueue_session(s, 'conversation', v_conv.id::text, v_phone,
    '[{"type":"text","text":"um"},{"type":"text","text":"dois"}]'::jsonb, 'in:' || v_inbound));
  if v_ids <> v_ids2 or cardinality(v_ids) <> 2 then raise exception '4a: reprocessar criou respostas novas % %', v_ids, v_ids2; end if;
  if (select due_at from public.whatsapp_outbox where id = v_ids[1]) >= (select due_at from public.whatsapp_outbox where id = v_ids[2]) then
    raise exception '4b: ordem das respostas perdida';
  end if;
  if (select kind || ':' || (payload ->> 'text') from public.whatsapp_outbox where id = v_ids[2]) <> 'service:dois' then raise exception '4c: payload'; end if;
  begin
    perform public.whatsapp_enqueue_session(s, 'conversation', 'x', v_phone, '"nao-e-lista"'::jsonb, 'in:bad');
    raise exception '4d: aceitou mensagens que não são lista';
  exception when sqlstate 'P0400' then null;
  end;

  -- ── 5. Claim por ids: só uma vez ──────────────────────────────────────
  select count(*) into v_count from public.whatsapp_claim_ids(v_ids);
  if v_count <> 2 then raise exception '5a: claim_ids devolveu %', v_count; end if;
  select count(*) into v_count from public.whatsapp_claim_ids(v_ids);
  if v_count <> 0 then raise exception '5b: a mesma resposta foi reclamada duas vezes'; end if;

  -- ── 6. Estado com versão ──────────────────────────────────────────────
  v_conv := public.whatsapp_conversation_get(s, v_phone);
  if not public.whatsapp_conversation_save(v_conv.id, v_conv.version, '{"step":"idle"}') then raise exception '6a: gravar'; end if;
  if public.whatsapp_conversation_save(v_conv.id, v_conv.version, '{"step":"qty"}') then raise exception '6b: gravou por cima de outra mensagem'; end if;
  if (select state ->> 'step' from public.whatsapp_conversations where id = v_conv.id) <> 'idle' then raise exception '6c: estado errado'; end if;

  -- ── 7. Processamento da mensagem recebida: claim, erro, recuperação ───
  select count(*) into v_count from public.whatsapp_inbound_claim(v_inbound);
  if v_count <> 1 then raise exception '7a: claim'; end if;
  select count(*) into v_count from public.whatsapp_inbound_claim(v_inbound);
  if v_count <> 0 then raise exception '7b: dois processos na mesma mensagem'; end if;
  perform public.whatsapp_inbound_finish(v_inbound, 'menu_down');
  update public.whatsapp_inbound set received_at = now() - interval '1 minute' where id = v_inbound;
  if not v_inbound = any (array(select public.whatsapp_inbound_pending(50))) then raise exception '7c: cron não vê a mensagem falhada'; end if;
  perform public.whatsapp_inbound_claim(v_inbound);
  perform public.whatsapp_inbound_finish(v_inbound, null);
  if (select processed_at from public.whatsapp_inbound where id = v_inbound) is null then raise exception '7d: não ficou processada'; end if;
  if v_inbound = any (array(select public.whatsapp_inbound_pending(50))) then raise exception '7e: processada continua pendente'; end if;

  -- ── 8. Pedido criado na conversa: preço do servidor, idempotente ──────
  v_payload := jsonb_build_object('customerName', 'PLACEHOLDER Ana', 'customerPhone', '+258849999999',
    'fulfillmentType', 'pickup', 'paymentMethod', 'mpesa', 'flow', 'digital', 'notes', 'Pedido pelo WhatsApp',
    'items', jsonb_build_array(jsonb_build_object('menuItemId', burger, 'qty', 2, 'unitPriceCents', 1)));
  r := public.whatsapp_create_order(s, v_phone, v_checkout, v_payload);
  v_order := (r ->> 'order_id')::uuid;
  if not (r ->> 'created')::boolean or (r ->> 'total_cents')::integer <> 90000 then raise exception '8a: pedido %', r; end if;
  -- O create_order guarda o telefone no formato local; o do WhatsApp manda sempre sobre o do payload.
  if (select status || '|' || flow || '|' || private.whatsapp_phone_mz(customer_phone) from public.orders where id = v_order) <> 'awaiting_approval|manual|' || v_phone then
    raise exception '8b: estado/fluxo/telefone %', (select status || '|' || flow || '|' || customer_phone from public.orders where id = v_order);
  end if;
  r2 := public.whatsapp_create_order(s, v_phone, v_checkout, v_payload);
  if (r2 ->> 'order_id')::uuid <> v_order or (r2 ->> 'created')::boolean then raise exception '8c: segundo Confirmar criou outro pedido'; end if;
  select count(*) into v_count from public.whatsapp_checkouts where checkout_id = v_checkout;
  if v_count <> 1 then raise exception '8d: claim duplicado'; end if;
  if coalesce((select channel from public.order_attribution where order_id = v_order), '') <> 'whatsapp' then
    raise exception '8e: origem no funil não é whatsapp';
  end if;
  begin
    perform public.whatsapp_create_order(s, '+258841110000', v_checkout, v_payload);
    raise exception '8f: outro telefone reutilizou o checkout';
  exception when sqlstate 'P0409' then null;
  end;
  begin
    perform public.whatsapp_create_order(off_store, v_phone, gen_random_uuid(), v_payload);
    raise exception '8g: loja sem conversa criou pedido';
  exception when sqlstate 'P0403' then null;
  end;
  update public.stores set payment_provider = 'paysuite' where id = s;
  begin
    perform public.whatsapp_create_order(s, v_phone, gen_random_uuid(), v_payload);
    raise exception '8h: pagamento automático aceite na conversa';
  exception when sqlstate 'P0400' then
    get stacked diagnostics v_text = message_text;
    if v_text <> 'payment_not_manual' then raise; end if;
  end;
  update public.stores set payment_provider = 'manual' where id = s;
  -- Erro do create_order desfaz o claim: a pessoa corrige e confirma outra vez com o mesmo id.
  v_checkout := gen_random_uuid();
  begin
    perform public.whatsapp_create_order(s, v_phone, v_checkout, v_payload || '{"items":[]}'::jsonb);
    raise exception '8i: carrinho vazio aceite';
  exception when others then
    if sqlerrm like '8i:%' then raise; end if;
  end;
  if exists (select 1 from public.whatsapp_checkouts where checkout_id = v_checkout) then raise exception '8j: claim ficou depois do erro'; end if;

  -- ── 9. Pedido à espera de comprovativo, incluindo o do site ───────────
  r := public.whatsapp_pending_order(s, v_phone);
  if (r ->> 'order_id')::uuid <> v_order then raise exception '9a: pendente %', r; end if;
  insert into public.orders (id, store_id, order_number, status, flow, fulfillment_type, channel, customer_name, customer_phone,
                             subtotal_cents, total_cents, payment_method)
  values (gen_random_uuid(), s, 'PLACEHOLDER_SITE', 'awaiting_approval', 'manual', 'pickup', 'pickup', 'PLACEHOLDER Site',
          '84 123 0002', 5000, 5000, 'mpesa')
  returning id into v_site_order;
  if (public.whatsapp_pending_order(s, '+258841230002') ->> 'order_id')::uuid <> v_site_order then
    raise exception '9b: pedido do site não encontrado pelo número normalizado';
  end if;
  if public.whatsapp_pending_order(off_store, v_phone) is not null then raise exception '9c: outra loja viu o pedido'; end if;

  -- ── 10. Comprovativo pela conversa ────────────────────────────────────
  begin
    perform public.whatsapp_attach_proof(s, v_phone, v_order, '../outro/ficheiro.jpg');
    raise exception '10a: caminho de outro sítio aceite';
  exception when sqlstate 'P0020' then null;
  end;
  begin
    perform public.whatsapp_attach_proof(s, '+258841110000', v_order, v_order || '/whatsapp-abc.jpg');
    raise exception '10b: outro telefone anexou';
  exception when sqlstate 'P0403' then null;
  end;
  perform public.whatsapp_attach_proof(s, v_phone, v_order, v_order || '/whatsapp-abc.jpg');
  if (select payment_proof_path from public.orders where id = v_order) <> v_order || '/whatsapp-abc.jpg' then raise exception '10c: não anexou'; end if;
  begin
    perform public.whatsapp_attach_proof(s, v_phone, v_order, v_order || '/whatsapp-def.jpg');
    raise exception '10d: segundo comprovativo substituiu o primeiro';
  exception when sqlstate 'P0021' then null;
  end;
  if public.whatsapp_pending_order(s, v_phone) ->> 'order_id' = v_order::text then raise exception '10e: continua à espera'; end if;

  -- ── 11. Isolamento: anon não lê; RLS ligada ───────────────────────────
  if has_table_privilege('anon', 'public.whatsapp_conversations', 'select')
     or has_table_privilege('anon', 'public.whatsapp_checkouts', 'select') then
    raise exception '11a: anon com acesso às conversas';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.whatsapp_conversations'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.whatsapp_checkouts'::regclass) then
    raise exception '11b: RLS desligada';
  end if;
  if has_function_privilege('anon', 'public.whatsapp_create_order(uuid, text, uuid, jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.whatsapp_attach_proof(uuid, text, uuid, text)', 'execute') then
    raise exception '11c: RPC do servidor exposta ao browser';
  end if;

  raise notice 'whatsapp_conversa: todos os casos passaram';
end $test$;
