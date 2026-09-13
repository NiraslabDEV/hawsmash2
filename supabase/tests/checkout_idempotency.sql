-- 1047: executar na stack local de testes; tudo é revertido no fim.
begin;
select plan(17);

create temporary table checkout_fixture as
select gen_random_uuid() as store_id, gen_random_uuid() as order_id, gen_random_uuid() as checkout_id;
insert into public.stores (id, slug, name, short_name, order_prefix, emola_provider)
select store_id, 'placeholder-checkout-1047', 'PLACEHOLDER_CHECKOUT_1047', 'PLACEHOLDER_CHECKOUT_1047', 'TSTEM', 'mock'
from checkout_fixture;
insert into public.orders (
  id, store_id, order_number, status, flow, fulfillment_type, channel,
  customer_name, subtotal_cents, delivery_fee_cents, total_cents, payment_method,
  client_checkout_id, checkout_request_hash
)
select order_id, store_id, 'PLACEHOLDER_CHECKOUT_1047', 'awaiting_payment', 'digital', 'pickup', 'pickup',
  'PLACEHOLDER_CLIENTE', 10000, 0, 10000, 'emola', checkout_id, repeat('0', 64)
from checkout_fixture;

select throws_ok(
  $$select public.create_order('placeholder-checkout-1047', '{"flow":"digital","paymentMethod":"emola"}')$$,
  'P0400', 'client_checkout_id_required', 'digital exige chave antes de criar');
select throws_ok(
  $$select public.create_order('placeholder-checkout-1047', '{"flow":"digital","paymentMethod":"emola","clientCheckoutId":"INVALID"}')$$,
  'P0400', 'invalid_client_checkout_id', 'digital recusa chave inválida');

select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select throws_ok(
  $$select public.claim_online_checkout((select order_id from checkout_fixture))$$,
  'P0403', 'checkout_claim_denied', 'claim exige identidade de servidor');
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select is(public.claim_online_checkout((select order_id from checkout_fixture)) ->> 'claimed', 'true', 'primeiro claim inicia');
select is(public.claim_online_checkout((select order_id from checkout_fixture)) ->> 'claimed', 'false', 'repetição não reinicia');
select ok((select checkout_started_at is not null from public.orders where id = (select order_id from checkout_fixture)), 'claim fica persistido');
update public.orders set checkout_url = 'https://checkout.example/PLACEHOLDER_1047'
where id = (select order_id from checkout_fixture);
select is(public.claim_online_checkout((select order_id from checkout_fixture)) ->> 'checkoutUrl', 'https://checkout.example/PLACEHOLDER_1047', 'reutiliza URL existente');
update public.orders set status = 'paid' where id = (select order_id from checkout_fixture);
select is(public.claim_online_checkout((select order_id from checkout_fixture)) ->> 'claimed', 'false', 'pedido pago não inicia cobrança');

select ok(not has_function_privilege('anon', 'public.claim_online_checkout(uuid)', 'execute'), 'anon não executa claim');
select ok(not has_function_privilege('authenticated', 'public.claim_online_checkout(uuid)', 'execute'), 'browser não executa claim');
select ok(has_function_privilege('service_role', 'public.claim_online_checkout(uuid)', 'execute'), 'serviço executa claim');
select ok(not has_column_privilege('authenticated', 'public.orders', 'client_checkout_id', 'select'), 'chave não sai no browser');
select ok(not has_column_privilege('authenticated', 'public.orders', 'checkout_request_hash', 'select'), 'hash não sai no browser');
select ok(not has_column_privilege('authenticated', 'public.orders', 'checkout_started_at', 'select'), 'claim não sai no browser');
select ok(not has_column_privilege('authenticated', 'public.orders', 'checkout_url', 'select'), 'URL não sai por SELECT do browser');
select ok(has_column_privilege('authenticated', 'public.orders', 'status', 'select'), 'estado público anterior preservado');
select ok(exists (select 1 from pg_catalog.pg_indexes where schemaname = 'public' and tablename = 'orders' and indexname = 'orders_store_checkout_id_key'), 'índice de idempotência criado');

select * from finish();
rollback;
