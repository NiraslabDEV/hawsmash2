-- 1140: adquirente pedido antes de pagar, talão fiscal, 2.ª via, lista e reemissão com morada.
-- Correr só localmente, em ROLLBACK:  node scripts/fiscal-local.mjs fiscal_1140
do $test$
declare
  s uuid := gen_random_uuid(); other uuid := gen_random_uuid();
  owner_id uuid := gen_random_uuid(); cashier_id uuid := gen_random_uuid(); kitchen_id uuid := gen_random_uuid(); other_cashier uuid := gen_random_uuid();
  dev uuid := gen_random_uuid(); item uuid := gen_random_uuid(); cat uuid := gen_random_uuid(); t uuid := gen_random_uuid();
  sale_key uuid := gen_random_uuid(); close_key uuid := gen_random_uuid(); checkout_key uuid := gen_random_uuid();
  sale jsonb; r jsonb; o uuid; a uuid; b uuid; online uuid; d public.fiscal_documents; j public.print_jobs; n integer;
begin
  insert into auth.users(id) values (owner_id), (cashier_id), (kitchen_id), (other_cashier);
  insert into public.staff_profiles(user_id, full_name, role) values
    (owner_id, 'PLACEHOLDER Dono', 'owner'), (cashier_id, 'PLACEHOLDER Caixa', 'cashier'),
    (kitchen_id, 'PLACEHOLDER Cozinha', 'kitchen'), (other_cashier, 'PLACEHOLDER Caixa B', 'cashier');
  insert into public.stores(id, slug, name, short_name, order_prefix, accepting_orders, counter_enabled, pickup_enabled, payment_provider, phone)
  values (s, 'fiscal-1140', 'PLACEHOLDER Loja', 'FQA', 'FQA', true, true, true, 'manual', '+258 84 000 0000'),
         (other, 'fiscal-1140-b', 'PLACEHOLDER Loja B', 'FQB', 'FQB', true, true, true, 'manual', null);
  insert into public.staff_stores(user_id, store_id) values (cashier_id, s), (kitchen_id, s), (other_cashier, other) on conflict do nothing;
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  insert into public.devices(id, store_id, kind, label, device_key_hash) values (dev, s, 'pos', 'PLACEHOLDER POS', repeat('0', 64));
  perform public.open_cash_session(s, 0);
  insert into public.menu_categories(id, name) values (cat, 'PLACEHOLDER Categoria');
  insert into public.menu_items(id, category_id, name, price_cents, available) values (item, cat, 'PLACEHOLDER Artigo', 11600, true);
  update public.store_items set available = true, track_stock = false where store_id = s and menu_item_id = item;
  insert into public.tables(id, store_id, number) values (t, s, 988);
  perform public.save_fiscal_settings('{"active":true,"legal_name":"PLACEHOLDER Empresa","nuit":"400000001","address":"PLACEHOLDER Sede","regime":"normal","vat_bp":1600}');

  -- ── 1. Pedir o NUIT antes de pagar: quem vende na loja; a cozinha e outra loja não ─
  if not (public.fiscal_status() ->> 'active')::boolean then raise exception '1a: fiscal_status'; end if;
  perform set_config('request.jwt.claim.sub', kitchen_id::text, true);
  begin perform public.stage_fiscal_buyer(s, sale_key, '400000009', 'PLACEHOLDER Cliente', null); raise exception '1b: a cozinha pediu factura';
  exception when sqlstate 'P0403' then null; end;
  perform set_config('request.jwt.claim.sub', other_cashier::text, true);
  begin perform public.stage_fiscal_buyer(s, sale_key, '400000009', 'PLACEHOLDER Cliente', null); raise exception '1c: caixa de outra loja';
  exception when sqlstate 'P0403' then null; end;
  perform set_config('request.jwt.claim.sub', cashier_id::text, true);
  begin perform public.stage_fiscal_buyer(s, sale_key, '12345', 'PLACEHOLDER Cliente', null); raise exception '1d: NUIT inválido aceite';
  exception when sqlstate 'P0400' then null; end;
  begin perform public.stage_fiscal_buyer(s, sale_key, '400000009', '   ', null); raise exception '1e: nome vazio aceite';
  exception when sqlstate 'P0400' then null; end;
  r := public.stage_fiscal_buyer(s, sale_key, '400 000 009', '  PLACEHOLDER   Cliente, Lda ', ' PLACEHOLDER Rua 5 ');
  if r ->> 'nuit' <> '400000009' or r ->> 'name' <> 'PLACEHOLDER Cliente, Lda' or r ->> 'address' <> 'PLACEHOLDER Rua 5' then raise exception '1f: limpeza %', r; end if;

  -- ── 2. A venda sai com o adquirente pedido, com morada; o talão fiscal fica na fila ─
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  sale := jsonb_build_object('deviceId', dev, 'clientSaleId', sale_key, 'fulfillmentType', 'counter',
    'items', jsonb_build_array(jsonb_build_object('menuItemId', item, 'qty', 1)), 'payments', '[{"method":"cash","amountCents":11600}]'::jsonb,
    'cashReceivedCents', 20000);
  r := public.create_counter_sale(sale); o := (r ->> 'order_id')::uuid;
  select * into d from public.fiscal_documents where id = private.fiscal_active_document(o);
  if d.buyer ->> 'nuit' <> '400000009' or d.buyer ->> 'address' <> 'PLACEHOLDER Rua 5' or d.issuer ->> 'store_phone' <> '+258 84 000 0000' then
    raise exception '2a: adquirente %', d.buyer;
  end if;
  select * into j from public.print_jobs where order_id = o and kind = 'fiscal';
  if j.id is null or j.station <> 'counter' or j.reprint_seq <> 0 or j.payload ->> 'template' <> 'fiscal' or j.payload ->> 'via' <> 'Original'
     or j.payload ->> 'full_number' <> d.full_number or (j.payload ->> 'cash_received_cents')::integer <> 20000
     or (j.payload ->> 'change_cents')::integer <> 8400 or jsonb_array_length(j.payload -> 'lines') <> 1 then
    raise exception '2b: talão %', j.payload;
  end if;
  -- Uma bridge antiga não pode imprimir isto no formato herdado: o payload não traz os campos dele.
  if j.payload ? 'customer_name' or j.payload ? 'items' then raise exception '2c: payload com campos do formato herdado'; end if;

  -- ── 3. Depois de facturada, o adquirente só muda por reemissão ───────────
  perform set_config('request.jwt.claim.sub', cashier_id::text, true);
  begin perform public.stage_fiscal_buyer(s, sale_key, '400000010', 'PLACEHOLDER Outro', null); raise exception '3a: mudou adquirente facturado';
  exception when sqlstate 'P0409' then null; end;

  -- ── 4. 2.ª via: caixa pode, cozinha não; cada via é um trabalho novo ─────
  r := public.reprint_fiscal_document(d.id);
  select * into j from public.print_jobs where id = (r ->> 'job_id')::uuid;
  if j.reprint_seq <> 1 or j.payload ->> 'via' <> '2.ª via' then raise exception '4a: 2.ª via %', j; end if;
  if not exists (select 1 from public.event_log where type = 'fiscal.reprinted' and actor_user_id = cashier_id) then raise exception '4b: sem registo'; end if;
  perform set_config('request.jwt.claim.sub', kitchen_id::text, true);
  begin perform public.reprint_fiscal_document(d.id); raise exception '4c: cozinha reimprimiu';
  exception when sqlstate 'P0403' then null; end;
  begin perform public.get_fiscal_document(d.id); raise exception '4d: cozinha leu o documento';
  exception when sqlstate 'P0403' then null; end;

  -- ── 5. Conta de mesa: o NUIT pedido pela chave do fecho ───────────────────
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  r := public.launch_table_order(sale || jsonb_build_object('clientSaleId', gen_random_uuid(), 'tableId', t) - 'cashReceivedCents'); a := (r ->> 'order_id')::uuid;
  r := public.launch_table_order(sale || jsonb_build_object('clientSaleId', gen_random_uuid(), 'tableId', t) - 'cashReceivedCents'); b := (r ->> 'order_id')::uuid;
  perform public.stage_fiscal_buyer(s, close_key, '400000011', 'PLACEHOLDER Mesa, Lda', 'PLACEHOLDER Av. 1');
  perform public.close_table_bill(jsonb_build_object('clientCloseId', close_key, 'deviceId', dev, 'tableId', t, 'expectedTotalCents', 23200,
    'payments', '[{"method":"mpesa","amountCents":23200}]'::jsonb));
  select * into d from public.fiscal_documents where id = private.fiscal_active_document(a);
  if d.buyer ->> 'nuit' <> '400000011' or d.id <> private.fiscal_active_document(b) then raise exception '5a: conta da mesa %', d.buyer; end if;

  -- ── 6. Site: pede a factura com o id do pedido acabado de criar (comprovativo), como anónimo ─
  online := public.create_order('fiscal-1140', jsonb_build_object('customerName', 'PLACEHOLDER Cliente', 'customerPhone', '840000002',
    'fulfillmentType', 'pickup', 'paymentMethod', 'mpesa', 'items', jsonb_build_array(jsonb_build_object('menuItemId', item, 'qty', 1))));
  perform set_config('request.jwt.claim.sub', '', true);
  set local role anon;
  perform public.stage_checkout_fiscal_buyer('fiscal-1140', online, '400000012', 'PLACEHOLDER Site, Lda', null);
  perform public.stage_checkout_fiscal_buyer('fiscal-1140', checkout_key, '400000014', 'PLACEHOLDER Antes, Lda', null);
  begin perform 1 from public.fiscal_buyer_requests; raise exception '6a: anónimo leu a fila';
  exception when insufficient_privilege then null; end;
  reset role;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform public.confirm_payment('fiscal-1140-' || online, online, 'manual', null, 'mpesa', 11600, '{}');
  perform set_config('request.jwt.claims', '{}', true);
  select * into d from public.fiscal_documents where id = private.fiscal_active_document(online);
  if d.buyer ->> 'nuit' <> '400000012' then raise exception '6b: site %', d.buyer; end if;
  -- Pedido já pago: tarde de mais para pedir pelo site.
  set local role anon;
  begin perform public.stage_checkout_fiscal_buyer('fiscal-1140', online, '400000015', 'PLACEHOLDER Tarde', null); raise exception '6c: pediu depois de pago';
  exception when sqlstate 'P0409' then null; end;
  reset role;

  -- ── 7. Reemissão com morada; lista com pesquisa e por loja ───────────────
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  r := public.fiscal_reissue(online, '400000013', 'PLACEHOLDER Reemitido, Lda', 'PLACEHOLDER Rua 9');
  if r -> 'buyer' ->> 'address' <> 'PLACEHOLDER Rua 9' then raise exception '7a: reemissão %', r -> 'buyer'; end if;
  r := public.list_fiscal_documents(s, null, null, '400000013', null, 50, 0);
  if (r ->> 'total')::integer <> 1 then raise exception '7b: pesquisa por NUIT %', r; end if;
  r := public.list_fiscal_documents(s, null, null, null, 'NC', 50, 0);
  if (r ->> 'total')::integer <> 1 then raise exception '7c: filtro NC %', r; end if;
  r := public.list_fiscal_documents(null, null, null, null, null, 2, 0);
  if jsonb_array_length(r -> 'rows') <> 2 or (r ->> 'total')::integer < 5 then raise exception '7d: paginação %', r ->> 'total'; end if;
  perform set_config('request.jwt.claim.sub', other_cashier::text, true);
  r := public.list_fiscal_documents(null, null, null, null, null, 50, 0);
  if (r ->> 'total')::integer <> 0 then raise exception '7e: caixa de outra loja vê % documentos', r ->> 'total'; end if;
  begin perform public.list_fiscal_documents(s, null, null, null, null, 50, 0); raise exception '7f: pediu loja alheia';
  exception when sqlstate 'P0403' then null; end;

  -- ── 8. Sem impressão automática não há talão; a cadeia continua íntegra ─
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  perform public.save_fiscal_settings('{"active":true,"legal_name":"PLACEHOLDER Empresa","nuit":"400000001","address":"PLACEHOLDER Sede","auto_print":false}');
  r := public.create_counter_sale(sale || jsonb_build_object('clientSaleId', gen_random_uuid()) - 'cashReceivedCents'); o := (r ->> 'order_id')::uuid;
  if private.fiscal_active_document(o) is null or exists (select 1 from public.print_jobs where order_id = o and kind = 'fiscal') then
    raise exception '8a: auto_print desligado';
  end if;
  if not (public.fiscal_verify_chain() ->> 'ok')::boolean then raise exception '8b: cadeia %', public.fiscal_verify_chain(); end if;
  if (public.get_fiscal_settings() ->> 'pending')::integer <> 0 then raise exception '8c: pendentes %', public.get_fiscal_settings() ->> 'pending'; end if;
end $test$;
select 'fiscal_1140: adquirente, talão, 2.ª via, mesa, site, reemissão, lista e isolamento OK' as resultado;
