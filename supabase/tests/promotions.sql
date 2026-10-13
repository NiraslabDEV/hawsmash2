-- 1113: descontos e promoções. Executar numa transacção local, depois da
-- migration. O runner faz ROLLBACK — nada fica gravado.
--
--   docker exec -i supabase_db_hawsmash2 psql -U postgres -v ON_ERROR_STOP=1 \
--     < <(echo begin; cat supabase/tests/promotions.sql; echo rollback)
do $test$
declare
  s uuid := gen_random_uuid();
  other_store uuid := gen_random_uuid();
  u uuid := gen_random_uuid();
  zone uuid := gen_random_uuid();
  burger_a uuid := gen_random_uuid();
  burger_b uuid := gen_random_uuid();
  cola uuid := gen_random_uuid();
  bogo_id uuid;
  v_order uuid;
  o record;
  r jsonb;
  hoje integer;
  base jsonb;
begin
  -- ── Fixture ────────────────────────────────────────────────────────────
  insert into auth.users(id) values(u);
  insert into public.staff_profiles(user_id,full_name,role) values(u,'Teste promoções','owner');
  perform set_config('request.jwt.claim.sub',u::text,true);

  insert into public.stores(id,slug,name,short_name,order_prefix,accepting_orders,delivery_enabled,pickup_enabled)
    values(s,'promo-test','PLACEHOLDER_PROMO','PROMO','PRT',true,true,true),
          (other_store,'promo-other','PLACEHOLDER_OUTRA','OUTRA','PRO',true,true,true);
  update public.settings set accepting_orders=true where id=1;
  insert into public.delivery_zones(id,store_id,name,fee_cents,active) values(zone,s,'PLACEHOLDER_ZONA',10000,true);

  insert into public.menu_items(id,category_id,name,price_cents,available,bogo_eligible)
    select burger_a,id,'Burger A teste',45000,true,true from public.menu_categories order by sort limit 1;
  insert into public.menu_items(id,category_id,name,price_cents,available,bogo_eligible)
    select burger_b,id,'Burger B teste',52000,true,true from public.menu_categories order by sort limit 1;
  insert into public.menu_items(id,category_id,name,price_cents,available,bogo_eligible)
    select cola,id,'Cola teste',8000,true,false from public.menu_categories order by sort limit 1;
  update public.store_items set available=true
    where store_id in (s,other_store) and menu_item_id in (burger_a,burger_b,cola);

  hoje := private.store_business_dow(s, now());
  base := jsonb_build_object('customerName','Cliente teste','customerPhone','841234567',
    'fulfillmentType','pickup','paymentMethod','cash');

  -- ── 1. Sem promoções: nada muda ────────────────────────────────────────
  v_order := public.create_order('promo-test', base || jsonb_build_object('items',
    jsonb_build_array(jsonb_build_object('menuItemId',burger_a,'qty',2))));
  select * into o from public.orders where id=v_order;
  if o.total_cents <> 90000 or o.discount_cents <> 0 or o.bogo_discount_cents <> 0 then
    raise exception '1: sem promo o total mudou: % / %', o.total_cents, o.discount_cents;
  end if;

  -- ── 2. 2x1 ligado: dois iguais, um grátis ──────────────────────────────
  insert into public.promotions(store_id,kind,active,label,weekdays,same_item_only)
    values(s,'bogo',true,'2x1 de teste',array[0,1,2,3,4,5,6]::smallint[],true)
    returning id into bogo_id;
  v_order := public.create_order('promo-test', base || jsonb_build_object('customerPhone','841234568','items',
    jsonb_build_array(jsonb_build_object('menuItemId',burger_a,'qty',2))));
  select * into o from public.orders where id=v_order;
  if o.bogo_discount_cents <> 45000 or o.discount_cents <> 45000 or o.total_cents <> 45000
     or o.bogo_free_item is distinct from 'Burger A teste' then
    raise exception '2: 2x1 não aplicou: bogo=% desc=% total=% item=%',
      o.bogo_discount_cents, o.discount_cents, o.total_cents, o.bogo_free_item;
  end if;
  if not exists(select 1 from public.event_log where order_id=v_order and store_id=s and type='promotion.applied') then
    raise exception '2: sem rasto em event_log';
  end if;
  if (select (payload->>'total_cents')::int from public.event_log where order_id=v_order and type='order.created') <> 45000 then
    raise exception '2: order.created ficou com o total antigo';
  end if;

  -- ── 3. Mesmo produto por omissão; aceitar quaisquer dois quando a loja quer
  v_order := public.create_order('promo-test', base || jsonb_build_object('customerPhone','841234569','items',
    jsonb_build_array(jsonb_build_object('menuItemId',burger_a,'qty',1),jsonb_build_object('menuItemId',burger_b,'qty',1))));
  if (select bogo_discount_cents from public.orders where id=v_order) <> 0 then
    raise exception '3: produtos diferentes formaram par com same_item_only';
  end if;
  update public.promotions set same_item_only=false where id=bogo_id;
  v_order := public.create_order('promo-test', base || jsonb_build_object('customerPhone','841234570','items',
    jsonb_build_array(jsonb_build_object('menuItemId',burger_a,'qty',1),jsonb_build_object('menuItemId',burger_b,'qty',1))));
  select * into o from public.orders where id=v_order;
  if o.bogo_discount_cents <> 45000 or o.total_cents <> 52000 then
    raise exception '3: quaisquer dois: paga-se o mais caro (% / %)', o.bogo_discount_cents, o.total_cents;
  end if;
  update public.promotions set same_item_only=true where id=bogo_id;

  -- ── 4. Produto não elegível não entra no par ───────────────────────────
  v_order := public.create_order('promo-test', base || jsonb_build_object('customerPhone','841234571','items',
    jsonb_build_array(jsonb_build_object('menuItemId',cola,'qty',2))));
  if (select bogo_discount_cents from public.orders where id=v_order) <> 0 then
    raise exception '4: bebida não elegível saiu grátis';
  end if;

  -- ── 5. Fora do dia marcado não corre ───────────────────────────────────
  update public.promotions set weekdays=array[((hoje+1)%7)]::smallint[] where id=bogo_id;
  v_order := public.create_order('promo-test', base || jsonb_build_object('customerPhone','841234572','items',
    jsonb_build_array(jsonb_build_object('menuItemId',burger_a,'qty',2))));
  if (select bogo_discount_cents from public.orders where id=v_order) <> 0 then
    raise exception '5: 2x1 correu fora do dia';
  end if;
  update public.promotions set weekdays=array[0,1,2,3,4,5,6]::smallint[] where id=bogo_id;

  -- ── 6. A outra loja não herda a promo ──────────────────────────────────
  v_order := public.create_order('promo-other', base || jsonb_build_object('customerPhone','841234573','items',
    jsonb_build_array(jsonb_build_object('menuItemId',burger_a,'qty',2))));
  if (select bogo_discount_cents from public.orders where id=v_order) <> 0 then
    raise exception '6: promo de uma loja aplicou-se na outra';
  end if;

  -- ── 7. Cupão % calcula-se DEPOIS do 2x1 ────────────────────────────────
  insert into public.referral_codes(code,owner_name,reward_type,reward_value,max_redemptions,store_id)
    values('PROMOTESTE10','Teste','discount_pct',10,100,null);
  v_order := public.create_order('promo-test', base || jsonb_build_object('customerPhone','841234574',
    'referralCode','promoteste10','items',
    jsonb_build_array(jsonb_build_object('menuItemId',burger_a,'qty',2),jsonb_build_object('menuItemId',cola,'qty',1))));
  select * into o from public.orders where id=v_order;
  -- subtotal 98000; 2x1 −45000 → 53000; 10% → 5300
  if o.discount_cents <> 50300 or o.bogo_discount_cents <> 45000 or o.total_cents <> 47700 then
    raise exception '7: cupão sobre o 2x1: desc=% bogo=% total=%', o.discount_cents, o.bogo_discount_cents, o.total_cents;
  end if;
  if (select (payload->>'discount')::int from public.event_log where order_id=v_order and type='referral.redeemed') <> 5300 then
    raise exception '7: referral.redeemed ficou com o desconto antigo';
  end if;

  -- ── 8. Cupão de outra loja é recusado, antes de gastar o resgate ───────
  insert into public.referral_codes(code,owner_name,reward_type,reward_value,max_redemptions,store_id)
    values('SOOUTRA','Teste','discount_cents',5000,100,other_store);
  begin
    perform public.create_order('promo-test', base || jsonb_build_object('customerPhone','841234575',
      'referralCode','SOOUTRA','items',jsonb_build_array(jsonb_build_object('menuItemId',burger_a,'qty',1))));
    raise exception '8: cupão de outra loja passou';
  exception when sqlstate 'P0026' then null;
  end;
  if exists(select 1 from public.referral_redemptions rr join public.referral_codes c on c.id=rr.code_id where c.code='SOOUTRA') then
    raise exception '8: resgate gravado apesar da recusa';
  end if;
  r := public.validate_referral('soOutra','841234575','promo-test');
  if r->>'valid' <> 'false' or r->>'reason' <> 'wrong_store' then raise exception '8: validate não avisou: %', r; end if;
  r := public.validate_referral('SOOUTRA','841234575','promo-other');
  if r->>'valid' <> 'true' then raise exception '8: na loja certa devia ser válido: %', r; end if;

  -- ── 9. Cupão 2x1 liberta a promo desligada ─────────────────────────────
  update public.promotions set active=false where id=bogo_id;
  insert into public.referral_codes(code,owner_name,reward_type,reward_value,max_redemptions)
    values('DOISPORUM','Teste','bogo',0,100);
  v_order := public.create_order('promo-test', base || jsonb_build_object('customerPhone','841234576',
    'referralCode','DOISPORUM','items',jsonb_build_array(jsonb_build_object('menuItemId',burger_a,'qty',2))));
  select * into o from public.orders where id=v_order;
  if o.bogo_discount_cents <> 45000 or o.total_cents <> 45000 or o.referral_code <> 'DOISPORUM' then
    raise exception '9: cupão 2x1: bogo=% total=%', o.bogo_discount_cents, o.total_cents;
  end if;

  -- ── 10. Entrega grátis a partir do mínimo, depois dos descontos ────────
  insert into public.promotions(store_id,kind,active,label,weekdays,min_subtotal_cents)
    values(s,'free_delivery',true,'Entrega grátis',array[0,1,2,3,4,5,6]::smallint[],80000);
  v_order := public.create_order('promo-test', base || jsonb_build_object('customerPhone','841234577',
    'fulfillmentType','delivery','deliveryZoneId',zone,'address','PLACEHOLDER_MORADA',
    'items',jsonb_build_array(jsonb_build_object('menuItemId',burger_a,'qty',2))));
  select * into o from public.orders where id=v_order;
  if o.delivery_fee_cents <> 0 or o.delivery_discount_cents <> 10000 or o.total_cents <> 90000 then
    raise exception '10: entrega grátis: fee=% perdoada=% total=%', o.delivery_fee_cents, o.delivery_discount_cents, o.total_cents;
  end if;
  update public.promotions set active=true where id=bogo_id;
  v_order := public.create_order('promo-test', base || jsonb_build_object('customerPhone','841234578',
    'fulfillmentType','delivery','deliveryZoneId',zone,'address','PLACEHOLDER_MORADA',
    'items',jsonb_build_array(jsonb_build_object('menuItemId',burger_a,'qty',2))));
  select * into o from public.orders where id=v_order;
  -- 90000 − 45000 = 45000 < 80000: a entrega paga-se.
  if o.delivery_fee_cents <> 10000 or o.delivery_discount_cents <> 0 or o.total_cents <> 55000 then
    raise exception '10: mínimo contado antes do 2x1: fee=% total=%', o.delivery_fee_cents, o.total_cents;
  end if;

  -- ── 11. Recalcular é idempotente (retry, reprocessamento) ──────────────
  perform private.apply_order_promotions(v_order);
  perform private.apply_order_promotions(v_order);
  select * into o from public.orders where id=v_order;
  if o.total_cents <> 55000 or o.discount_cents <> 45000 or o.delivery_fee_cents <> 10000 then
    raise exception '11: segunda passagem mudou o pedido: total=%', o.total_cents;
  end if;

  -- ── 12. O que a montra lê ──────────────────────────────────────────────
  r := public.get_store_promotions('promo-test');
  if (r->'bogo'->>'live')::boolean is not true or not (r->'bogo'->'item_ids' ? burger_a::text)
     or (r->'bogo'->'item_ids' ? cola::text) then
    raise exception '12: montra não vê o 2x1: %', r;
  end if;
  if (r->'free_delivery'->>'min_subtotal_cents')::int <> 80000 then raise exception '12: mínimo: %', r; end if;
  r := public.get_store_promotions('promo-other');
  if r->'bogo' <> 'null'::jsonb or r->'free_delivery' <> 'null'::jsonb then
    raise exception '12: outra loja vê promoções que não tem: %', r;
  end if;
  if not has_function_privilege('anon','public.get_store_promotions(text)','execute') then
    raise exception '12: anónimo não lê as promoções';
  end if;
  if has_function_privilege('anon','private.apply_order_promotions(uuid)','execute')
     or has_function_privilege('authenticated','private.apply_order_promotions(uuid)','execute') then
    raise exception '12: aplicar promoções exposto ao browser';
  end if;

  -- ── 13. Resumo para o painel ───────────────────────────────────────────
  update public.orders set status='approved' where store_id=s;
  r := public.get_promotions_summary(s, now()-interval '1 hour', now()+interval '1 hour');
  if (r->>'bogo_orders')::int < 4 or (r->>'free_delivery_orders')::int <> 1 then
    raise exception '13: resumo: %', r;
  end if;

  r := public.get_coupon_usage();
  if not exists (
    select 1 from jsonb_array_elements(r) e join public.referral_codes c on c.id = (e->>'code_id')::uuid
    where c.code = 'PROMOTESTE10' and (e->>'redemptions')::int = 1
  ) then
    raise exception '13: utilizações do cupão: %', r;
  end if;

  -- ── 14. Auditoria ──────────────────────────────────────────────────────
  if not exists(select 1 from public.event_log where store_id=s and actor_user_id=u and type='promotion.saved') then
    raise exception '14: guardar promoção sem auditoria';
  end if;
  if not exists(select 1 from public.event_log where actor_user_id=u and type='coupon.saved'
                and payload->>'code'='PROMOTESTE10') then
    raise exception '14: criar cupão sem auditoria';
  end if;
end;
$test$;

-- ── 15. RLS: só o dono escreve promoções; ninguém de fora lê ───────────────
do $rls$
declare
  s uuid;
  m uuid := gen_random_uuid();
  n integer;
begin
  select id into s from public.stores where slug='promo-test';
  insert into auth.users(id) values(m);
  insert into public.staff_profiles(user_id,full_name,role) values(m,'Gerente teste','manager');
  insert into public.staff_stores(user_id,store_id) values(m,s);
  perform set_config('request.jwt.claim.sub',m::text,true);
  perform set_config('role','authenticated',true);

  select count(*) into n from public.promotions where store_id=s;
  if n <> 2 then raise exception '15: gerente da loja devia ler as promoções (%)', n; end if;
  begin
    update public.promotions set active=false where store_id=s;
    get diagnostics n = row_count;
    if n <> 0 then raise exception '15: gerente alterou uma promoção'; end if;
  exception when insufficient_privilege then null;
  end;
  select count(*) into n from public.promotions p join public.stores st on st.id=p.store_id where st.slug='promo-other';
  if n <> 0 then raise exception '15: gerente lê promoções de outra loja'; end if;

  perform set_config('role','anon',true);
  perform set_config('request.jwt.claim.sub','',true);
  begin
    select count(*) into n from public.promotions;
    raise exception '15: anónimo leu promoções (%)', n;
  exception when insufficient_privilege then null;
  end;
  perform set_config('role','postgres',true);
end;
$rls$;

-- ── 16. Balcão: cupão, 2x1 "também no balcão", desconto manual ───────────────
do $pos$
declare
  s uuid;
  owner_id uuid;
  cashier uuid := gen_random_uuid();
  dev uuid := gen_random_uuid();
  burger_a uuid;
  cola uuid;
  r jsonb;
  o record;
  items jsonb;
  sale jsonb;
begin
  perform set_config('role','postgres',true);
  select id into s from public.stores where slug='promo-test';
  update public.stores set counter_enabled=true where id=s;
  select id into burger_a from public.menu_items where name='Burger A teste';
  select id into cola from public.menu_items where name='Cola teste';
  select user_id into owner_id from public.staff_profiles where full_name='Teste promoções';
  insert into public.devices(id,store_id,kind,label,device_key_hash) values(dev,s,'pos','PLACEHOLDER_POS',repeat('0',64));
  perform set_config('request.jwt.claim.sub',owner_id::text,true);

  items := jsonb_build_array(jsonb_build_object('menuItemId',burger_a,'qty',2),jsonb_build_object('menuItemId',cola,'qty',1));
  sale := jsonb_build_object('deviceId',dev,'fulfillmentType','counter','items',items);

  -- a) 2x1 do site NÃO corre no balcão sem "também no balcão": paga 98000
  r := public.create_counter_sale(sale || jsonb_build_object('clientSaleId',gen_random_uuid(),
    'payments',jsonb_build_array(jsonb_build_object('method','mpesa','amountCents',98000))));
  if (r->>'total_cents')::int <> 98000 then raise exception '16a: balcão sem opt-in: %', r; end if;

  -- b) com "também no balcão": 98000 − 45000 = 53000
  update public.promotions set include_counter=true where store_id=s and kind='bogo';
  r := public.create_counter_sale(sale || jsonb_build_object('clientSaleId',gen_random_uuid(),
    'payments',jsonb_build_array(jsonb_build_object('method','mpesa','amountCents',53000))));
  select * into o from public.orders where id=(r->>'order_id')::uuid;
  if o.total_cents <> 53000 or o.bogo_discount_cents <> 45000 or o.discount_cents <> 45000 then
    raise exception '16b: 2x1 no balcão: total=% bogo=%', o.total_cents, o.bogo_discount_cents;
  end if;

  -- c) o pagamento tem de bater com o total JÁ com desconto
  begin
    perform public.create_counter_sale(sale || jsonb_build_object('clientSaleId',gen_random_uuid(),
      'payments',jsonb_build_array(jsonb_build_object('method','mpesa','amountCents',98000))));
    raise exception '16c: cobrou sem desconto';
  exception when sqlstate 'P0007' then null;
  end;

  -- d) cupão no balcão exige telefone
  begin
    perform public.create_counter_sale(sale || jsonb_build_object('clientSaleId',gen_random_uuid(),
      'referralCode','PROMOTESTE10',
      'payments',jsonb_build_array(jsonb_build_object('method','mpesa','amountCents',47700))));
    raise exception '16d: cupão sem telefone passou';
  exception when sqlstate 'P0027' then null;
  end;

  -- e) cupão 10% + 2x1: 53000 → 5300; total 47700; resgate gravado
  r := public.create_counter_sale(sale || jsonb_build_object('clientSaleId',gen_random_uuid(),
    'referralCode','promoteste10','customerPhone','849990001',
    'payments',jsonb_build_array(jsonb_build_object('method','cash','amountCents',47700)),'cashReceivedCents',50000));
  select * into o from public.orders where id=(r->>'order_id')::uuid;
  if o.total_cents <> 47700 or o.referral_code <> 'PROMOTESTE10' or o.change_cents <> 2300 then
    raise exception '16e: cupão no balcão: total=% code=% troco=%', o.total_cents, o.referral_code, o.change_cents;
  end if;
  if not exists(select 1 from public.referral_redemptions where order_id=o.id) then raise exception '16e: sem resgate'; end if;

  -- f) o mesmo telefone não repete o cupão
  begin
    perform public.create_counter_sale(sale || jsonb_build_object('clientSaleId',gen_random_uuid(),
      'referralCode','PROMOTESTE10','customerPhone','849990001',
      'payments',jsonb_build_array(jsonb_build_object('method','mpesa','amountCents',47700))));
    raise exception '16f: cupão repetido passou';
  exception when sqlstate 'P0022' then null;
  end;

  -- g) desconto manual do dono: 53000 − 10% = 47700, com motivo e rasto
  r := public.create_counter_sale(sale || jsonb_build_object('clientSaleId',gen_random_uuid(),
    'manualDiscount',jsonb_build_object('type','pct','value',10,'reason','Cliente habitual'),
    'payments',jsonb_build_array(jsonb_build_object('method','mpesa','amountCents',47700))));
  select * into o from public.orders where id=(r->>'order_id')::uuid;
  if o.manual_discount_cents <> 5300 or o.discount_reason <> 'Cliente habitual' then
    raise exception '16g: manual: % %', o.manual_discount_cents, o.discount_reason;
  end if;
  if not exists(select 1 from public.event_log where order_id=o.id and type='pos.manual_discount' and actor_user_id=owner_id) then
    raise exception '16g: manual sem auditoria';
  end if;
  -- o talão da venda leva a origem do desconto
  if not exists(select 1 from public.print_jobs where order_id=o.id and kind='order'
                and (payload->>'manual_discount_cents')::int = 5300) then
    raise exception '16g: talão sem a linha do desconto';
  end if;

  -- h) o caixa (cashier) não dá desconto manual…
  insert into auth.users(id) values(cashier);
  insert into public.staff_profiles(user_id,full_name,role) values(cashier,'Caixa teste','cashier');
  insert into public.staff_stores(user_id,store_id) values(cashier,s);
  perform set_config('request.jwt.claim.sub',cashier::text,true);
  begin
    perform public.create_counter_sale(sale || jsonb_build_object('clientSaleId',gen_random_uuid(),
      'manualDiscount',jsonb_build_object('type','cents','value',1000,'reason','Amigo'),
      'payments',jsonb_build_array(jsonb_build_object('method','mpesa','amountCents',52000))));
    raise exception '16h: caixa deu desconto manual';
  exception when sqlstate 'P0403' then null;
  end;

  -- i) …mas uma venda offline já cobrada nunca fica presa: entra e fica para revisão
  r := public.sync_counter_sale(sale || jsonb_build_object('clientSaleId',gen_random_uuid(),
    'offlineTotalCents',52000,'promoAt',now(),
    'manualDiscount',jsonb_build_object('type','cents','value',1000,'reason','Amigo'),
    'payments',jsonb_build_array(jsonb_build_object('method','cash','amountCents',52000)),'cashReceivedCents',52000),
    '{}'::jsonb);
  select * into o from public.orders where id=(r->>'order_id')::uuid;
  if o.total_cents <> 52000 or not o.needs_review then
    raise exception '16i: offline: total=% review=%', o.total_cents, o.needs_review;
  end if;

  -- j) a página do cliente vê os descontos
  r := public.get_order_status(o.id);
  if (r->'promo'->>'manual_discount_cents')::int <> 1000 or (r->>'subtotal_cents')::int <> 98000 then
    raise exception '16j: estado do pedido: %', r;
  end if;
end;
$pos$;
