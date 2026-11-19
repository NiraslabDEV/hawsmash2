-- 1141: Escritório. Correr só localmente, em ROLLBACK:  node scripts/fiscal-local.mjs escritorio
do $test$
declare
  s uuid := gen_random_uuid(); other uuid := gen_random_uuid();
  owner_id uuid := gen_random_uuid(); manager_id uuid := gen_random_uuid(); cashier_id uuid := gen_random_uuid(); manager_b uuid := gen_random_uuid();
  dev uuid := gen_random_uuid(); item uuid := gen_random_uuid(); cat uuid := gen_random_uuid();
  r jsonb; inv jsonb; ob jsonb; ob_store jsonb; doc jsonb; emp jsonb; acc jsonb; token text; n integer;
  y integer := extract(year from (now() at time zone 'Africa/Maputo'))::integer;
  m integer := extract(month from (now() at time zone 'Africa/Maputo'))::integer;
  today date := (now() at time zone 'Africa/Maputo')::date;
  row_month jsonb;
begin
  insert into auth.users(id) values (owner_id), (manager_id), (cashier_id), (manager_b);
  insert into public.staff_profiles(user_id, full_name, role) values
    (owner_id, 'PLACEHOLDER Dono', 'owner'), (manager_id, 'PLACEHOLDER Gerente', 'manager'),
    (cashier_id, 'PLACEHOLDER Caixa', 'cashier'), (manager_b, 'PLACEHOLDER Gerente B', 'manager');
  insert into public.stores(id, slug, name, short_name, order_prefix, accepting_orders, counter_enabled, pickup_enabled, payment_provider)
  values (s, 'esc-a', 'PLACEHOLDER Loja A', 'ESA', 'ESA', true, true, true, 'manual'),
         (other, 'esc-b', 'PLACEHOLDER Loja B', 'ESB', 'ESB', true, true, true, 'manual');
  insert into public.staff_stores(user_id, store_id) values (manager_id, s), (cashier_id, s), (manager_b, other) on conflict do nothing;

  -- ── 1. Compras: gerente regista na sua loja; caixa e loja alheia não ─────
  perform set_config('request.jwt.claim.sub', cashier_id::text, true);
  begin perform public.save_supplier_invoice(jsonb_build_object('store_id', s, 'supplier_name', 'X', 'invoice_number', '1',
    'invoice_date', today, 'total_cents', 11600, 'vat_cents', 1600)); raise exception '1a: caixa registou compra';
  exception when sqlstate 'P0403' then null; end;
  perform set_config('request.jwt.claim.sub', manager_b::text, true);
  begin perform public.save_supplier_invoice(jsonb_build_object('store_id', s, 'supplier_name', 'X', 'invoice_number', '1',
    'invoice_date', today, 'total_cents', 11600, 'vat_cents', 1600)); raise exception '1b: gerente de outra loja';
  exception when sqlstate 'P0403' then null; end;
  perform set_config('request.jwt.claim.sub', manager_id::text, true);
  begin perform public.save_supplier_invoice(jsonb_build_object('store_id', s, 'supplier_name', 'X', 'supplier_nuit', '123', 'invoice_number', '1',
    'invoice_date', today, 'total_cents', 11600, 'vat_cents', 1600)); raise exception '1c: NUIT inválido';
  exception when sqlstate 'P0400' then null; end;
  begin perform public.save_supplier_invoice(jsonb_build_object('store_id', s, 'supplier_name', 'X', 'invoice_number', '1',
    'invoice_date', today, 'total_cents', 1000, 'vat_cents', 1000)); raise exception '1d: IVA igual ao total';
  exception when check_violation then null; end;
  inv := public.save_supplier_invoice(jsonb_build_object('store_id', s, 'supplier_name', ' PLACEHOLDER Fornecedor ', 'supplier_nuit', '400 000 020',
    'invoice_number', 'FT 2026/77', 'invoice_date', today, 'category', 'mercadoria', 'total_cents', 116000, 'vat_cents', 16000));
  if inv ->> 'supplier_name' <> 'PLACEHOLDER Fornecedor' or inv ->> 'supplier_nuit' <> '400000020' then raise exception '1e: %', inv; end if;
  begin perform public.save_supplier_invoice(jsonb_build_object('store_id', s, 'supplier_name', 'PLACEHOLDER Fornecedor', 'supplier_nuit', '400000020',
    'invoice_number', 'ft 2026/77', 'invoice_date', today, 'total_cents', 5000, 'vat_cents', 0)); raise exception '1f: factura repetida';
  exception when sqlstate 'P0409' then null; end;
  perform public.save_supplier_invoice(jsonb_build_object('store_id', s, 'supplier_name', 'PLACEHOLDER Renda', 'invoice_number', 'R-1',
    'invoice_date', today, 'category', 'renda', 'total_cents', 50000, 'vat_cents', 0, 'deductible', false));
  -- Editar fica com rasto; anular exige motivo e sai das contas.
  inv := public.save_supplier_invoice(inv || jsonb_build_object('total_cents', 232000, 'vat_cents', 32000));
  if not exists (select 1 from public.event_log where type = 'office.purchase_updated' and (payload -> 'before' ->> 'total_cents')::integer = 116000) then
    raise exception '1g: edição sem rasto';
  end if;

  -- ── 2. Resumo do mês: vendas, IVA liquidado, IVA das compras ─────────────
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  perform public.save_fiscal_settings('{"active":true,"legal_name":"PLACEHOLDER Empresa","nuit":"400000001","address":"PLACEHOLDER Sede","regime":"normal","vat_bp":1600}');
  insert into public.devices(id, store_id, kind, label, device_key_hash) values (dev, s, 'pos', 'PLACEHOLDER POS', repeat('0', 64));
  perform public.open_cash_session(s, 0);
  insert into public.menu_categories(id, name) values (cat, 'PLACEHOLDER Categoria');
  insert into public.menu_items(id, category_id, name, price_cents, available) values (item, cat, 'PLACEHOLDER Artigo', 11600, true);
  update public.store_items set available = true, track_stock = false where store_id = s and menu_item_id = item;
  r := public.create_counter_sale(jsonb_build_object('deviceId', dev, 'clientSaleId', gen_random_uuid(), 'fulfillmentType', 'counter',
    'items', jsonb_build_array(jsonb_build_object('menuItemId', item, 'qty', 2)), 'payments', '[{"method":"cash","amountCents":23200}]'::jsonb, 'cashReceivedCents', 23200));
  r := public.office_month_summary(y, m);
  select x into row_month from jsonb_array_elements(r -> 'stores') x where x ->> 'store_id' = s::text;
  if (row_month ->> 'fr_count')::integer <> 1 or (row_month ->> 'sales_total_cents')::integer <> 23200
     or (row_month ->> 'vat_output_cents')::integer <> 3200 or (row_month ->> 'vat_input_cents')::integer <> 32000
     or (row_month ->> 'vat_balance_cents')::integer <> -28800 or (row_month ->> 'purchases_count')::integer <> 2
     or (row_month -> 'by_method' ->> 'cash')::integer <> 23200 then
    raise exception '2a: resumo %', row_month;
  end if;
  perform set_config('request.jwt.claim.sub', manager_id::text, true);
  perform public.void_supplier_invoice((inv ->> 'id')::uuid, 'PLACEHOLDER Lançada em duplicado');
  r := public.office_month_summary(y, m);
  if jsonb_array_length(r -> 'stores') <> 1 then raise exception '2b: gerente vê % lojas', jsonb_array_length(r -> 'stores'); end if;
  if (r -> 'stores' -> 0 ->> 'vat_input_cents')::integer <> 0 or (r -> 'stores' -> 0 ->> 'purchases_count')::integer <> 1 then raise exception '2c: anulada nas contas %', r; end if;
  begin perform public.void_supplier_invoice((inv ->> 'id')::uuid, ''); exception when sqlstate 'P0400' then null; end;
  perform set_config('request.jwt.claim.sub', cashier_id::text, true);
  begin perform public.office_month_summary(y, m); raise exception '2d: caixa leu o resumo';
  exception when sqlstate 'P0403' then null; end;

  -- ── 3. Obrigações: o dono define; prazo próximo dá aviso; marcar feito tira-o ─
  perform set_config('request.jwt.claim.sub', manager_id::text, true);
  begin perform public.save_office_obligation('{"title":"X","recurrence":"monthly","due_day":10}'); raise exception '3a: gerente criou obrigação';
  exception when sqlstate 'P0403' then null; end;
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  begin perform public.save_office_obligation('{"title":"X","recurrence":"monthly"}'); raise exception '3b: mensal sem dia';
  exception when check_violation then null; end;
  ob := public.save_office_obligation(jsonb_build_object('title', 'PLACEHOLDER e-Declaração', 'recurrence', 'monthly', 'due_rule', 'last_business_day',
    'remind_days', 31));
  ob_store := public.save_office_obligation(jsonb_build_object('store_id', s, 'title', 'PLACEHOLDER Extintores', 'recurrence', 'once',
    'due_date', today - 1, 'remind_days', 0));
  r := public.office_alerts_all();
  if not exists (select 1 from jsonb_array_elements(r) a where a ->> 'kind' = 'obligation_due' and a ->> 'title' = 'PLACEHOLDER e-Declaração'
                 and a ->> 'period' = to_char((date_trunc('month', today) - interval '1 month'), 'YYYY-MM')) then
    raise exception '3c: sem aviso da obrigação mensal %', r;
  end if;
  if not exists (select 1 from jsonb_array_elements(r) a where a ->> 'kind' = 'obligation_overdue' and a ->> 'title' = 'PLACEHOLDER Extintores') then
    raise exception '3d: sem aviso em atraso';
  end if;
  -- O gerente marca a da sua loja; a da empresa é do dono.
  perform set_config('request.jwt.claim.sub', manager_id::text, true);
  perform public.mark_office_obligation((ob_store ->> 'id')::uuid, 'once', true, 'PLACEHOLDER feito');
  begin perform public.mark_office_obligation((ob ->> 'id')::uuid, to_char((date_trunc('month', today) - interval '1 month'), 'YYYY-MM'), true, null);
    raise exception '3e: gerente marcou obrigação da empresa';
  exception when sqlstate 'P0403' then null; end;
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  perform public.mark_office_obligation((ob ->> 'id')::uuid, to_char((date_trunc('month', today) - interval '1 month'), 'YYYY-MM'), true, null);
  r := public.office_alerts_all();
  if exists (select 1 from jsonb_array_elements(r) a where a ->> 'title' in ('PLACEHOLDER Extintores')
             or (a ->> 'title' = 'PLACEHOLDER e-Declaração' and a ->> 'period' = to_char((date_trunc('month', today) - interval '1 month'), 'YYYY-MM'))) then
    raise exception '3f: aviso continua depois de feito %', r;
  end if;
  if private.office_due_in_month(2026, 2, 'last_business_day', null) <> '2026-02-27' then raise exception '3g: último dia útil de Fev/2026'; end if;
  if private.office_due_in_month(2026, 2, 'day', 31) <> '2026-02-28' then raise exception '3h: dia 31 em Fevereiro'; end if;

  -- ── 4. Arquivo: a caducar dá aviso; o da empresa só o dono grava ─────────
  perform set_config('request.jwt.claim.sub', manager_id::text, true);
  begin perform public.save_office_document(jsonb_build_object('title', 'X', 'expires_on', today + 5)); raise exception '4a: gerente gravou documento da empresa';
  exception when sqlstate 'P0403' then null; end;
  doc := public.save_office_document(jsonb_build_object('store_id', s, 'title', 'PLACEHOLDER Licença sanitária', 'category', 'licenca',
    'expires_on', today + 10, 'remind_days', 30));
  if not exists (select 1 from jsonb_array_elements(public.office_alerts_all()) a where a ->> 'kind' = 'document_expiring' and a ->> 'title' = 'PLACEHOLDER Licença sanitária') then
    raise exception '4b: sem aviso de validade';
  end if;
  perform public.save_office_document(doc || '{"archived":true}');
  if exists (select 1 from jsonb_array_elements(public.office_alerts_all()) a where a ->> 'title' = 'PLACEHOLDER Licença sanitária') then raise exception '4c: arquivado ainda avisa'; end if;

  -- ── 5. Pessoal: só o dono, nem o gerente lê ──────────────────────────────
  begin perform public.save_office_employee('{"full_name":"X"}'); raise exception '5a: gerente gravou pessoal';
  exception when sqlstate 'P0403' then null; end;
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  begin perform public.save_office_employee('{"full_name":"X","nuit":"12"}'); raise exception '5b: NUIT inválido';
  exception when sqlstate 'P0400' then null; end;
  emp := public.save_office_employee(jsonb_build_object('store_id', s, 'full_name', 'PLACEHOLDER Trabalhador', 'nuit', '400000030',
    'inss_number', 'PLACEHOLDER-INSS', 'base_salary_cents', 1500000, 'hired_on', '2026-01-10'));
  if exists (select 1 from public.event_log where type = 'office.employee_saved' and payload ? 'base_salary_cents') then raise exception '5c: salário no registo'; end if;

  -- ── 6. Contabilista: token visto uma vez, guardado em hash, revogável ────
  acc := public.create_accountant_access('PLACEHOLDER Contabilista', 30);
  token := acc ->> 'token';
  if length(token) <> 48 or exists (select 1 from public.accountant_access where token_hash = token) then raise exception '6a: token %', acc; end if;
  r := public.accountant_portal(token);
  if r -> 'company' ->> 'nuit' <> '400000001' or jsonb_array_length(r -> 'months') <> 6 then raise exception '6b: portal %', r; end if;
  if r::text like '%PLACEHOLDER Trabalhador%' or r::text like '%PLACEHOLDER Cliente%' then raise exception '6c: o portal mostra pessoal ou clientes'; end if;
  r := public.accountant_month_export(token, y, m);
  if jsonb_array_length(r -> 'documents') < 1 or jsonb_array_length(r -> 'purchases') < 1 then raise exception '6d: exportação %', r; end if;
  if not exists (select 1 from public.event_log where type = 'office.accountant_exported') then raise exception '6e: exportação sem registo'; end if;
  perform public.revoke_accountant_access((acc ->> 'id')::uuid);
  begin perform public.accountant_portal(token); raise exception '6f: token revogado ainda entra';
  exception when sqlstate 'P0403' then null; end;
  begin perform public.accountant_portal(repeat('a', 48)); raise exception '6g: token inventado entra';
  exception when sqlstate 'P0403' then null; end;
end $test$;

-- ── 7. RLS: leitura por perfil e loja; ninguém escreve à mão ────────────────
select set_config('request.jwt.claim.sub', (select user_id::text from public.staff_profiles where full_name = 'PLACEHOLDER Gerente B'), true);
set local role authenticated;
do $rls$ begin
  if exists (select 1 from public.supplier_invoices where supplier_name like 'PLACEHOLDER%') then raise exception '7a: gerente B vê compras da loja A'; end if;
  if exists (select 1 from public.office_employees) then raise exception '7b: gerente lê o pessoal'; end if;
  begin insert into public.office_obligations (title, recurrence, due_date) values ('X', 'once', current_date); raise exception '7c: escreveu à mão';
  exception when insufficient_privilege then null; end;
  begin perform 1 from public.accountant_access; raise exception '7d: leu os acessos';
  exception when insufficient_privilege then null; end;
end $rls$;
reset role;
select set_config('request.jwt.claim.sub', (select user_id::text from public.staff_profiles where full_name = 'PLACEHOLDER Gerente'), true);
set local role authenticated;
do $rls$ begin
  if not exists (select 1 from public.supplier_invoices where supplier_name = 'PLACEHOLDER Renda') then raise exception '7e: gerente não vê as compras da sua loja'; end if;
  if (select count(*) from public.office_obligations where title like 'PLACEHOLDER%') <> 2 then raise exception '7f: gerente não vê as obrigações'; end if;
end $rls$;
reset role;
set local role anon;
do $rls$ begin
  begin perform 1 from public.supplier_invoices; raise exception '7g: anónimo leu compras';
  exception when insufficient_privilege then null; end;
  begin perform public.office_alerts_all(); raise exception '7h: anónimo leu avisos';
  exception when insufficient_privilege then null; end;
end $rls$;
reset role;
select 'escritorio: compras, resumo, obrigações, arquivo, pessoal, contabilista e RLS OK' as resultado;
