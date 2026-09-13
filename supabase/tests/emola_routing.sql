-- 1046: contrato de encaminhamento. Correr apenas na stack local/staging de teste.
begin;
select plan(13);
select is(private.payment_mode('mpesa', null, 'mpesa'), 'mpesa', 'preserva M-Pesa directo');
select is(private.payment_mode('mpesa', null, 'emola'), 'manual', 'e-Mola directo desligado por omissão');
select is(private.payment_mode('mpesa', 'paysuite', 'emola'), 'paysuite', 'e-Mola usa gateway separado');
select is(private.payment_mode('mpesa', 'paysuite', 'credit_card'), 'manual', 'e-Mola não activa cartão');
select is(private.payment_mode('paysuite', null, 'emola'), 'paysuite', 'preserva gateway herdado');
select is(private.payment_mode('paysuite', 'manual', 'emola'), 'manual', 'permite desligar só e-Mola');
select is(private.payment_mode('manual', 'mock', 'emola'), 'mock', 'permite ensaio independente');
select is(private.payment_mode('mpesa', 'mpesa', 'emola'), 'manual', 'recusa provider incompatível');
select is(private.payment_mode('paysuite', null, 'cash'), 'manual', 'dinheiro não é digital');
select ok(not has_function_privilege('anon', 'private.payment_mode(text,text,text)', 'execute'), 'helper privado não é API anónima');
select ok(not has_table_privilege('authenticated', 'public.stores', 'insert'), 'lojas novas passam pela RPC auditada');
select ok(not has_column_privilege('authenticated', 'public.stores', 'emola_provider', 'update'), 'REST não contorna o guard de e-Mola');
select ok(not has_column_privilege('authenticated', 'public.stores', 'payment_provider', 'update'), 'REST não contorna o guard de M-Pesa');
select * from finish();
rollback;
