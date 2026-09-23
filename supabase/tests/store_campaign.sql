-- Executar numa transacção local, depois da migration. O runner faz ROLLBACK.
do $test$
declare
  s uuid := gen_random_uuid();
  other_store uuid := gen_random_uuid();
  u uuid := gen_random_uuid();
  item uuid := gen_random_uuid();
  campaign uuid := gen_random_uuid();
  result jsonb;
  menu jsonb;
  price integer;
  v_order_id uuid;
begin
  if private.campaign_discount(115000, 1500) <> 97750 then raise exception '15%% depois de +15%%'; end if;
  if private.campaign_discount(7475, 1500) <> 6354 then raise exception 'arredondamento ao centavo'; end if;
  if private.campaign_discount(0, 1500) <> 0 then raise exception 'zero'; end if;
  insert into auth.users(id) values(u);
  insert into public.staff_profiles(user_id,full_name,role) values(u,'Teste campanha','owner');
  perform set_config('request.jwt.claim.sub',u::text,true);
  insert into public.stores(id,slug,name,short_name,order_prefix,counter_enabled)
    values(s,'campaign-test','Teste','Teste','CPT',false),
          (other_store,'campaign-other','Outra','Outra','CPO',false);
  update public.store_items set available=false where store_id in (s,other_store);
  insert into public.menu_items(id,category_id,name,price_cents,available)
    select item,id,'Produto teste campanha',100000,true from public.menu_categories limit 1;
  update public.store_items set available=true where store_id in(s,other_store) and menu_item_id=item;
  result := public.start_store_campaign(s,campaign,1500,1500,now()+interval '1 day','Campanha de teste','/assets/test.png');
  select price_cents_override into price from public.store_items where store_id=s and menu_item_id=item;
  if price <> 115000 then raise exception 'novo preço de tabela'; end if;
  perform public.start_store_campaign(s,campaign,1500,1500,(result->>'ends_at')::timestamptz,'Campanha de teste','/assets/test.png');
  select price_cents_override into price from public.store_items where store_id=s and menu_item_id=item;
  if price <> 115000 then raise exception 'retry voltou a aumentar'; end if;
  select price_cents_override into price from public.store_items where store_id=other_store and menu_item_id=item;
  if price is not null then raise exception 'alterou outra loja'; end if;
  menu := public.get_menu('campaign-test','delivery',false);
  select (i->>'price_cents')::integer into price from jsonb_array_elements(menu->'categories') c,
    jsonb_array_elements(c->'items') i where i->>'id'=item::text;
  if price is distinct from 97750 then raise exception 'menu não aplica campanha: %',price; end if;
  update public.stores set accepting_orders=true where id=s;
  update public.settings set accepting_orders=true where id=1;
  v_order_id:=private.create_order_store_legacy('campaign-test',jsonb_build_object(
    'customerName','Cliente teste','customerPhone','841111111','fulfillmentType','pickup','paymentMethod','cash',
    'items',jsonb_build_array(jsonb_build_object('menuItemId',item,'qty',2,'price_cents',1)),
    'referralCode','NAO-ACUMULAR','discount_cents',999999));
  select total_cents into price from public.orders where id=v_order_id and store_id=s;
  if price is distinct from 195500 then raise exception 'checkout divergiu: %',price; end if;
  if exists(select 1 from public.order_items where order_id=v_order_id and unit_price_cents<>97750) then
    raise exception 'linhas não receberam desconto'; end if;
  if not exists(select 1 from public.event_log where store_id=s and actor_user_id=u and type='campaign.started') then
    raise exception 'sem auditoria'; end if;
  update public.store_campaigns set ends_at=now()-interval '1 second',starts_at=now()-interval '1 day' where store_id=s;
  menu := public.get_menu('campaign-test','delivery',false);
  select (i->>'price_cents')::integer into price from jsonb_array_elements(menu->'categories') c,
    jsonb_array_elements(c->'items') i where i->>'id'=item::text;
  if price is distinct from 115000 or menu->'campaign' <> 'null'::jsonb then raise exception 'expiração'; end if;
  perform set_config('request.jwt.claim.sub','',true);
  begin
    perform public.start_store_campaign(other_store,gen_random_uuid(),1500,1500,now()+interval '1 day','Teste','/assets/test.png');
    raise exception 'anónimo activou campanha';
  exception when insufficient_privilege then null;
  end;
end;
$test$;
