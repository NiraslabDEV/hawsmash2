-- 1138: facturação fiscal. Executar só localmente, numa transacção (os documentos são imutáveis: nunca numa base
-- partilhada nem com o NUIT real de um cliente):
--
--   (echo "begin;"; cat supabase/tests/fiscal.sql; echo "rollback;") | \
--     docker exec -i supabase_db_hawsmash2 psql -U postgres -v ON_ERROR_STOP=1
--
-- Para ensaiar a migration sem a aplicar, junta-se antes do ensaio, na mesma transacção:
--
--   (echo "begin;"; cat supabase/migrations/20261116120000_1138_facturacao_fiscal.sql supabase/tests/fiscal.sql; \
--    echo "rollback;") | docker exec -i supabase_db_hawsmash2 psql -U postgres -v ON_ERROR_STOP=1

create function pg_temp.mk_order(p_id uuid, p_store uuid, p_number text, p_items jsonb, p_discount integer default 0, p_delivery integer default 0, p_table uuid default null)
returns integer language plpgsql as $$
declare
  v_sub integer;
  v_total integer;
begin
  select sum((i ->> 'qty')::integer * (i ->> 'price')::integer) into v_sub from jsonb_array_elements(p_items) i;
  v_total := v_sub - p_discount + p_delivery;
  insert into public.orders (id, store_id, order_number, status, flow, fulfillment_type, channel, customer_name,
                             subtotal_cents, discount_cents, delivery_fee_cents, total_cents, payment_method, table_id)
  values (p_id, p_store, p_number, 'paid', 'manual', case when p_table is null then 'pickup' else 'dine_in' end,
          case when p_table is null then 'counter' else 'dine_in' end, 'PLACEHOLDER Cliente', v_sub, p_discount, p_delivery, v_total, 'cash', p_table);
  insert into public.order_items (order_id, store_id, name_snapshot, qty, unit_price_cents, station)
  select p_id, p_store, i ->> 'name', (i ->> 'qty')::integer, (i ->> 'price')::integer, 'kitchen' from jsonb_array_elements(p_items) i;
  return v_total;
end $$;

create function pg_temp.pay(p_order uuid, p_store uuid, p_amount integer, p_key text) returns void language sql as $$
  -- Hora real e não a do início da transacção: o ensaio corre todo numa só, e "antes/depois da activação" conta.
  insert into public.payments (order_id, store_id, provider, method, amount_cents, status, idempotency_key, created_at)
  values (p_order, p_store, 'counter', 'cash', p_amount, 'confirmed', p_key, clock_timestamp());
$$;

do $test$
declare
  s uuid := 'f1000000-0000-4000-8000-000000000001';
  other uuid := 'f1000000-0000-4000-8000-000000000002';
  owner_id uuid := 'f2000000-0000-4000-8000-000000000001';
  manager_id uuid := 'f2000000-0000-4000-8000-000000000002';
  kitchen_id uuid := 'f2000000-0000-4000-8000-000000000003';
  o_before uuid := 'f3000000-0000-4000-8000-000000000001';
  o1 uuid := 'f3000000-0000-4000-8000-000000000002';
  o2 uuid := 'f3000000-0000-4000-8000-000000000003';
  o3 uuid := 'f3000000-0000-4000-8000-000000000004';
  t1 uuid := 'f3000000-0000-4000-8000-000000000005';
  t2 uuid := 'f3000000-0000-4000-8000-000000000006';
  o_other uuid := 'f3000000-0000-4000-8000-000000000007';
  o_late uuid := 'f3000000-0000-4000-8000-000000000008';
  v_table uuid;
  v_bill uuid := 'f4000000-0000-4000-8000-000000000001';
  v_year text := to_char(clock_timestamp() at time zone 'Africa/Maputo', 'YYYY');
  d public.fiscal_documents;
  d2 public.fiscal_documents;
  r jsonb;
  n integer;
  v_total integer;
begin
  insert into auth.users (id) values (owner_id), (manager_id), (kitchen_id);
  insert into public.staff_profiles (user_id, full_name, role) values
    (owner_id, 'Teste dono', 'owner'), (manager_id, 'Teste gerente', 'manager'), (kitchen_id, 'Teste cozinha', 'kitchen');
  insert into public.stores (id, slug, name, short_name, order_prefix) values
    (s, 'fiscal-a', 'PLACEHOLDER_FA', 'FA', 'FSA'), (other, 'fiscal-b', 'PLACEHOLDER_FB', 'FB', 'FSB');
  insert into public.staff_stores (user_id, store_id) values (manager_id, s), (kitchen_id, s) on conflict do nothing;

  -- ── 0. O hash é o mesmo, byte a byte, do pacote TypeScript (packages/fiscal) ─
  if private.fiscal_hash('2026-11-16', '2026-11-16T10:20:30.123Z', 'FR MPT2026/000001', 90000, '', '')
     <> 'CqGwSCDlm5i/6joPfzp5T4cihBKfrD7+xOgzUj/qjdc=' then
    raise exception '0: hash diferente do pacote TypeScript';
  end if;

  -- ── 1. Desligada: a venda passa, sem documento ────────────────────────
  v_total := pg_temp.mk_order(o_before, s, 'FSA-0001', '[{"name":"PLACEHOLDER_A","qty":1,"price":10000}]');
  perform pg_temp.pay(o_before, s, v_total, 'fiscal-test-before');
  if (select count(*) from public.fiscal_documents where store_id in (s, other)) <> 0 then raise exception '1: emitiu com a facturação desligada'; end if;

  -- ── 2. Só o dono mexe nas definições; activar exige dados completos ───
  perform set_config('request.jwt.claim.sub', manager_id::text, true);
  begin
    perform public.save_fiscal_settings('{"active":true}');
    raise exception '2a: gerente gravou as definições';
  exception when sqlstate 'P0403' then null;
  end;
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  begin
    perform public.save_fiscal_settings('{"active":true,"legal_name":"PLACEHOLDER Empresa, Lda","nuit":"12345","address":"PLACEHOLDER morada"}');
    raise exception '2b: activou com NUIT inválido';
  exception when sqlstate 'P0400' then null;
  end;
  r := public.save_fiscal_settings('{"active":true,"legal_name":"PLACEHOLDER Empresa, Lda","nuit":"400 000 001","address":"PLACEHOLDER morada","regime":"normal","vat_bp":1600}');
  if not (r ->> 'active')::boolean or r ->> 'nuit' <> '400000001' or r ->> 'active_since' is null then raise exception '2c: activação errada: %', r; end if;

  -- ── 3. O que foi pago antes da activação nunca é facturado ────────────
  if public.fiscal_emit_pending() <> 0 then raise exception '3: facturou uma venda anterior à activação'; end if;

  -- ── 4. Duas vendas: numeração seguida, cadeia de hash, contas certas ──
  v_total := pg_temp.mk_order(o1, s, 'FSA-0002', '[{"name":"PLACEHOLDER_SMASH","qty":2,"price":40000},{"name":"PLACEHOLDER_REFRESCO","qty":1,"price":8000}]', 8000, 10000);
  if v_total <> 90000 then raise exception '4: total de ensaio %', v_total; end if;
  perform pg_temp.pay(o1, s, v_total, 'fiscal-test-1');
  select * into d from public.fiscal_documents where id = private.fiscal_active_document(o1);
  if d.full_number is distinct from 'FR FSA' || v_year || '/000001' then raise exception '4a: número %', d.full_number; end if;
  if d.total_cents <> 90000 or d.base_cents + d.vat_cents <> 90000 or d.previous_hash <> '' then raise exception '4b: totais %/%/%', d.base_cents, d.vat_cents, d.total_cents; end if;
  if d.buyer ->> 'name' <> 'Consumidor final' or d.issuer ->> 'nuit' <> '400000001' then raise exception '4c: emitente/adquirente'; end if;
  -- O desconto reparte-se pelos artigos, a entrega é linha própria, e a soma das linhas é o que o cliente pagou.
  if (select array_agg(l.total_cents order by l.position) from public.fiscal_document_lines l where l.document_id = d.id)
     is distinct from array[7272, 72728, 10000] then
    raise exception '4d: linhas %', (select array_agg(l.total_cents order by l.position) from public.fiscal_document_lines l where l.document_id = d.id);
  end if;
  if (select sum(l.base_cents) from public.fiscal_document_lines l where l.document_id = d.id) <> d.base_cents
     or (select sum(l.vat_cents) from public.fiscal_document_lines l where l.document_id = d.id) <> d.vat_cents
     or d.base_cents <> 6269 + 62697 + 8621 then
    raise exception '4e: IVA das linhas não soma o do documento (% + %)', d.base_cents, d.vat_cents;
  end if;

  v_total := pg_temp.mk_order(o2, s, 'FSA-0003', '[{"name":"PLACEHOLDER_A","qty":1,"price":11600}]');
  perform pg_temp.pay(o2, s, v_total, 'fiscal-test-2');
  select * into d2 from public.fiscal_documents where id = private.fiscal_active_document(o2);
  if d2.number <> 2 or d2.previous_hash <> d.hash or d2.base_cents <> 10000 or d2.vat_cents <> 1600 then raise exception '4f: segunda factura %', d2; end if;
  if d2.emitted_at < d.emitted_at then raise exception '4g: a hora recuou'; end if;
  -- Repetir o pagamento (outra linha de pagamento no mesmo pedido) não cria segunda factura.
  perform pg_temp.pay(o2, s, 100, 'fiscal-test-2-bis');
  if (select count(*) from public.fiscal_document_orders where order_id = o2) <> 1 then raise exception '4h: factura em duplicado'; end if;

  -- ── 5. Documento emitido não se altera nem se apaga ───────────────────
  begin update public.fiscal_documents set total_cents = 1, base_cents = 1, vat_cents = 0 where id = d.id; raise exception '5a: UPDATE passou';
  exception when sqlstate 'P0403' then null; end;
  begin delete from public.fiscal_documents where id = d.id; raise exception '5b: DELETE passou';
  exception when sqlstate 'P0403' then null; end;
  begin update public.fiscal_document_lines set description = 'x' where document_id = d.id; raise exception '5c: UPDATE da linha passou';
  exception when sqlstate 'P0403' then null; end;
  begin delete from public.fiscal_document_lines where document_id = d.id; raise exception '5d: DELETE da linha passou';
  exception when sqlstate 'P0403' then null; end;
  begin delete from public.fiscal_document_orders where document_id = d.id; raise exception '5e: DELETE da ligação passou';
  exception when sqlstate 'P0403' then null; end;
  begin execute 'truncate public.fiscal_document_lines'; raise exception '5f: TRUNCATE passou';
  exception when sqlstate 'P0403' then null; end;
  begin delete from public.fiscal_series where store_id = s; raise exception '5g: apagou a série';
  exception when sqlstate 'P0403' then null; end;

  -- ── 6. Anular = Nota de Crédito com motivo; anular outra vez não repete ─
  perform set_config('app.fiscal_reason', 'Cliente desistiu', true);
  update public.payments set status = 'refunded' where order_id = o1 and status = 'confirmed';
  perform set_config('app.fiscal_reason', '', true);
  select * into d2 from public.fiscal_documents where origin_id = d.id and doc_type = 'NC';
  if d2.full_number is distinct from 'NC FSA' || v_year || '/000001' or d2.reason <> 'Cliente desistiu' or d2.total_cents <> 90000
     or d2.origin_number <> d.full_number then
    raise exception '6a: nota de crédito %', d2;
  end if;
  if private.fiscal_active_document(o1) is not null then raise exception '6b: a factura anulada continua em vigor'; end if;
  if private.fiscal_credit_for_order(o1, 'outra vez') is not null then raise exception '6c: segunda nota de crédito'; end if;
  if (select count(*) from public.fiscal_documents where origin_id = d.id) <> 1 then raise exception '6d: mais de um documento sobre o anulado'; end if;

  -- ── 7. Conta de mesa: UMA factura para todos os lançamentos, só com tudo pago ─
  insert into public.tables (store_id, number) values (s, 991) returning id into v_table;
  perform pg_temp.mk_order(t1, s, 'FSA-0004', '[{"name":"PLACEHOLDER_A","qty":1,"price":20000}]', 0, 0, v_table);
  perform pg_temp.mk_order(t2, s, 'FSA-0005', '[{"name":"PLACEHOLDER_B","qty":3,"price":10000}]', 0, 0, v_table);
  insert into public.table_bills (id, store_id, table_id, table_number, client_close_id, order_ids, total_cents, payments)
  values (v_bill, s, v_table, 991, gen_random_uuid(), array[t1, t2], 50000, '[{"method":"cash","amount_cents":50000}]');
  perform pg_temp.pay(t1, s, 20000, 'fiscal-test-t1');
  if private.fiscal_active_document(t1) is not null then raise exception '7a: facturou a conta a meio'; end if;
  perform pg_temp.pay(t2, s, 10000, 'fiscal-test-t2a');
  perform pg_temp.pay(t2, s, 20000, 'fiscal-test-t2b');
  select * into d from public.fiscal_documents where id = private.fiscal_active_document(t1);
  if d.id is null or d.id <> private.fiscal_active_document(t2) or d.total_cents <> 50000 then raise exception '7b: factura da conta %', d; end if;
  if (select count(*) from public.fiscal_documents x where x.store_id = s and x.doc_type = 'FR') <> 3 then raise exception '7c: a conta gerou mais de uma factura'; end if;
  -- Anular um lançamento de uma conta facturada: NC do documento inteiro + FR nova para o que continua pago.
  update public.payments set status = 'refunded' where order_id = t1 and status = 'confirmed';
  select * into d2 from public.fiscal_documents where id = private.fiscal_active_document(t2);
  if d2.id = d.id or d2.total_cents <> 30000 or d2.origin_id <> d.id then raise exception '7d: factura do que continua pago %', d2; end if;
  if private.fiscal_active_document(t1) is not null then raise exception '7e: o lançamento anulado continua facturado'; end if;
  if not exists (select 1 from public.fiscal_documents x where x.origin_id = d.id and x.doc_type = 'NC' and x.total_cents = 50000) then raise exception '7f: falta a NC da conta'; end if;

  -- ── 8. NUIT pedido depois: NC + FR nova com o adquirente; só gerência ──
  v_total := pg_temp.mk_order(o3, s, 'FSA-0006', '[{"name":"PLACEHOLDER_A","qty":1,"price":5000}]');
  perform pg_temp.pay(o3, s, v_total, 'fiscal-test-3');
  perform set_config('request.jwt.claim.sub', kitchen_id::text, true);
  begin perform public.fiscal_reissue(o3, '400000009', 'PLACEHOLDER Cliente, Lda'); raise exception '8a: a cozinha reemitiu';
  exception when sqlstate 'P0403' then null; end;
  begin perform public.get_order_fiscal_documents(o3); raise exception '8b: a cozinha leu a factura';
  exception when sqlstate 'P0403' then null; end;
  perform set_config('request.jwt.claim.sub', manager_id::text, true);
  begin perform public.fiscal_reissue(o3, '123', 'PLACEHOLDER Cliente, Lda'); raise exception '8c: NUIT inválido aceite';
  exception when sqlstate 'P0400' then null; end;
  r := public.fiscal_reissue(o3, '400 000 009', 'PLACEHOLDER Cliente, Lda');
  if r -> 'buyer' ->> 'nuit' <> '400000009' or (r ->> 'total_cents')::integer <> 5000 or (r ->> 'voided')::boolean then raise exception '8d: reemissão %', r; end if;
  r := public.get_order_fiscal_documents(o3);
  if jsonb_array_length(r) <> 3 or length(r -> 0 ->> 'control_code') <> 4 or not (r -> 0 ->> 'voided')::boolean then raise exception '8e: documentos da venda %', r; end if;

  -- ── 9. A factura falhar não pára a venda; os pendentes emitem-se depois, uma vez ─
  -- Uma série com o nome da outra loja faz a emissão rebentar lá: o pagamento tem de ficar gravado na mesma.
  insert into public.fiscal_series (store_id, doc_type, series) values (s, 'FR', 'FSB' || v_year);
  v_total := pg_temp.mk_order(o_other, other, 'FSB-0001', '[{"name":"PLACEHOLDER_A","qty":1,"price":7000}]');
  perform pg_temp.pay(o_other, other, v_total, 'fiscal-test-other');
  if not exists (select 1 from public.payments where order_id = o_other and status = 'confirmed') then raise exception '9a: a venda parou'; end if;
  if private.fiscal_active_document(o_other) is not null then raise exception '9b: emitiu numa série de outra loja'; end if;
  if not exists (select 1 from public.event_log where order_id = o_other and type = 'fiscal.emit_failed') then raise exception '9c: a falha não ficou registada'; end if;

  execute 'alter table public.payments disable trigger payments_fiscal_document';
  v_total := pg_temp.mk_order(o_late, s, 'FSA-0007', '[{"name":"PLACEHOLDER_A","qty":1,"price":9000}]');
  perform pg_temp.pay(o_late, s, v_total, 'fiscal-test-late');
  execute 'alter table public.payments enable trigger payments_fiscal_document';
  perform set_config('request.jwt.claim.sub', manager_id::text, true);
  begin perform public.fiscal_emit_pending(); raise exception '9d: o gerente emitiu pendentes';
  exception when sqlstate 'P0403' then null; end;
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  n := public.fiscal_emit_pending();
  if n <> 1 or private.fiscal_active_document(o_late) is null then raise exception '9e: pendentes emitidos = %', n; end if;
  if public.fiscal_emit_pending() <> 0 then raise exception '9f: emitiu o mesmo pendente duas vezes'; end if;

  -- ── 10. Numeração sem buracos, hora que nunca recua, cadeia íntegra ───
  if exists (
    select 1 from (
      select number, lag(number) over w as prev_number, emitted_at, lag(emitted_at) over w as prev_at
        from public.fiscal_documents where store_id = s window w as (partition by series_id order by number)
    ) q where (prev_number is not null and number <> prev_number + 1) or (prev_at is not null and emitted_at < prev_at)
  ) then raise exception '10a: buraco na numeração ou hora a recuar'; end if;
  r := public.fiscal_verify_chain();
  if not (r ->> 'ok')::boolean then raise exception '10b: cadeia partida %', r; end if;

  -- ── 11. Ficheiro do mês: só o dono, com anulados e notas de crédito ───
  perform set_config('request.jwt.claim.sub', manager_id::text, true);
  begin
    perform public.fiscal_export_month(extract(year from now() at time zone 'Africa/Maputo')::integer, extract(month from now() at time zone 'Africa/Maputo')::integer);
    raise exception '11a: o gerente exportou';
  exception when sqlstate 'P0403' then null; end;
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  r := public.fiscal_export_month(extract(year from clock_timestamp() at time zone 'Africa/Maputo')::integer, extract(month from clock_timestamp() at time zone 'Africa/Maputo')::integer);
  select count(*) into n from jsonb_array_elements(r -> 'documents') x where x ->> 'store_id' = s::text;
  if n <> (select count(*) from public.fiscal_documents where store_id = s) or r -> 'issuer' ->> 'nuit' <> '400000001' then raise exception '11b: exportação com % documentos', n; end if;
  if not exists (select 1 from jsonb_array_elements(r -> 'documents') x where (x ->> 'voided')::boolean) then raise exception '11c: a exportação não marca os anulados'; end if;

  -- ── 12. Desligar não apaga nada nem emite mais ────────────────────────
  perform public.save_fiscal_settings('{"active":false,"legal_name":"PLACEHOLDER Empresa, Lda","nuit":"400000001","address":"PLACEHOLDER morada"}');
  select count(*) into n from public.fiscal_documents where store_id = s;
  perform pg_temp.pay(o_before, s, 100, 'fiscal-test-off');
  if (select count(*) from public.fiscal_documents where store_id = s) <> n then raise exception '12: emitiu depois de desligada'; end if;
  perform public.save_fiscal_settings('{"active":true,"legal_name":"PLACEHOLDER Empresa, Lda","nuit":"400000001","address":"PLACEHOLDER morada"}');
end $test$;

-- ── 13. Isolamento por loja (regra 3) e sem acesso anónimo ──────────────
select set_config('request.jwt.claim.sub', 'f2000000-0000-4000-8000-000000000002', true);
set local role authenticated;
do $rls$
begin
  if (select count(*) from public.fiscal_documents) = 0 then raise exception '13a: o gerente não vê as facturas da sua loja'; end if;
  if exists (select 1 from public.fiscal_documents where store_id <> 'f1000000-0000-4000-8000-000000000001') then raise exception '13b: o gerente vê facturas de outra loja'; end if;
  begin
    insert into public.fiscal_documents (store_id, doc_type, series_id, series, number, full_number, issue_date, emitted_at, issuer, buyer, base_cents, vat_cents, total_cents, hash, previous_hash)
    select store_id, doc_type, series_id, series, 999, 'FR X/999', issue_date, emitted_at, issuer, buyer, 0, 0, 0, 'x', 'x' from public.fiscal_documents limit 1;
    raise exception '13c: um utilizador inseriu um documento à mão';
  exception when insufficient_privilege then null; end;
  begin perform 1 from public.fiscal_settings; raise exception '13d: leu as definições sem ser pela função';
  exception when insufficient_privilege then null; end;
end $rls$;
reset role;
select set_config('request.jwt.claim.sub', 'f2000000-0000-4000-8000-000000000003', true);
set local role authenticated;
do $rls$ begin
  if exists (select 1 from public.fiscal_documents) then raise exception '13e: a cozinha vê facturas'; end if;
end $rls$;
reset role;
set local role anon;
do $rls$ begin
  begin perform 1 from public.fiscal_documents; raise exception '13f: anónimo leu facturas';
  exception when insufficient_privilege then null; end;
  begin perform public.fiscal_verify_chain(); raise exception '13g: anónimo chamou a verificação';
  exception when insufficient_privilege then null; end;
end $rls$;
reset role;
select 'fiscal: 13 grupos de verificações OK' as resultado;
