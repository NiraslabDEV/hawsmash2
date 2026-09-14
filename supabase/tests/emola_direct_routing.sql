-- 1048: preparação directa, sem chamadas à Movitel ou ao Paysuite.
begin;
select plan(11);
select is(private.payment_mode('mpesa', 'emola', 'emola'), 'emola', 'e-Mola directo independente');
select is(private.payment_mode('mpesa', 'emola_sim', 'emola'), 'emola_sim', 'simulação directa independente');
select is(private.payment_mode('mpesa', 'emola', 'mpesa'), 'mpesa', 'M-Pesa mantém o seu caminho');
select is(private.payment_mode('mpesa', 'emola_sim', 'credit_card'), 'manual', 'simular e-Mola não activa cartão');
select is(private.payment_mode('paysuite', null, 'emola'), 'paysuite', 'gateway anterior permanece compatível');
select is(private.payment_mode('mpesa', null, 'emola'), 'manual', 'lojas não são activadas implicitamente');

create temporary table emola_direct_fixture as select gen_random_uuid() as store_id;
insert into public.stores (id, slug, name, short_name, order_prefix, emola_provider)
select store_id, 'placeholder-emola-1048', 'PLACEHOLDER_EMOLA_1048', 'PLACEHOLDER_EMOLA_1048', 'TSTEM', 'emola'
from emola_direct_fixture;

select throws_ok(
  $$select public.create_order('placeholder-emola-1048', '{"flow":"digital","paymentMethod":"emola","clientCheckoutId":"70000000-0000-4000-8000-000000000048"}')$$,
  'P0400', 'emola_direct_contract_unavailable', 'RPC real recusa antes de criar pedido');
select is((select count(*)::int from public.orders where store_id = (select store_id from emola_direct_fixture)), 0, 'recusa não deixa pedido pendente');
select lives_ok(
  $$update public.stores set emola_provider = 'emola_sim' where id = (select store_id from emola_direct_fixture)$$,
  'schema aceita o simulador directo');
select ok(not has_function_privilege('anon', 'public.save_store_payment(uuid,jsonb)', 'execute'), 'anon não muda a configuração');
select ok(not has_column_privilege('authenticated', 'public.stores', 'emola_provider', 'update'), 'REST não contorna a configuração auditada');
select * from finish();
rollback;
