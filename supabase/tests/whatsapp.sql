-- Executar apenas localmente: supabase test db --local supabase/tests/whatsapp.sql
-- WhatsApp (1117 base portátil + 1118 pedidos; recepção pela whatsapp_receive da 1124). Os dados de teste são revertidos no fim.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(34);

insert into public.stores (id, slug, name, short_name, order_prefix) values
  ('94000000-0000-4000-8000-000000000001', 'teste-wa-a', 'PLACEHOLDER_LOJA_A', 'PLACEHOLDER_A', 'TWAA'),
  ('94000000-0000-4000-8000-000000000002', 'teste-wa-b', 'PLACEHOLDER_LOJA_B', 'PLACEHOLDER_B', 'TWAB');

-- ── Telefone ────────────────────────────────────────────────────────────────
select is(private.whatsapp_phone_mz('84 123 4567'), '+258841234567', 'telefone local');
select is(private.whatsapp_phone_mz('+258 87 030 1006'), '+258870301006', 'número de Maputo');
select is(private.whatsapp_phone_mz('00258 82 123 4567'), '+258821234567', 'indicativo 00');
select is(private.whatsapp_phone_mz('21 123 456'), null, 'fixo não tem WhatsApp');
select is(private.whatsapp_phone_mz('84a1234567'), null, 'letras recusadas');

-- ── Interruptor e número ────────────────────────────────────────────────────
select throws_ok(
  $$update public.stores set whatsapp_enabled = true where id = '94000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'não se liga a loja sem número do fornecedor');
select is(public.whatsapp_enqueue('94000000-0000-4000-8000-000000000001', 'order', 'x1', 'order.paid', '+258841234567'),
  null, 'loja desligada não enfileira');
update public.stores set whatsapp_sender_id = 'PLACEHOLDER_SENDER_A', whatsapp_enabled = true
 where id = '94000000-0000-4000-8000-000000000001';
select throws_ok(
  $$update public.stores set whatsapp_sender_id = 'PLACEHOLDER_SENDER_A' where id = '94000000-0000-4000-8000-000000000002'$$,
  '23505', null, 'um número do fornecedor pertence a uma só loja');

-- ── Enfileirar: idempotente, telefone válido, opt-out ───────────────────────
select isnt(public.whatsapp_enqueue('94000000-0000-4000-8000-000000000001', 'order', 'x1', 'order.paid', '+258841234567'),
  null, 'loja ligada enfileira');
select is(public.whatsapp_enqueue('94000000-0000-4000-8000-000000000001', 'order', 'x1', 'order.paid', '+258841234567'),
  null, 'o mesmo evento do mesmo assunto não entra duas vezes');
select is((select count(*)::int from public.whatsapp_outbox where subject_id = 'x1'), 1, 'uma só linha');
select is(public.whatsapp_enqueue('94000000-0000-4000-8000-000000000001', 'order', 'x2', 'order.paid', '841234567'),
  null, 'telefone sem E.164 não entra');
insert into public.whatsapp_optouts (phone, source) values ('+258849999999', 'teste');
select is(public.whatsapp_enqueue('94000000-0000-4000-8000-000000000001', 'order', 'x3', 'order.paid', '+258849999999'),
  null, 'opt-out bloqueia utility');
select isnt(public.whatsapp_enqueue('94000000-0000-4000-8000-000000000001', 'login', 'x3', 'member.code', '+258849999999', '{}', 'authentication'),
  null, 'opt-out não bloqueia o código que a pessoa pediu');
select is((select count(*)::int from public.event_log where type = 'whatsapp.queued' and store_id = '94000000-0000-4000-8000-000000000001'),
  2, 'event_log por cada linha nova');

-- ── Claim, retry e aceite ───────────────────────────────────────────────────
delete from public.whatsapp_outbox where store_id <> '94000000-0000-4000-8000-000000000001';
select is((select count(*)::int from public.whatsapp_claim(50)), 2, 'claim apanha as linhas devidas');
select is((select count(*)::int from public.whatsapp_claim(50)), 0, 'o que está a sair não é apanhado outra vez');
select is(public.whatsapp_finish((select id from public.whatsapp_outbox where subject_id = 'x1'), false, null, true, 'rate_limited', 120),
  'retry', 'falha temporária volta à fila');
select ok((select due_at > now() + interval '100 seconds' and status = 'queued' from public.whatsapp_outbox where subject_id = 'x1'),
  'respeita o tempo pedido pelo fornecedor');
update public.whatsapp_outbox set due_at = now() where subject_id = 'x1';
select is((select attempts from public.whatsapp_claim(50) where subject_id = 'x1'), 2, 'segunda tentativa conta');
select is(public.whatsapp_finish((select id from public.whatsapp_outbox where subject_id = 'x1'), true, 'PLACEHOLDER_MSG_1'),
  'accepted', 'aceite pelo fornecedor');

-- ── Estados do webhook: deduplicados e só para a frente ─────────────────────
select ok(public.whatsapp_apply_status('evt_t1', 'PLACEHOLDER_MSG_1', 'delivered'), 'entregue');
select ok(not public.whatsapp_apply_status('evt_t1', 'PLACEHOLDER_MSG_1', 'read'), 'o mesmo evento não se aplica duas vezes');
select ok(not public.whatsapp_apply_status('evt_t2', 'PLACEHOLDER_MSG_1', 'sent'), 'estado não anda para trás');
select ok(not public.whatsapp_apply_status('evt_t3', 'PLACEHOLDER_MSG_1', 'failed'), 'falha depois de entregue é ignorada');
select ok(public.whatsapp_apply_status('evt_t4', 'PLACEHOLDER_MSG_1', 'read'), 'lida');

-- ── Recepção pelo número que recebeu, e SAIR ────────────────────────────────
select is(public.whatsapp_receive('evt_i0', 'PLACEHOLDER_DESCONHECIDO', '+258841111111', 'm0', 'text', 'olá'),
  null::jsonb, 'número desconhecido não grava nada');
select public.whatsapp_enqueue('94000000-0000-4000-8000-000000000001', 'order', 'x9', 'order.paid', '+258841111111');
select is((public.whatsapp_receive('evt_i1', 'PLACEHOLDER_SENDER_A', '+258841111111', 'm1', 'text', 'SAIR', null, null, null, null, true) ->> 'store_id')::uuid,
  '94000000-0000-4000-8000-000000000001'::uuid, 'mensagem cai na loja do número');
select is((select status from public.whatsapp_outbox where subject_id = 'x9'), 'cancelled', 'SAIR cancela o que estava na fila');

-- ── Gatilho dos pedidos (1118) ──────────────────────────────────────────────
insert into public.orders (id, store_id, order_number, status, flow, fulfillment_type, channel, customer_name, customer_phone,
                           subtotal_cents, total_cents, payment_method, scheduled_for) values
  ('95000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000001', 'PLACEHOLDER_P1', 'paid', 'digital',
   'pickup', 'pickup', 'PLACEHOLDER Ana Silva', '84 222 3333', 100, 100, 'mpesa', now() + interval '3 hours'),
  ('95000000-0000-4000-8000-000000000002', '94000000-0000-4000-8000-000000000001', 'PLACEHOLDER_P2', 'paid', 'manual',
   'pickup', 'counter', 'PLACEHOLDER_BALCAO', '84 222 4444', 100, 100, 'cash', null),
  ('95000000-0000-4000-8000-000000000003', '94000000-0000-4000-8000-000000000002', 'PLACEHOLDER_P3', 'paid', 'digital',
   'delivery', 'delivery', 'PLACEHOLDER_B', '84 222 5555', 100, 100, 'mpesa', null);
select set_eq(
  $$select event from public.whatsapp_outbox where subject_id = '95000000-0000-4000-8000-000000000001'$$,
  array['order.paid', 'order.scheduled_reminder'], 'pedido online pago: aviso + lembrete do agendado');
select is((select count(*)::int from public.whatsapp_outbox where subject_id in
  ('95000000-0000-4000-8000-000000000002', '95000000-0000-4000-8000-000000000003')), 0,
  'balcão não recebe; loja sem WhatsApp nunca sai por outro número');
update public.orders set status = 'cancelled' where id = '95000000-0000-4000-8000-000000000001';
select is((select status from public.whatsapp_outbox where subject_id = '95000000-0000-4000-8000-000000000001'
   and event = 'order.scheduled_reminder'), 'cancelled', 'cancelar tira o lembrete da fila');
select is((select count(*)::int from public.whatsapp_outbox where subject_id = '95000000-0000-4000-8000-000000000001'
   and event = 'order.cancelled'), 1, 'quem já pagou é avisado do cancelamento');

-- ── RLS ─────────────────────────────────────────────────────────────────────
select ok(not has_table_privilege('anon', 'public.whatsapp_outbox', 'SELECT'), 'anon não lê a fila');

select * from finish();
rollback;
