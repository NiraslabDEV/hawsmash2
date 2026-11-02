begin;
do $$
declare
  owner_id uuid := gen_random_uuid(); manager_id uuid := gen_random_uuid();
  shop uuid; other_shop uuid;
  pos_id uuid := gen_random_uuid();
  report jsonb; row_ record;
  since timestamptz := '2091-01-01'; until_at timestamptz := '2091-01-02';
begin
  select id into shop from public.stores order by id limit 1;
  select id into other_shop from public.stores where id <> shop limit 1;
  assert shop is not null and other_shop is not null, 'duas lojas de teste necessárias';
  insert into auth.users(id) values(owner_id),(manager_id);
  insert into public.staff_profiles(user_id,full_name,role,active) values
    (owner_id,'PLACEHOLDER_TEST_OWNER','owner',true),(manager_id,'PLACEHOLDER_TEST_MANAGER','manager',true);
  insert into public.staff_stores(user_id,store_id) values(manager_id,shop);
  insert into public.orders(id,store_id,order_number,status,flow,fulfillment_type,channel,client_sale_id,customer_name,subtotal_cents,total_cents,payment_method,created_at) values
    (pos_id,shop,'PLACEHOLDER_RESUMO_POS','paid','manual','delivery','delivery',gen_random_uuid(),'PLACEHOLDER_POS',20000,20000,'cash',since);

  -- Uma sessão completa: chega sem loja por um anúncio do Meta, escolhe a loja, compra.
  insert into public.analytics_events(session_id,store_id,type,value_cents,payload,utm,channel,source,medium,campaign,created_at) values
    ('RESUMO_A',null,'view_menu',null,'{}','{"utm_source":"MetaAds","utm_medium":"Hamburguer+Outubro"}',null,null,null,null,since + interval '1 hour'),
    ('RESUMO_A',shop,'add_to_cart',null,'{}','{}','direct','direto',null,null,since + interval '1 hour 1 minute'),
    ('RESUMO_A',shop,'begin_checkout',null,'{}','{}','direct','direto',null,null,since + interval '1 hour 2 minutes'),
    ('RESUMO_A',shop,'purchase',15000,'{}','{}','direct','direto',null,null,since + interval '1 hour 3 minutes');

  select * into row_ from public.analytics_session_stats where session_id = 'RESUMO_A';
  assert found, 'o trigger não resumiu a sessão';
  assert row_.started_at = since + interval '1 hour', 'início da sessão errado';
  assert row_.store_id = shop, 'a loja é a primeira escolhida na sessão';
  assert row_.source = 'facebook' and row_.medium = 'cpc' and row_.channel = 'paid_social', format('primeiro toque não normalizado: %s/%s/%s', row_.channel, row_.source, row_.medium);
  assert row_.campaign = 'hamburguer outubro', 'nome da campanha no meio perdeu-se';
  assert row_.saw_menu and row_.added_to_cart and row_.began_checkout and row_.purchased and not row_.added_payment, 'etapas da sessão erradas';
  assert row_.revenue_cents = 15000, 'receita da sessão errada';

  -- Começou antes da janela: conta no dia em que começou, não no seguinte.
  insert into public.analytics_events(session_id,store_id,type,payload,channel,created_at) values
    ('RESUMO_B',shop,'view_menu','{}','organic_social',since - interval '10 minutes'),
    ('RESUMO_B',shop,'add_to_cart','{}','organic_social',since + interval '5 minutes');
  -- Compra de um pedido feito no POS: fora do funil online.
  insert into public.analytics_events(session_id,store_id,type,value_cents,payload,channel,created_at) values
    ('RESUMO_POS',shop,'purchase',20000,jsonb_build_object('order_id',pos_id),'direct',since + interval '2 hours');
  assert not exists(select 1 from public.analytics_session_stats where session_id = 'RESUMO_POS'), 'sessão POS entrou no funil';
  -- Outra loja.
  insert into public.analytics_events(session_id,store_id,type,payload,channel,created_at) values
    ('RESUMO_C',other_shop,'view_menu','{}','organic_social',since + interval '3 hours');
  -- Upsell não é etapa do funil: não mexe na sessão.
  insert into public.analytics_events(session_id,store_id,type,payload,channel,created_at) values
    ('RESUMO_A',shop,'upsell_view','{}','direct',since - interval '1 day');
  assert (select started_at from public.analytics_session_stats where session_id = 'RESUMO_A') = since + interval '1 hour', 'upsell mexeu no início da sessão';

  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  report := public.get_funnel_metrics(since,until_at,shop);
  assert (report#>>'{funnel,total_sessions}')::int = 1, format('sessões na janela: %s', report#>>'{funnel,total_sessions}');
  assert (report#>>'{funnel,step_purchase}')::int = 1, 'compra fora do funil';
  assert (report->'by_source'->0->>'revenue_cents')::int = 15000, 'receita por origem errada';
  report := public.get_funnel_metrics(since - interval '1 day',until_at,null);
  assert (report#>>'{funnel,total_sessions}')::int = 3, format('consolidado: %s', report#>>'{funnel,total_sessions}');
  report := public.get_attribution_report(since,until_at,shop);
  assert (report#>>'{totals,sessions}')::int = 1, 'sessões da atribuição divergem do funil';
  assert exists(select 1 from jsonb_array_elements(report->'by_channel') x where x->>'channel'='paid_social' and (x->>'sessions')::int=1), 'sessão sem canal na origem das vendas';

  -- Reparar não muda o que o trigger já tinha certo.
  perform private.rebuild_analytics_sessions(since - interval '1 day');
  assert public.get_funnel_metrics(since,until_at,shop) = public.get_funnel_metrics(since,until_at,shop), 'funil instável';
  assert ((public.get_funnel_metrics(since,until_at,shop))#>>'{funnel,total_sessions}')::int = 1, 'rebuild mudou o funil';

  -- Eventos apagados levam a sessão.
  delete from public.analytics_events where session_id = 'RESUMO_C';
  assert not exists(select 1 from public.analytics_session_stats where session_id = 'RESUMO_C'), 'sessão sem eventos ficou no funil';

  -- Só se lê; o gerente só vê a sua loja.
  assert not has_table_privilege('authenticated','public.analytics_session_stats','insert'), 'staff escreve no resumo';
  assert not has_table_privilege('anon','public.analytics_session_stats','select'), 'resumo público';
  assert not has_function_privilege('authenticated','private.rebuild_analytics_sessions(timestamptz)','execute'), 'staff reconstrói o resumo';
  insert into public.analytics_events(session_id,store_id,type,payload,channel,created_at) values
    ('RESUMO_D',other_shop,'view_menu','{}','organic_social',since + interval '4 hours');
  perform set_config('request.jwt.claim.sub',manager_id::text,true);
  perform set_config('role','authenticated',true);
  assert exists(select 1 from public.analytics_session_stats where session_id = 'RESUMO_A'), 'gerente não vê a sua loja';
  assert not exists(select 1 from public.analytics_session_stats where session_id = 'RESUMO_D'), 'gerente vê outra loja';
  begin perform public.get_funnel_metrics(since,until_at,other_shop); raise exception 'funil de outra loja exposto'; exception when sqlstate 'P0403' then null; end;
end $$;
rollback;
