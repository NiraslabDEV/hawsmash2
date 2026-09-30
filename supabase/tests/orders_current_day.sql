-- Executar apenas localmente: supabase test db --local supabase/tests/orders_current_day.sql
-- Os dados de teste são revertidos no fim.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(9);

-- Loja A fechou o dia há 2 horas; a loja B nunca fechou (conta desde a meia-noite).
insert into public.stores (id, slug, name, short_name, order_prefix) values
  ('92000000-0000-4000-8000-000000000001', 'teste-dia-a', 'PLACEHOLDER_LOJA_A', 'PLACEHOLDER_A', 'TSDA'),
  ('92000000-0000-4000-8000-000000000002', 'teste-dia-b', 'PLACEHOLDER_LOJA_B', 'PLACEHOLDER_B', 'TSDB');
insert into auth.users (id, email) values ('92000000-0000-4000-8000-000000000003', 'PLACEHOLDER_DIA@example.invalid');
insert into public.staff_profiles (user_id, full_name, role) values ('92000000-0000-4000-8000-000000000003', 'PLACEHOLDER_GERENTE', 'manager');
insert into public.staff_stores (user_id, store_id) values
  ('92000000-0000-4000-8000-000000000003', '92000000-0000-4000-8000-000000000001'),
  ('92000000-0000-4000-8000-000000000003', '92000000-0000-4000-8000-000000000002');

insert into public.cash_day_closes (store_id, business_date, request_id, closed_at, report) values
  ('92000000-0000-4000-8000-000000000001', current_date - 1, gen_random_uuid(), now() - interval '3 days', '{}'::jsonb),
  ('92000000-0000-4000-8000-000000000001', current_date, gen_random_uuid(), now() - interval '2 hours', '{}'::jsonb);

insert into public.orders (id, store_id, order_number, status, flow, fulfillment_type, channel, customer_name, subtotal_cents, total_cents, payment_method, created_at) values
  -- A: antes do último fecho (some do dia) e depois dele (fica).
  ('93000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', 'PLACEHOLDER_A_ANTES', 'delivered', 'manual', 'pickup', 'counter', 'PLACEHOLDER_CLIENTE', 100, 100, 'cash', now() - interval '3 hours'),
  ('93000000-0000-4000-8000-000000000002', '92000000-0000-4000-8000-000000000001', 'PLACEHOLDER_A_DEPOIS_1', 'ready', 'manual', 'pickup', 'counter', 'PLACEHOLDER_CLIENTE', 100, 100, 'cash', now() - interval '1 hour'),
  ('93000000-0000-4000-8000-000000000003', '92000000-0000-4000-8000-000000000001', 'PLACEHOLDER_A_DEPOIS_2', 'paid', 'manual', 'pickup', 'counter', 'PLACEHOLDER_CLIENTE', 100, 100, 'cash', now() - interval '30 minutes'),
  -- B: ontem (some) e hoje depois da meia-noite de Maputo (fica).
  ('93000000-0000-4000-8000-000000000004', '92000000-0000-4000-8000-000000000002', 'PLACEHOLDER_B_ONTEM', 'paid', 'manual', 'pickup', 'counter', 'PLACEHOLDER_CLIENTE', 100, 100, 'cash',
    (date_trunc('day', now() at time zone 'Africa/Maputo') at time zone 'Africa/Maputo') - interval '1 hour'),
  ('93000000-0000-4000-8000-000000000005', '92000000-0000-4000-8000-000000000002', 'PLACEHOLDER_B_HOJE', 'ready', 'manual', 'pickup', 'counter', 'PLACEHOLDER_CLIENTE', 100, 100, 'cash',
    (date_trunc('day', now() at time zone 'Africa/Maputo') at time zone 'Africa/Maputo') + interval '1 second');

select set_config('request.jwt.claim.sub', '92000000-0000-4000-8000-000000000003', true);
set local role authenticated;

select is((public.get_orders('{"store":"teste-dia-a"}') ->> 'total')::int, 3, 'sem filtro de dia, a loja mostra todo o histórico');
select is((public.get_orders('{"store":"teste-dia-a","day":"current"}') ->> 'total')::int, 2, 'o dia da loja começa no último fecho do dia');
select is(public.get_orders('{"store":"teste-dia-a","day":"current"}') #>> '{orders,0,order_number}', 'PLACEHOLDER_A_DEPOIS_2', 'o pedido mais recente do dia vem primeiro');
select is((public.get_orders('{"store":"teste-dia-b","day":"current"}') ->> 'total')::int, 1, 'loja sem fecho do dia conta desde a meia-noite de Maputo');
select is((public.get_orders('{"day":"current"}') ->> 'total')::int, 3, 'todas as lojas: cada uma usa o seu próprio fecho');
select is(public.get_orders('{"store":"teste-dia-a","day":"current"}') -> 'status_counts', '{"paid":1,"ready":1}'::jsonb, 'contagens por estado respeitam o dia');
select is(public.get_orders('{"store":"teste-dia-a","day":"current","status":"ready"}') -> 'status_counts', '{"paid":1,"ready":1}'::jsonb, 'contagens das abas ignoram o estado seleccionado');
select is((public.get_orders('{"store":"teste-dia-a","day":"current","status":"ready"}') ->> 'total')::int, 1, 'o total continua a respeitar o estado');
select ok(not (select prosecdef from pg_proc where oid = 'public.get_orders(jsonb)'::regprocedure), 'RPC continua SECURITY INVOKER');

select * from finish();
rollback;
