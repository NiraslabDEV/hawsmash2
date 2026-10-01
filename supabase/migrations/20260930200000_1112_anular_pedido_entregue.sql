-- HAWSMASH 2.0 — 1112: o dono anula um pedido já entregue.
--
-- Pedido do Gabriel (30 Set), a partir de um pedido de teste (MPT-1423) que
-- entrou na loja a sério e ficou Entregue. "Entregue" é estado final: o
-- `advance_order` recusa cancelar (`cannot cancel terminal state`) e o
-- `void_sale` é só de vendas de balcão por entregar. Apagar é proibido
-- (CLAUDE §17: anula-se com motivo, nunca se apaga) — um DELETE deixava o
-- stock gasto sem volta e os pagamentos fora do livro.
--
-- `void_delivered_order(p_order_id, p_reason)`:
--   - só o dono (`owner`); gerente, caixa e cozinha recusados. Pedidos por
--     entregar continuam a ter o Cancelar de sempre;
--   - motivo obrigatório (3–500 caracteres), gravado no event_log com quem;
--   - repõe o stock e os ingredientes (`private.restore_order_stock`,
--     idempotente — nunca repõe duas vezes);
--   - estado → cancelled; o pedido fica, com o histórico;
--   - pagamentos confirmados → refunded: saem do turno aberto, do fecho do
--     dia e dos relatórios (o fecho conta só `confirmed` de pedidos não
--     cancelados);
--   - o email "cancelado" que o trigger da 1104 põe na fila é retirado: o
--     cliente já recebeu o pedido; é uma correcção interna. Best-effort;
--   - repetir num pedido já anulado não faz nada (`duplicate`).
--
-- Um turno que já fechou com este pedido fica como fechou (o relatório é
-- congelado). A resposta diz-o (`shift_closed`), para o painel avisar.
--
-- Forward-only: acrescenta uma função, não toca em dados.

create or replace function public.void_delivered_order(p_order_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_reason text := btrim(coalesce(p_reason, ''));
  v_order public.orders%rowtype;
  v_restored integer := 0;
  v_refunded integer := 0;
  v_refunded_cents bigint := 0;
  v_shift_closed boolean := false;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0020';
  end if;
  if coalesce(private.auth_role(), '') <> 'owner' then
    raise exception 'void_access_denied' using errcode = 'P0403';
  end if;
  if length(v_reason) < 3 or length(v_reason) > 500 then
    raise exception 'void_reason_required' using errcode = 'P0007';
  end if;

  select o.* into v_order
  from public.orders o
  where o.id = p_order_id
  for update;
  if not found or not private.auth_can_store(v_order.store_id) then
    raise exception 'order_not_found' using errcode = 'P0404';
  end if;

  if v_order.status = 'cancelled' then
    return jsonb_build_object('order_id', v_order.id, 'status', 'cancelled', 'duplicate', true);
  end if;
  if v_order.status <> 'delivered' then
    raise exception 'order_not_delivered' using errcode = 'P0409';
  end if;

  perform set_config('app.request_store_id', v_order.store_id::text, true);

  v_restored := coalesce(private.restore_order_stock(v_order.id), 0);

  update public.orders
  set status = 'cancelled', updated_at = now()
  where id = v_order.id and store_id = v_order.store_id and status = 'delivered';

  select count(*)::integer, coalesce(sum(p.amount_cents), 0)
  into v_refunded, v_refunded_cents
  from public.payments p
  where p.order_id = v_order.id and p.store_id = v_order.store_id and p.status = 'confirmed';

  update public.payments
  set status = 'refunded'
  where order_id = v_order.id and store_id = v_order.store_id and status = 'confirmed';

  -- O cliente já comeu: nada de "o seu pedido foi cancelado".
  begin
    update public.email_jobs
    set status = 'cancelled', error = 'Pedido entregue anulado pelo dono: sem email ao cliente.'
    where store_id = v_order.store_id
      and event_key = v_order.id::text || ':cancelled'
      and status = 'queued';
  exception when others then
    null;
  end;

  select exists (
    select 1
    from public.cash_sessions cs
    where cs.store_id = v_order.store_id
      and cs.closed_at is not null
      and v_order.created_at >= coalesce((cs.report ->> 'period_start')::timestamptz, cs.opened_at)
      and v_order.created_at < cs.closed_at
  ) into v_shift_closed;

  insert into public.event_log (store_id, order_id, actor_user_id, type, payload)
  values (
    v_order.store_id,
    v_order.id,
    v_uid,
    'order.voided',
    jsonb_build_object(
      'reason', v_reason,
      'previous_status', v_order.status,
      'new_status', 'cancelled',
      'order_number', v_order.order_number,
      'total_cents', v_order.total_cents,
      'restored_qty', v_restored,
      'refunded_payments', v_refunded,
      'refunded_cents', v_refunded_cents,
      'shift_closed', v_shift_closed
    )
  );

  return jsonb_build_object(
    'order_id', v_order.id,
    'status', 'cancelled',
    'restored_qty', v_restored,
    'refunded_cents', v_refunded_cents,
    'shift_closed', v_shift_closed,
    'duplicate', false
  );
end;
$$;

revoke all on function public.void_delivered_order(uuid, text) from public, anon;
grant execute on function public.void_delivered_order(uuid, text) to authenticated;
