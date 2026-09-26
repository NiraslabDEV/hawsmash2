-- HAWSMASH 2.0 — 1097: quem pode mudar o estado de um pedido, quem confirma
-- pagamentos, e o papel que nunca desfaz uma aprovação.
--
-- Auditoria de 26/09 (docs/AUDITORIA-DOCUMENTACAO.md §5), provada numa BD local
-- antes de corrigir:
--
-- V-14. `advance_order` só verificava o acesso à loja. A cozinha aprovava e
--       cancelava pedidos por RPC, e o caixa cancelava uma venda de balcão já
--       paga com CANCEL — o mesmo efeito do `void_sale`, que exige gerente, sem
--       passar por ele. Com o dinheiro na mão, cancelar a venda baixava o
--       esperado em caixa.
--       Agora (CLAUDE §6, decisão do dono de 23 Set para o caixa):
--         APPROVE           → owner, manager, cashier
--         CANCEL            → owner, manager; cashier só antes de haver dinheiro
--                             (recusar um pedido online por aprovar/pagar)
--         START_PREPARATION, MARK_READY, DELIVER → toda a equipa da loja
--         PAYMENT_FAILED    → só o servidor (já era)
--       O service_role (webhook, cron, verificação) continua com tudo.
--
-- V-15. `confirm_payment` estava concedida a `authenticated`: qualquer pessoa
--       da equipa marcava um pedido digital como pago, com a referência e o
--       fornecedor que quisesse, sem o gateway dizer nada (CLAUDE §17: o estado
--       de pagamento nunca vem do cliente). Só o servidor a chama — webhook,
--       verificação no regresso, reconciliação e cobrança directa, todos com a
--       service role. Passa a ser só dele.
--
-- V-16. A comanda padrão era posta na fila dentro da aprovação/confirmação sem
--       rede: um erro SQL a montar o papel revertia o pedido aprovado ou pago
--       (CLAUDE §1: o papel é best-effort). Agora falha num subbloco: a
--       aprovação grava, a comanda antiga do motor fica na fila como reserva, e
--       a falha fica em `event_log` como `print.enqueue_failed`.

-- ---------------------------------------------------------------------------
-- advance_order
-- ---------------------------------------------------------------------------
create or replace function public.advance_order(
  p_order_id uuid,
  p_event text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store_id uuid;
  v_status text;
  v_flow text;
  v_role text;
  v_service boolean := coalesce((select auth.jwt() ->> 'role') = 'service_role', false);
  v_resultado jsonb;
begin
  if p_event = 'PAYMENT_FAILED' then
    if not v_service then
      raise exception 'payment_transition_denied' using errcode = 'P0403';
    end if;
    select o.store_id, o.status, o.flow into v_store_id, v_status, v_flow
    from public.orders o where o.id = p_order_id for update;
    if not found then raise exception 'order_not_found' using errcode = 'P0404'; end if;
    if v_flow is distinct from 'digital' or v_status is distinct from 'awaiting_payment' then
      return jsonb_build_object('success', true, 'order_id', p_order_id,
        'status', v_status, 'new_status', v_status, 'unchanged', true);
    end if;
    update public.orders set status = 'payment_failed', updated_at = now()
    where id = p_order_id and store_id = v_store_id and status = 'awaiting_payment';
    insert into public.event_log (store_id, order_id, actor_user_id, type, payload)
    values (v_store_id, p_order_id, (select auth.uid()), 'payment.failed',
      jsonb_build_object('source', 'advance_order', 'reason', left(p_reason, 500),
        'previous_status', v_status, 'new_status', 'payment_failed'));
    return jsonb_build_object('success', true, 'order_id', p_order_id,
      'status', 'payment_failed', 'new_status', 'payment_failed');
  end if;

  if not private.can_access_order(p_order_id) then
    raise exception 'store_access_denied' using errcode = 'P0403';
  end if;
  select o.store_id, o.status into v_store_id, v_status
  from public.orders o where o.id = p_order_id;

  if not v_service then
    v_role := coalesce(private.auth_role(), '');
    if p_event = 'APPROVE' and v_role not in ('owner', 'manager', 'cashier') then
      raise exception 'order_transition_denied' using errcode = 'P0403';
    end if;
    if p_event = 'CANCEL' and not (
      v_role in ('owner', 'manager')
      or (v_role = 'cashier'
          and v_status in ('draft', 'awaiting_approval', 'awaiting_payment', 'payment_failed'))
    ) then
      raise exception 'order_transition_denied' using errcode = 'P0403';
    end if;
  end if;

  perform set_config('app.request_store_id', v_store_id::text, true);

  v_resultado := private.advance_order_legacy(p_order_id, p_event, p_reason);

  -- Aprovar é o que manda o pedido para a cozinha: aqui sai a comanda da casa,
  -- nas vias que a loja pede. Best-effort: se falhar, a aprovação fica.
  if p_event = 'APPROVE' then
    begin
      perform private.enqueue_kitchen_tickets(p_order_id);
    exception when others then
      insert into public.event_log (store_id, order_id, actor_user_id, type, payload)
      values (v_store_id, p_order_id, (select auth.uid()), 'print.enqueue_failed',
        jsonb_build_object('source', 'advance_order', 'sqlstate', sqlstate, 'error', left(sqlerrm, 300)));
    end;
  end if;

  return v_resultado;
end;
$$;

revoke all on function public.advance_order(uuid, text, text) from public, anon;
grant execute on function public.advance_order(uuid, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- confirm_payment — só o servidor
-- ---------------------------------------------------------------------------
create or replace function public.confirm_payment(
  p_idempotency_key text,
  p_order_id uuid,
  p_provider text,
  p_provider_ref text,
  p_method text,
  p_amount_cents integer,
  p_raw_webhook jsonb default '{}'::jsonb
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store_id uuid;
  v_resultado text;
begin
  -- Defesa em profundidade: o EXECUTE já só é do service_role.
  if not coalesce((select auth.jwt() ->> 'role') = 'service_role', false) then
    raise exception 'payment_confirmation_denied' using errcode = 'P0403';
  end if;

  select o.store_id into v_store_id
  from public.orders o
  where o.id = p_order_id;
  perform set_config('app.request_store_id', v_store_id::text, true);

  v_resultado := private.confirm_payment_legacy(
    p_idempotency_key,
    p_order_id,
    p_provider,
    p_provider_ref,
    p_method,
    p_amount_cents,
    p_raw_webhook
  );

  -- Só a primeira confirmação manda para a cozinha. Best-effort: o pagamento
  -- recebido nunca se desfaz por causa do papel.
  if v_resultado = 'ok' then
    begin
      perform private.enqueue_kitchen_tickets(p_order_id);
    exception when others then
      insert into public.event_log (store_id, order_id, actor_user_id, type, payload)
      values (v_store_id, p_order_id, (select auth.uid()), 'print.enqueue_failed',
        jsonb_build_object('source', 'confirm_payment', 'sqlstate', sqlstate, 'error', left(sqlerrm, 300)));
    end;
  end if;

  return v_resultado;
end;
$$;

revoke all on function public.confirm_payment(text, uuid, text, text, text, integer, jsonb)
  from public, anon, authenticated;
grant execute on function public.confirm_payment(text, uuid, text, text, text, integer, jsonb)
  to service_role;
