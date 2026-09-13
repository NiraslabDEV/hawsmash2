-- Executar apenas localmente: supabase test db --local supabase/tests/orders_pagination.sql
-- Os dados de teste e quaisquer efeitos de triggers são revertidos no fim.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(13);

insert into public.stores (id, slug, name, short_name, order_prefix) values
  ('90000000-0000-4000-8000-000000000001', 'teste-paginacao-a', 'PLACEHOLDER_LOJA_A', 'PLACEHOLDER_A', 'TSPA'),
  ('90000000-0000-4000-8000-000000000002', 'teste-paginacao-b', 'PLACEHOLDER_LOJA_B', 'PLACEHOLDER_B', 'TSPB');
insert into auth.users (id, email) values ('90000000-0000-4000-8000-000000000003', 'PLACEHOLDER_PAGINACAO@example.invalid');
insert into public.staff_profiles (user_id, full_name, role) values ('90000000-0000-4000-8000-000000000003', 'PLACEHOLDER_GERENTE', 'manager');
insert into public.staff_stores (user_id, store_id) values ('90000000-0000-4000-8000-000000000003', '90000000-0000-4000-8000-000000000001');
insert into public.orders (id, store_id, order_number, status, flow, fulfillment_type, channel, customer_name, subtotal_cents, total_cents, payment_method, created_at)
select ('91000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  '90000000-0000-4000-8000-000000000001', 'PLACEHOLDER_PAG-' || n,
  'ready', 'manual', 'delivery', 'delivery', 'PLACEHOLDER_CLIENTE_A', 100, 100, 'cash', '2026-01-01T10:00:00Z'
from generate_series(1,125) n;
insert into public.orders (id, store_id, order_number, status, flow, fulfillment_type, channel, customer_name, subtotal_cents, total_cents, payment_method, created_at) values
  ('91000000-0000-4000-8000-000000000126', '90000000-0000-4000-8000-000000000001', 'PLACEHOLDER_BALCAO', 'paid', 'manual', 'pickup', 'counter', 'PLACEHOLDER_CLIENTE_A', 100, 100, 'cash', '2026-01-01T11:00:00Z'),
  ('91000000-0000-4000-8000-000000000127', '90000000-0000-4000-8000-000000000002', 'PLACEHOLDER_OUTRA_LOJA', 'ready', 'manual', 'delivery', 'delivery', 'PLACEHOLDER_CLIENTE_B', 100, 100, 'cash', '2026-01-01T12:00:00Z');
insert into public.order_items (order_id, store_id, name_snapshot, qty, unit_price_cents, station)
values ('91000000-0000-4000-8000-000000000125', '90000000-0000-4000-8000-000000000001', 'PLACEHOLDER_ARTIGO', 1, 100, 'kitchen');

select set_config('request.jwt.claim.sub', '90000000-0000-4000-8000-000000000003', true);
set local role authenticated;

select is((public.get_orders('{"limit":10}') ->> 'total')::int, 126, 'total inclui todos os pedidos autorizados, sem truncar aos 100');
select is(jsonb_array_length(public.get_orders('{"limit":10}') -> 'orders'), 10, 'limite é aplicado antes da agregação');
select is(jsonb_array_length(public.get_orders('{"limit":10,"offset":100}') -> 'orders'), 10, 'a página 11 contém pedidos reais');
select is((public.get_orders('{"limit":10,"offset":200}') ->> 'total')::int, 126, 'página vazia conserva total filtrado');
select is(jsonb_array_length(public.get_orders('{"limit":10,"offset":200}') -> 'orders'), 0, 'offset além do fim devolve lista vazia');
select is((public.get_orders('{"store":"teste-paginacao-b","limit":10}') ->> 'total')::int, 0, 'filtro não ultrapassa RLS da loja');
select is((public.get_orders('{"store":"teste-paginacao-a","status":"ready","search":"PLACEHOLDER_CLIENTE_A","channel":"delivery","limit":10,"offset":10}') ->> 'total')::int, 125, 'total reflecte os filtros antes de paginar');
select is(public.get_orders('{"channel":"delivery","limit":10,"offset":10}') #>> '{orders,0,id}', '91000000-0000-4000-8000-000000000115', 'empates em created_at usam id como desempate');
select is(public.get_orders('{"channel":"delivery","limit":10}') #>> '{orders,0,items,0,name}', 'PLACEHOLDER_ARTIGO', 'itens pertencem ao pedido da página');
select is((public.get_orders('{"channel":"counter","limit":10}') ->> 'total')::int, 1, 'filtro channel acontece no servidor antes do limite');
select is((public.get_orders('{"statuses":["ready"],"limit":10,"offset":100}') ->> 'total')::int, 125, 'lista de estados filtra antes de paginar para o POS');
select ok(not has_function_privilege('anon', 'public.get_orders(jsonb)', 'EXECUTE'), 'anon continua sem acesso à RPC');
select ok(not (select prosecdef from pg_proc where oid = 'public.get_orders(jsonb)'::regprocedure), 'RPC continua SECURITY INVOKER');

select * from finish();
rollback;
