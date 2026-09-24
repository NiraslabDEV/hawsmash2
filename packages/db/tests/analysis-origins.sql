begin;
do $$
declare
  owner_id uuid := gen_random_uuid(); manager_id uuid := gen_random_uuid();
  shop uuid; other_shop uuid;
  web_id uuid := gen_random_uuid(); pos_id uuid := gen_random_uuid();
  report jsonb; all_sales jsonb; online_sales jsonb; pos_sales jsonb;
  upgrade_order uuid := gen_random_uuid(); variant_low record; variant_high record;
  item_id uuid; line_id uuid := gen_random_uuid();
  since timestamptz := '2090-01-01'; until_at timestamptz := '2090-01-03';
begin
  assert not private.is_pos_order('dine_in',null),'pedido pelo QR da mesa não é automaticamente POS';
  select id into shop from public.stores order by id limit 1;
  select id into other_shop from public.stores where id <> shop limit 1;
  assert shop is not null and other_shop is not null, 'duas lojas de teste necessárias';
  insert into auth.users(id) values(owner_id),(manager_id);
  insert into public.staff_profiles(user_id,full_name,role,active) values
    (owner_id,'PLACEHOLDER_TEST_OWNER','owner',true),(manager_id,'PLACEHOLDER_TEST_MANAGER','manager',true);
  insert into public.staff_stores(user_id,store_id) values(manager_id,shop);
  insert into public.orders(id,store_id,order_number,status,flow,fulfillment_type,channel,client_sale_id,customer_name,subtotal_cents,total_cents,payment_method,created_at) values
    (web_id,shop,'PLACEHOLDER_WEB','paid','manual','pickup','pickup',null,'PLACEHOLDER_WEB',10000,10000,'cash',since),
    (pos_id,shop,'PLACEHOLDER_POS_DELIVERY','paid','manual','delivery','delivery',gen_random_uuid(),'PLACEHOLDER_POS',20000,20000,'cash',since),
    (gen_random_uuid(),shop,'PLACEHOLDER_COUNTER','paid','manual','pickup','counter',null,'PLACEHOLDER_POS',30000,30000,'mpesa',since),
    (gen_random_uuid(),other_shop,'PLACEHOLDER_OTHER','paid','manual','pickup','counter',null,'PLACEHOLDER_OTHER',99000,99000,'cash',since);
  insert into public.analytics_events(session_id,store_id,type,value_cents,payload,channel,created_at) values
    ('PLACEHOLDER_WEB',shop,'view_menu',null,'{}','organic_social',since),
    ('PLACEHOLDER_WEB',shop,'purchase',10000,jsonb_build_object('order_id',web_id),'organic_social',since),
    ('PLACEHOLDER_POS',shop,'purchase',20000,jsonb_build_object('order_id',pos_id),'direct',since),
    ('PLACEHOLDER_COUNTER',shop,'view_menu',null,'{}','balcao',since);
  select id into item_id from public.menu_items limit 1;
  insert into public.order_items(id,order_id,store_id,menu_item_id,name_snapshot,qty,unit_price_cents,cost_cents,station)
  values(line_id,web_id,shop,item_id,'PLACEHOLDER_UPSELL',2,5000,4000,'kitchen');
  perform private.record_order_upsells(web_id,jsonb_build_object('items',jsonb_build_array(jsonb_build_object('menuItemId',item_id,'qty',2,'upsell',jsonb_build_object('kind','companion','qty',99,'placement','online_companion','price_cents',999999)))));
  perform private.record_order_upsells(web_id,jsonb_build_object('items',jsonb_build_array(jsonb_build_object('menuItemId',item_id,'qty',2,'upsell',jsonb_build_object('kind','companion','qty',1,'placement','online_companion')))));
  assert (select count(*) from public.order_upsells where order_id=web_id)=1, 'retry duplicou upsell';
  assert (select qty from public.order_upsells where order_id=web_id)=2, 'upsell excede linha vendida';
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  report := public.get_upsell_metrics(since,until_at,shop,'online');
  assert (report->>'revenue_cents')::int=10000, 'receita upsell confiou no browser';
  assert (report->>'margin_cents')::int=6000, 'margem upsell incorrecta';
  update public.orders set discount_cents=1000 where id=web_id;
  report := public.get_upsell_metrics(since,until_at,shop,'online');
  assert (report->>'revenue_cents')::int=9000, 'desconto não repartido';
  assert (report->>'margin_cents')::int=5000, 'margem não descontou promoção';
  update public.orders set discount_cents=0 where id=web_id;
  update public.order_items set cost_cents=null where id=line_id;
  report := public.get_upsell_metrics(since,until_at,shop,'online');
  assert report->>'margin_cents' is null, 'custo desconhecido virou lucro';
  assert (public.get_upsell_metrics(since,until_at,shop,'pos')->>'orders')::int=0, 'upsell online misturado com POS';

  report := public.get_attribution_report(since,until_at,shop);
  assert (report#>>'{totals,orders}')::int = 1, 'aquisição contém pedidos POS';
  assert (report#>>'{totals,revenue_cents}')::int = 10000, 'pagamento online em dinheiro deve continuar online';
  assert (report#>>'{totals,sessions}')::int = 1, 'sessões POS contaminam aquisição';
  assert not exists(select 1 from jsonb_array_elements(report->'by_channel') x where x->>'channel'='balcao'), 'canal balcão indevido';
  report := public.get_funnel_metrics(since,until_at,shop);
  assert (report#>>'{funnel,total_sessions}')::int=1, 'funil contém sessões POS';
  assert (report#>>'{funnel,step_purchase}')::int=1, 'compra POS no funil';
  all_sales := public.get_sales_metrics('all',shop,'all');
  online_sales := public.get_sales_metrics('all',shop,'online');
  pos_sales := public.get_sales_metrics('all',shop,'pos');
  assert (all_sales->>'revenue_cents')::bigint = (online_sales->>'revenue_cents')::bigint + (pos_sales->>'revenue_cents')::bigint, 'receitas não reconciliam';
  assert (all_sales->>'total_orders')::bigint = (online_sales->>'total_orders')::bigint + (pos_sales->>'total_orders')::bigint, 'pedidos não reconciliam';
  assert public.get_dashboard_metrics('all',shop) = all_sales, 'compatibilidade do dashboard';
  begin perform public.get_sales_metrics('all',shop,'invalid'); raise exception 'origem inválida aceite'; exception when sqlstate 'P0007' then null; end;
  select v.* into variant_low from public.menu_item_variants v where exists(select 1 from public.menu_item_variants hi where hi.menu_item_id=v.menu_item_id and hi.price_cents>v.price_cents) order by v.id limit 1;
  select v.* into variant_high from public.menu_item_variants v where v.menu_item_id=variant_low.menu_item_id and v.price_cents>variant_low.price_cents order by v.price_cents limit 1;
  insert into public.orders(id,store_id,order_number,status,flow,fulfillment_type,channel,customer_name,subtotal_cents,total_cents,payment_method,created_at)
  values(upgrade_order,shop,'PLACEHOLDER_UPGRADE','paid','manual','pickup','pickup','PLACEHOLDER_UPGRADE',variant_high.price_cents+500,variant_high.price_cents+500,'cash',since);
  insert into public.order_items(order_id,store_id,menu_item_id,name_snapshot,qty,unit_price_cents,station,variant_name_snapshot)
  values(upgrade_order,shop,variant_high.menu_item_id,'PLACEHOLDER_UPGRADE',1,variant_high.price_cents+500,'kitchen',variant_high.name);
  perform private.record_order_upsells(upgrade_order,jsonb_build_object('items',jsonb_build_array(jsonb_build_object('menuItemId',variant_high.menu_item_id,'variantId',variant_high.id,'qty',1,'upsell',jsonb_build_object('kind','upgrade','fromVariantId',variant_low.id,'qty',1,'placement','online_upgrade')))));
  assert (select baseline_unit_cents from public.order_upsells where order_id=upgrade_order)=variant_low.price_cents+500,'upgrade contou adicionais anteriores como receita extra';
  assert not has_function_privilege('anon','private.record_order_upsells(uuid,jsonb)','execute'), 'registo público indevido';
  update public.orders set status='cancelled' where id=upgrade_order;
  report := public.get_upsell_metrics(since,until_at,shop,'online');
  assert (report->>'orders')::int=1,'upsell cancelado contado';
  perform set_config('request.jwt.claim.sub',manager_id::text,true);
  perform public.get_sales_metrics('all',shop,'pos');
  begin perform public.get_upsell_metrics(since,until_at,other_shop,'pos'); raise exception 'upsell outra loja exposta'; exception when sqlstate 'P0403' then null; end;
  begin perform public.get_sales_metrics('all',other_shop,'pos'); raise exception 'outra loja exposta'; exception when sqlstate 'P0403' then null; end;
  begin perform public.get_sales_metrics('all',null,'online'); raise exception 'consolidado exposto'; exception when sqlstate 'P0403' then null; end;
  perform set_config('request.jwt.claim.sub','',true);
  begin perform public.get_sales_metrics('all',shop,'pos'); raise exception 'anónimo autorizado'; exception when sqlstate 'P0020' then null; end;
end $$;
rollback;
