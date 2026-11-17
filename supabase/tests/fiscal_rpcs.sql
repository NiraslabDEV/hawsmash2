-- A1: RPCs reais, sem fixtures persistentes. Correr por scripts/fiscal-local.mjs.
create function pg_temp.fiscal_assert(p_order uuid, p_enabled boolean) returns uuid language plpgsql as $$
declare d public.fiscal_documents; n integer;
begin
  select count(*) into n from public.fiscal_document_orders where order_id=p_order and original;
  if n <> (case when p_enabled then 1 else 0 end) then raise exception 'FR esperada: %, obtida: %, pedido %', p_enabled,n,p_order; end if;
  if not p_enabled then return null; end if;
  select * into d from public.fiscal_documents where id=private.fiscal_active_document(p_order);
  if d.total_cents is distinct from (select total_cents from public.orders where id=p_order)
     or d.total_cents is distinct from (select sum(total_cents)::integer from public.fiscal_document_lines where document_id=d.id)
  then raise exception 'Total fiscal diverge da venda %',p_order; end if;
  return d.id;
end $$;

do $test$
declare
  s uuid:=gen_random_uuid(); u uuid:=gen_random_uuid(); dev uuid:=gen_random_uuid();
  item uuid:=gen_random_uuid(); cat uuid:=gen_random_uuid(); t uuid:=gen_random_uuid();
  sale jsonb; r jsonb; again jsonb; o uuid; a uuid; b uuid; d uuid; enabled boolean;
  online uuid; docs integer; cfg jsonb;
begin
  insert into auth.users(id) values(u);
  insert into public.staff_profiles(user_id,full_name,role) values(u,'PLACEHOLDER Operador','owner');
  perform set_config('request.jwt.claim.sub',u::text,true);
  insert into public.stores(id,slug,name,short_name,order_prefix,accepting_orders,counter_enabled,pickup_enabled,payment_provider)
    values(s,'fiscal-rpc','PLACEHOLDER Loja','FRP','FRP',true,true,true,'manual');
  insert into public.devices(id,store_id,kind,label,device_key_hash) values(dev,s,'pos','PLACEHOLDER POS',repeat('0',64));
  perform public.open_cash_session(s,0);
  insert into public.menu_categories(id,name) values(cat,'PLACEHOLDER Categoria');
  insert into public.menu_items(id,category_id,name,price_cents,available,bogo_eligible) values(item,cat,'PLACEHOLDER Artigo',11600,true,true);
  update public.store_items set available=true,track_stock=false where store_id=s and menu_item_id=item;
  insert into public.tables(id,store_id,number) values(t,s,989);
  cfg:='{"active":true,"legal_name":"PLACEHOLDER Empresa","nuit":"400000001","address":"PLACEHOLDER Sede","regime":"normal","vat_bp":1600}';
  foreach enabled in array array[true,false] loop
    perform public.save_fiscal_settings(cfg || jsonb_build_object('active',enabled));
    select count(*) into docs from public.fiscal_documents where store_id=s;
    sale:=jsonb_build_object('deviceId',dev,'clientSaleId',gen_random_uuid(),'fulfillmentType','counter',
      'items',jsonb_build_array(jsonb_build_object('menuItemId',item,'qty',1)),
      'payments','[{"method":"mpesa","amountCents":11600}]'::jsonb);
    r:=public.create_counter_sale(sale); o:=(r->>'order_id')::uuid;
    d:=pg_temp.fiscal_assert(o,enabled);
    again:=public.create_counter_sale(sale);
    if again->>'order_id' <> r->>'order_id' then raise exception 'Retry duplicou a venda'; end if;
    perform pg_temp.fiscal_assert(o,enabled);
    perform public.void_sale(o,'Cliente desistiu do balcão');
    if enabled and (private.fiscal_active_document(o) is not null or not exists(select 1 from public.fiscal_documents where origin_id=d and doc_type='NC' and reason='Cliente desistiu do balcão')) then raise exception 'void_sale sem NC'; end if;

    r:=public.sync_counter_sale(sale || jsonb_build_object('clientSaleId',gen_random_uuid(),'offlineTotalCents',11600),'{}');
    perform pg_temp.fiscal_assert((r->>'order_id')::uuid,enabled);

    online:=public.create_order('fiscal-rpc',jsonb_build_object('customerName','PLACEHOLDER Cliente','customerPhone','840000001',
      'fulfillmentType','pickup','paymentMethod','mpesa','items',jsonb_build_array(jsonb_build_object('menuItemId',item,'qty',1))));
    perform set_config('request.jwt.claims','{"role":"service_role"}',true);
    perform public.confirm_payment('fiscal-rpc-'||online,online,'manual',null,'mpesa',11600,'{}');
    perform set_config('request.jwt.claims','{}',true);
    d:=pg_temp.fiscal_assert(online,enabled);
    -- Estado só pela máquina de estados; o dono anula depois da entrega.
    perform public.advance_order(online,'APPROVE',null);
    perform public.advance_order(online,'START_PREPARATION',null);
    perform public.advance_order(online,'MARK_READY',null);
    perform public.advance_order(online,'DELIVER',null);
    perform public.void_delivered_order(online,'Correcção da entrega pelo dono');
    if enabled and (private.fiscal_active_document(online) is not null or not exists(select 1 from public.fiscal_documents where origin_id=d and doc_type='NC' and reason='Correcção da entrega pelo dono')) then raise exception 'void_delivered_order sem NC'; end if;

    r:=public.launch_table_order(sale || jsonb_build_object('clientSaleId',gen_random_uuid(),'tableId',t)); a:=(r->>'order_id')::uuid;
    r:=public.launch_table_order(sale || jsonb_build_object('clientSaleId',gen_random_uuid(),'tableId',t)); b:=(r->>'order_id')::uuid;
    if private.fiscal_active_document(a) is not null then raise exception 'Mesa facturada antes de pagar'; end if;
    perform public.close_table_bill(jsonb_build_object('clientCloseId',gen_random_uuid(),'deviceId',dev,'tableId',t,'expectedTotalCents',23200,
      'payments','[{"method":"mpesa","amountCents":11600},{"method":"emola","amountCents":11600}]'::jsonb));
    d:=private.fiscal_active_document(a);
    if enabled and (d is null or d is distinct from private.fiscal_active_document(b) or (select total_cents from public.fiscal_documents where id=d)<>23200) then raise exception 'Conta repartida sem FR única'; end if;

    r:=public.create_counter_sale(sale || jsonb_build_object('clientSaleId',gen_random_uuid(),'manualDiscount','{"type":"cents","value":600,"reason":"PLACEHOLDER Desconto"}'::jsonb,
      'payments','[{"method":"mpesa","amountCents":11000}]'::jsonb));
    perform pg_temp.fiscal_assert((r->>'order_id')::uuid,enabled);
    insert into public.promotions(store_id,kind,active,label,weekdays,same_item_only,include_counter)
      values(s,'bogo',true,'PLACEHOLDER Promoção',array[0,1,2,3,4,5,6]::smallint[],true,true) on conflict(store_id,kind) do update set active=true;
    r:=public.create_counter_sale(sale || jsonb_build_object('clientSaleId',gen_random_uuid(),'items',jsonb_build_array(jsonb_build_object('menuItemId',item,'qty',2))));
    perform pg_temp.fiscal_assert((r->>'order_id')::uuid,enabled);
    update public.promotions set active=false where store_id=s;
    if not enabled and (select count(*) from public.fiscal_documents where store_id=s)<>docs then raise exception 'Emitiu com facturação desligada'; end if;
  end loop;
end $test$;
select 'fiscal_rpcs: balcão/retry/offline/site/mesa/anulações/descontos ligados e desligados OK' as resultado;


