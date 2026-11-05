-- HAWSMASH 2.0 — 1127: o mini POS do garçom.
--
-- Pedido do dono (05 Nov): "dar bem mais autonomia, tipo um mini POS no celular".
-- O telemóvel passa a corrigir, a fechar a mesa e a ver o histórico:
--
--   retirar artigo    do pedido dele, ainda na cozinha, dentro do limite da loja
--   cobrar            M-Pesa, e-Mola, cartão — só com autorização, garçom a garçom
--   mudar de mesa     a conta inteira; junta-se à que lá estiver
--   pedir a conta     papel no balcão com os artigos e o total
--   reimprimir        a comanda, marcada REIMPRESSÃO
--   esgotado          marcar e desmarcar, na loja dele
--   histórico         os pedidos dele; no painel, os de cada garçom
--
-- DECISÃO: o garçom NÃO recebe dinheiro em notas pelo telemóvel. `close_table_bill`
-- soma o dinheiro ao esperado da gaveta; sem um registo de "o garçom entregou X ao
-- caixa", a gaveta fechava a faltar e ninguém sabia a quem pedir. Abrir isto é uma
-- decisão do dono, e exige esse registo primeiro.
--
-- DECISÃO: cobrar vem desligado (`waiters.can_charge`). "Registar M-Pesa" não fala
-- com a Vodacom, como no balcão: um garçom que marque pago sem ter recebido só se
-- apanha na conferência. Por isso o dono ou o gerente autoriza quem pode, e a conta
-- fica assinada (`table_bills.waiter_id`).
--
-- DECISÃO: retirar tem limite (`stores.waiter_remove_minutes`, 3 min de fábrica, 0
-- desliga). Depois disso a comida pode estar feita ou servida, e retirar baixava a
-- conta da mesa sem ninguém ver: passa a ser com o balcão, sem limite, como sempre.
--
-- `close_table_bill` e `remove_table_item` passam a ter o corpo em funções privadas
-- partilhadas: a repartição dos pagamentos, o stock e o papel continuam a ser uma
-- conta só. O corpo é o da 1081 e o da 1102, sem mudar regra nenhuma; o POS continua
-- a passar pelas mesmas portas. Forward-only.

-- ---------------------------------------------------------------------------
-- 1. Colunas
-- ---------------------------------------------------------------------------
alter table public.stores
  add column if not exists waiter_remove_minutes smallint not null default 3
    check (waiter_remove_minutes between 0 and 30);
comment on column public.stores.waiter_remove_minutes is
  'Minutos em que o garçom pode retirar um artigo do pedido dele. 0 = não pode (1127).';

alter table public.waiters
  add column if not exists can_charge boolean not null default false;
comment on column public.waiters.can_charge is
  'Pode fechar a conta da mesa no telemóvel, sem dinheiro em notas (1127).';

alter table public.table_bills
  add column if not exists waiter_id uuid references public.waiters(id) on delete set null;
comment on column public.table_bills.waiter_id is
  'Garçom que cobrou a conta no telemóvel. Null = POS (1127).';

-- ---------------------------------------------------------------------------
-- 2. A conta da mesa: uma só, para o POS e para o telemóvel
-- ---------------------------------------------------------------------------
create or replace function private.close_table_bill_core(
  p_store public.stores,
  p_table_id uuid,
  p_client_close_id uuid,
  p_expected integer,
  p_payload jsonb,
  p_actor uuid,
  p_device_id uuid,
  p_waiter_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_table public.tables%rowtype;
  v_order_ids uuid[];
  v_total integer;
  v_payment jsonb;
  v_payments jsonb := '[]'::jsonb;
  v_amount integer;
  v_payment_total integer := 0;
  v_cash_payment integer := 0;
  v_cash_received integer;
  v_change integer;
  v_bill_id uuid;
  v_order record;
  v_due integer;
  v_index integer := -1;
  v_left integer := 0;
  v_method text;
  v_first_method text;
  v_seq integer := 0;
  v_take integer;
  v_job_id uuid;
begin
  select t.* into v_table
  from public.tables t
  where t.id = p_table_id
    and t.store_id = p_store.id;
  if not found then
    raise exception 'invalid_table' using errcode = 'P0060';
  end if;

  -- Duas caixas a fechar a mesma mesa: a segunda espera por esta e depois
  -- já não encontra o que cobrar.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('table_tab:' || v_table.id::text, 0)
  );

  select array_agg(t.id order by o.created_at, o.id), sum(o.total_cents)::integer
  into v_order_ids, v_total
  from private.table_tab_order_ids(p_store.id, v_table.id) t(id)
  join public.orders o on o.id = t.id;

  if v_order_ids is null or v_total is null or v_total <= 0 then
    raise exception 'table_has_no_open_orders' using errcode = 'P0409';
  end if;

  perform 1 from public.orders o where o.id = any(v_order_ids) for update;

  -- Só se cobra o que o caixa viu. Um pedido do QR que entrou entretanto
  -- muda o total: a conta não fecha e o POS mostra-a outra vez.
  if p_expected is null or p_expected <> v_total then
    raise exception 'table_bill_changed' using errcode = 'P0409';
  end if;

  if p_payload -> 'payments' is null
    or jsonb_typeof(p_payload -> 'payments') <> 'array'
    or jsonb_array_length(p_payload -> 'payments') = 0
    or jsonb_array_length(p_payload -> 'payments') > 4
  then
    raise exception 'invalid_payments' using errcode = 'P0007';
  end if;

  for v_payment in select value from jsonb_array_elements(p_payload -> 'payments')
  loop
    if coalesce(v_payment ->> 'method', '') not in ('cash', 'mpesa', 'emola', 'credit_card') then
      raise exception 'invalid_payment_method' using errcode = 'P0007';
    end if;
    begin
      v_amount := (v_payment ->> 'amountCents')::integer;
    exception when invalid_text_representation then
      raise exception 'invalid_payment_amount' using errcode = 'P0007';
    end;
    if v_amount is null or v_amount <= 0 then
      raise exception 'invalid_payment_amount' using errcode = 'P0007';
    end if;
    v_payment_total := v_payment_total + v_amount;
    if v_payment ->> 'method' = 'cash' then
      v_cash_payment := v_cash_payment + v_amount;
    end if;
    v_payments := v_payments || jsonb_build_array(
      jsonb_build_object('method', v_payment ->> 'method', 'amount_cents', v_amount)
    );
  end loop;

  if v_payment_total <> v_total then
    raise exception 'payment_total_mismatch' using errcode = 'P0007';
  end if;

  if v_cash_payment > 0 then
    begin
      v_cash_received := (p_payload ->> 'cashReceivedCents')::integer;
    exception when invalid_text_representation then
      raise exception 'invalid_cash_received' using errcode = 'P0007';
    end;
    if v_cash_received is null or v_cash_received < v_cash_payment then
      raise exception 'insufficient_cash_received' using errcode = 'P0007';
    end if;
    v_change := v_cash_received - v_cash_payment;
  end if;

  insert into public.table_bills (
    store_id, table_id, table_number, client_close_id, device_id, waiter_id, order_ids,
    total_cents, payments, cash_received_cents, change_cents, closed_by
  ) values (
    p_store.id, v_table.id, v_table.number, p_client_close_id, p_device_id, p_waiter_id, v_order_ids,
    v_total, v_payments, v_cash_received, v_change, p_actor
  )
  returning id into v_bill_id;

  -- Os pagamentos repartem-se pelos pedidos, por ordem: o fecho de caixa soma
  -- pagamentos confirmados por pedido, e cada pedido fica pago por inteiro.
  for v_order in
    select o.id, o.total_cents
    from public.orders o
    where o.id = any(v_order_ids)
    order by o.created_at, o.id
  loop
    v_due := v_order.total_cents;
    v_first_method := null;
    while v_due > 0 loop
      if v_left = 0 then
        v_index := v_index + 1;
        v_method := v_payments -> v_index ->> 'method';
        v_left := (v_payments -> v_index ->> 'amount_cents')::integer;
      end if;
      v_take := least(v_due, v_left);
      v_seq := v_seq + 1;
      insert into public.payments (
        order_id, store_id, provider, method, amount_cents, status, idempotency_key
      ) values (
        v_order.id, p_store.id, 'counter', v_method, v_take, 'confirmed',
        'table:' || v_bill_id::text || ':' || v_seq::text
      );
      v_first_method := coalesce(v_first_method, v_method);
      v_due := v_due - v_take;
      v_left := v_left - v_take;
    end loop;

    update public.orders
    set table_bill_id = v_bill_id,
        payment_method = coalesce(v_first_method, v_payments -> 0 ->> 'method')
    where id = v_order.id;
  end loop;

  if not exists (
    select 1 from public.cash_sessions cs
    where cs.store_id = p_store.id and cs.closed_at is null
  ) then
    insert into public.cash_sessions (store_id, opened_by)
    values (p_store.id, p_actor);
    insert into public.event_log (store_id, actor_user_id, type, payload)
    values (p_store.id, p_actor, 'cash.session_auto_opened',
      jsonb_build_object('source', 'table_bill'));
  end if;

  insert into public.event_log (store_id, actor_user_id, type, payload)
  values (
    p_store.id, p_actor, 'table.bill_closed',
    jsonb_build_object(
      'bill_id', v_bill_id,
      'table_number', v_table.number,
      'order_ids', to_jsonb(v_order_ids),
      'total_cents', v_total,
      'payments', v_payments,
      'device_id', p_device_id,
      'waiter_id', p_waiter_id
    )
  );

  -- O papel e a gaveta são best-effort (Regra 1): a conta fica fechada.
  -- `kind = 'order'` na estação do balcão é o caminho por onde o bridge de
  -- hoje já imprime o talão completo das vendas.
  begin
    insert into public.print_jobs (store_id, order_id, station, kind, reprint_seq, request_id, payload)
    values (
      p_store.id, null, 'counter', 'order', 0, v_bill_id,
      private.build_table_bill_ticket(v_bill_id)
    )
    returning id into v_job_id;

    if v_cash_payment > 0 then
      insert into public.print_jobs (store_id, order_id, station, kind, reprint_seq, request_id, payload)
      values (
        p_store.id, null, 'counter', 'drawer', 0, v_bill_id,
        jsonb_build_object('reason', 'table_bill', 'bill_id', v_bill_id)
      );
    end if;
  exception when others then
    insert into public.event_log (store_id, actor_user_id, type, payload)
    values (p_store.id, p_actor, 'print.table_bill_failed',
      jsonb_build_object('bill_id', v_bill_id, 'error', sqlstate));
  end;

  update public.devices set last_seen_at = now() where id = p_device_id;

  return jsonb_build_object(
    'bill_id', v_bill_id,
    'table_number', v_table.number,
    'total_cents', v_total,
    'cash_received_cents', v_cash_received,
    'change_cents', v_change,
    'order_count', array_length(v_order_ids, 1),
    'duplicate', false
  );

end;
$$;

revoke all on function private.close_table_bill_core(public.stores, uuid, uuid, integer, jsonb, uuid, uuid, uuid)
  from public, anon, authenticated;

create or replace function public.close_table_bill(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_client_close_id uuid;
  v_device_id uuid;
  v_table_id uuid;
  v_expected integer;
  v_store public.stores%rowtype;
  v_existing public.table_bills%rowtype;
begin
  begin
    v_client_close_id := nullif(p_payload ->> 'clientCloseId', '')::uuid;
    v_device_id := nullif(p_payload ->> 'deviceId', '')::uuid;
    v_table_id := nullif(p_payload ->> 'tableId', '')::uuid;
    v_expected := (p_payload ->> 'expectedTotalCents')::integer;
  exception when invalid_text_representation then
    raise exception 'invalid_pos_payload' using errcode = 'P0007';
  end;
  if v_client_close_id is null then
    raise exception 'client_close_id_required' using errcode = 'P0007';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('table_bill:' || v_client_close_id::text, 0)
  );
  select b.* into v_existing
  from public.table_bills b
  where b.client_close_id = v_client_close_id;
  if found then
    if v_uid is null or not private.auth_can_store(v_existing.store_id) then
      raise exception 'client_close_id_store_conflict' using errcode = 'P0409';
    end if;
    return jsonb_build_object(
      'bill_id', v_existing.id,
      'table_number', v_existing.table_number,
      'total_cents', v_existing.total_cents,
      'cash_received_cents', v_existing.cash_received_cents,
      'change_cents', v_existing.change_cents,
      'order_count', coalesce(array_length(v_existing.order_ids, 1), 0),
      'duplicate', true
    );
  end if;

  v_store := private.pos_device_store(v_device_id);

  return private.close_table_bill_core(
    v_store, v_table_id, v_client_close_id, v_expected, p_payload, v_uid, v_device_id, null
  );
end;
$$;

revoke all on function public.close_table_bill(jsonb) from public, anon;
grant execute on function public.close_table_bill(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Retirar um artigo: uma só conta, para o POS e para o telemóvel
-- ---------------------------------------------------------------------------
create or replace function private.remove_table_item_core(
  p_store_id uuid,
  p_request_id uuid,
  p_item_id uuid,
  p_qty integer,
  p_reason text,
  p_actor uuid,
  p_device_id uuid,
  p_waiter_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_qty integer;
  v_existing public.event_log%rowtype;
  v_item public.order_items%rowtype;
  v_order public.orders%rowtype;
  v_removed_cents integer;
  v_left integer;
  v_restore integer;
  v_new_qty integer;
  v_need record;
  v_cancelled boolean := false;
  v_snapshot jsonb;
begin
  -- Tocar duas vezes devolve a primeira resposta (Regra 4).
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('remove_table_item:' || p_request_id::text, 0)
  );
  select e.* into v_existing
  from public.event_log e
  where e.type = 'table.item_removed'
    and e.store_id = p_store_id
    and e.payload ->> 'request_id' = p_request_id::text
  limit 1;
  if found then
    return v_existing.payload || jsonb_build_object('duplicate', true);
  end if;

  select oi.* into v_item
  from public.order_items oi
  where oi.id = p_item_id
    and oi.store_id = p_store_id;
  if not found then
    raise exception 'order_item_not_found' using errcode = 'P0404';
  end if;

  -- O pedido fica preso até ao fim: um fecho de conta ao mesmo tempo espera,
  -- e depois vê o total novo (table_bill_changed).
  select o.* into v_order
  from public.orders o
  where o.id = v_item.order_id
    and o.store_id = p_store_id
  for update;
  if not found or v_order.table_id is null or v_order.fulfillment_type <> 'dine_in' then
    raise exception 'order_item_not_found' using errcode = 'P0404';
  end if;
  if v_order.table_bill_id is not null then
    raise exception 'table_order_already_paid' using errcode = 'P0409';
  end if;
  if v_order.status not in ('in_preparation', 'ready', 'delivered') then
    raise exception 'table_order_not_open' using errcode = 'P0409';
  end if;

  -- A linha relida depois do lock do pedido: pode ter mudado entretanto.
  select oi.* into v_item
  from public.order_items oi
  where oi.id = p_item_id
  for update;
  if not found then
    raise exception 'order_item_not_found' using errcode = 'P0404';
  end if;

  v_qty := least(coalesce(p_qty, v_item.qty), v_item.qty);
  v_removed_cents := v_qty * v_item.unit_price_cents;
  v_left := v_item.qty - v_qty;

  v_snapshot := jsonb_build_object(
    'name', v_item.name_snapshot,
    'variant', v_item.variant_name_snapshot,
    'qty', v_qty,
    'notes', v_item.notes,
    'person', v_item.person_label
  );

  -- Stock do produto: volta o que esta quantidade gastou, nunca mais do que
  -- o pedido ainda tem por devolver.
  if v_item.menu_item_id is not null then
    select least(v_qty, coalesce(sum(-sm.delta), 0))::integer into v_restore
    from public.stock_movements sm
    where sm.order_id = v_order.id
      and sm.menu_item_id = v_item.menu_item_id
      and sm.reason in ('sale', 'void');

    if v_restore > 0 then
      update public.store_items si
      set stock_qty = si.stock_qty + v_restore
      where si.store_id = p_store_id
        and si.menu_item_id = v_item.menu_item_id
      returning si.stock_qty into v_new_qty;

      if v_new_qty is not null then
        perform private.record_stock_movement(
          p_store_id, v_item.menu_item_id, v_restore, 'void', v_order.id,
          'Retirado da mesa', v_new_qty
        );
      end if;
    end if;

    -- Matéria-prima, pela ficha técnica desta linha (mesma regra de
    -- private.order_ingredient_needs).
    for v_need in
      select r.ingredient_id, sum(r.qty * v_qty)::integer as qty
      from public.recipe_items r
      left join public.menu_item_variants mv
        on mv.menu_item_id = r.menu_item_id
       and mv.name = v_item.variant_name_snapshot
      where r.menu_item_id = v_item.menu_item_id
        and (r.variant_id is null or r.variant_id = mv.id)
      group by r.ingredient_id
      order by r.ingredient_id
    loop
      select least(v_need.qty, coalesce(sum(-im.delta), 0))::integer into v_restore
      from public.ingredient_movements im
      where im.order_id = v_order.id
        and im.ingredient_id = v_need.ingredient_id
        and im.reason in ('sale', 'void');

      if v_restore > 0 then
        v_new_qty := null;
        update public.store_ingredients si
        set qty = si.qty + v_restore
        where si.store_id = p_store_id
          and si.ingredient_id = v_need.ingredient_id
        returning si.qty into v_new_qty;

        if v_new_qty is not null then
          perform private.record_ingredient_movement(
            p_store_id, v_need.ingredient_id, v_restore, 'void', v_order.id,
            'Retirado da mesa', v_new_qty
          );
        end if;
      end if;
    end loop;
  end if;

  if v_left = 0 then
    delete from public.order_items oi where oi.id = v_item.id;
  else
    update public.order_items oi
    set qty = v_left,
        cost_cents = case
          when oi.cost_cents is null then null
          else (oi.cost_cents * v_left) / v_item.qty
        end
    where oi.id = v_item.id;
  end if;

  perform set_config('app.request_store_id', p_store_id::text, true);

  update public.orders o
  set subtotal_cents = greatest(o.subtotal_cents - v_removed_cents, 0),
      total_cents = greatest(o.total_cents - v_removed_cents, 0)
  where o.id = v_order.id
  returning o.* into v_order;

  -- Pedido vazio sai da conta. Não se apaga: fica cancelado, com o registo.
  if not exists (select 1 from public.order_items oi where oi.order_id = v_order.id) then
    update public.orders o
    set status = 'cancelled'
    where o.id = v_order.id
    returning o.* into v_order;
    v_cancelled := true;
  end if;

  insert into public.event_log (order_id, store_id, actor_user_id, type, payload)
  values (
    v_order.id, p_store_id, p_actor, 'table.item_removed',
    jsonb_build_object(
      'request_id', p_request_id,
      'device_id', p_device_id,
      'waiter_id', p_waiter_id,
      'order_id', v_order.id,
      'order_item_id', v_item.id,
      'menu_item_id', v_item.menu_item_id,
      'item', v_snapshot,
      'unit_price_cents', v_item.unit_price_cents,
      'removed_cents', v_removed_cents,
      'reason', p_reason,
      'order_total_cents', v_order.total_cents,
      'order_cancelled', v_cancelled
    )
  );

  -- O papel nunca desfaz a remoção (Regra 1). Um artigo já entregue à mesa
  -- não precisa de aviso na cozinha.
  if v_order.status <> 'delivered' then
    begin
      perform private.enqueue_table_item_removed(v_order.id, v_snapshot, p_reason);
    exception when others then
      insert into public.event_log (order_id, store_id, actor_user_id, type, payload)
      values (v_order.id, p_store_id, p_actor, 'print.table_item_removed_failed',
        jsonb_build_object('error', sqlstate));
    end;
  end if;

  update public.devices set last_seen_at = now() where id = p_device_id;

  return jsonb_build_object(
    'request_id', p_request_id,
    'order_id', v_order.id,
    'order_item_id', v_item.id,
    'item', v_snapshot,
    'removed_cents', v_removed_cents,
    'order_total_cents', v_order.total_cents,
    'order_cancelled', v_cancelled,
    'duplicate', false
  );

end;
$$;

revoke all on function private.remove_table_item_core(uuid, uuid, uuid, integer, text, uuid, uuid, uuid)
  from public, anon, authenticated;

create or replace function public.remove_table_item(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_request_id uuid;
  v_device_id uuid;
  v_item_id uuid;
  v_qty integer;
  v_reason text;
  v_store public.stores%rowtype;
begin
  begin
    v_request_id := nullif(p_payload ->> 'requestId', '')::uuid;
    v_device_id := nullif(p_payload ->> 'deviceId', '')::uuid;
    v_item_id := nullif(p_payload ->> 'orderItemId', '')::uuid;
    v_qty := nullif(p_payload ->> 'qty', '')::integer;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'invalid_pos_payload' using errcode = 'P0007';
  end;
  v_reason := left(nullif(btrim(p_payload ->> 'reason'), ''), 120);

  if v_request_id is null or v_item_id is null then
    raise exception 'invalid_pos_payload' using errcode = 'P0007';
  end if;
  if v_reason is null then
    raise exception 'reason_required' using errcode = 'P0007';
  end if;
  if v_qty is not null and v_qty < 1 then
    raise exception 'invalid_qty' using errcode = 'P0007';
  end if;

  v_store := private.pos_device_store(v_device_id);

  return private.remove_table_item_core(
    v_store.id, v_request_id, v_item_id, v_qty, v_reason, v_uid, v_device_id, null
  );
end;
$$;

revoke all on function public.remove_table_item(jsonb) from public, anon;
grant execute on function public.remove_table_item(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Gestão no painel
-- ---------------------------------------------------------------------------
create or replace function public.set_waiter_can_charge(p_waiter_id uuid, p_can_charge boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store_id uuid;
begin
  select w.store_id into v_store_id from public.waiters w where w.id = p_waiter_id;
  if not found then
    raise exception 'waiter_not_found' using errcode = 'P0404';
  end if;
  perform private.assert_waiter_admin(v_store_id);

  update public.waiters set can_charge = coalesce(p_can_charge, false), updated_at = now()
  where id = p_waiter_id;

  insert into public.event_log (store_id, actor_user_id, type, payload)
  values (v_store_id, (select auth.uid()), 'waiter.can_charge_set',
    jsonb_build_object('waiter_id', p_waiter_id, 'can_charge', coalesce(p_can_charge, false)));

  return jsonb_build_object('waiter_id', p_waiter_id, 'can_charge', coalesce(p_can_charge, false));
end;
$$;

create or replace function public.set_waiter_remove_minutes(p_store_id uuid, p_minutes integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_waiter_admin(p_store_id);
  if p_minutes is null or p_minutes not between 0 and 30 then
    raise exception 'invalid_remove_minutes' using errcode = 'P0007';
  end if;

  update public.stores set waiter_remove_minutes = p_minutes where id = p_store_id;

  insert into public.event_log (store_id, actor_user_id, type, payload)
  values (p_store_id, (select auth.uid()), 'waiter.remove_minutes_set',
    jsonb_build_object('minutes', p_minutes));

  return jsonb_build_object('store_id', p_store_id, 'minutes', p_minutes);
end;
$$;

create or replace function public.get_waiter_settings(p_store_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_waiter_admin(p_store_id);
  return (select jsonb_build_object('remove_minutes', s.waiter_remove_minutes)
          from public.stores s where s.id = p_store_id);
end;
$$;

-- Igual à 1122, com `can_charge`.
create or replace function public.get_waiters(p_store_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_day_start timestamptz :=
    (date_trunc('day', now() at time zone 'Africa/Maputo')) at time zone 'Africa/Maputo';
begin
  perform private.assert_waiter_admin(p_store_id);

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', w.id,
      'full_name', w.full_name,
      'phone', w.phone,
      'active', w.active,
      'can_charge', w.can_charge,
      'last_seen_at', w.last_seen_at,
      'has_pin', exists (select 1 from public.waiter_credentials wc where wc.waiter_id = w.id),
      'orders_today', (
        select count(*) from public.orders o
        where o.waiter_id = w.id and o.created_at >= v_day_start and o.status <> 'cancelled'),
      'total_today_cents', (
        select coalesce(sum(o.total_cents), 0) from public.orders o
        where o.waiter_id = w.id and o.created_at >= v_day_start and o.status <> 'cancelled')
    ) order by w.active desc, w.full_name)
    from public.waiters w
    where w.store_id = p_store_id
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.set_waiter_can_charge(uuid, boolean) from public, anon;
revoke all on function public.set_waiter_remove_minutes(uuid, integer) from public, anon;
revoke all on function public.get_waiter_settings(uuid) from public, anon;
revoke all on function public.get_waiters(uuid) from public, anon;
grant execute on function public.set_waiter_can_charge(uuid, boolean) to authenticated;
grant execute on function public.set_waiter_remove_minutes(uuid, integer) to authenticated;
grant execute on function public.get_waiter_settings(uuid) to authenticated;
grant execute on function public.get_waiters(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. A mesa e o estado: quem lançou, autorização, definições do ecrã
-- ---------------------------------------------------------------------------
create or replace function private.table_overview_json(p_store_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(mesa order by (mesa ->> 'number')::integer), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'id', t.id,
      'number', t.number,
      'active', t.active,
      'orders', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', o.id,
            'order_number', o.order_number,
            'daily_number', o.daily_number,
            'status', o.status,
            'origin', case when o.client_sale_id is null then 'qr' else 'pos' end,
            'waiter_id', o.waiter_id,
            'waiter_name', w.full_name,
            'customer_name', o.customer_name,
            'created_at', o.created_at,
            'total_cents', o.total_cents,
            'notes', o.notes,
            'items', (
              select coalesce(jsonb_agg(
                jsonb_build_object(
                  'id', oi.id,
                  'name', oi.name_snapshot,
                  'variant', oi.variant_name_snapshot,
                  'qty', oi.qty,
                  'unit_price_cents', oi.unit_price_cents,
                  'notes', oi.notes,
                  'person', oi.person_label,
                  'addons', case when jsonb_typeof(oi.addons) = 'array' then oi.addons else '[]'::jsonb end
                ) order by oi.person_label nulls first, oi.id
              ), '[]'::jsonb)
              from public.order_items oi
              where oi.order_id = o.id
            )
          ) order by o.created_at, o.id
        )
        from private.table_tab_order_ids(p_store_id, t.id) tab(id)
        join public.orders o on o.id = tab.id
        left join public.waiters w on w.id = o.waiter_id
      ), '[]'::jsonb)
    ) as mesa
    from public.tables t
    where t.store_id = p_store_id
  ) mesas
  where (mesa ->> 'active')::boolean
    or jsonb_array_length(mesa -> 'orders') > 0;
$$;

revoke all on function private.table_overview_json(uuid) from public, anon, authenticated;

create or replace function public.waiter_state(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_waiter public.waiters%rowtype := private.waiter_from_token(p_token);
  v_store public.stores%rowtype;
  v_day_start timestamptz :=
    (date_trunc('day', now() at time zone 'Africa/Maputo')) at time zone 'Africa/Maputo';
begin
  select s.* into v_store from public.stores s where s.id = v_waiter.store_id;

  return jsonb_build_object(
    'waiter', jsonb_build_object('id', v_waiter.id, 'full_name', v_waiter.full_name,
      'can_charge', v_waiter.can_charge),
    'store', jsonb_build_object(
      'name', v_store.name,
      'short_name', v_store.short_name,
      'open', v_store.active and v_store.counter_enabled,
      'remove_minutes', v_store.waiter_remove_minutes),
    -- Só o que o ecrã do garçom usa: meios de pagamento e notas rápidas da loja.
    'pos_config', (
      select jsonb_strip_nulls(jsonb_build_object(
        'payments', c.config -> 'payments', 'quickNotes', c.config -> 'quickNotes'))
      from public.store_pos_settings c where c.store_id = v_store.id),
    'tables', private.table_overview_json(v_store.id),
    'today', (
      select jsonb_build_object('orders', count(*))
      from public.orders o
      where o.waiter_id = v_waiter.id and o.created_at >= v_day_start and o.status <> 'cancelled')
  );
end;
$$;

-- O cardápio, mais o que está marcado como esgotado — para o poder desmarcar.
create or replace function public.waiter_menu(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_waiter public.waiters%rowtype := private.waiter_from_token(p_token);
  v_slug text;
begin
  select s.slug into v_slug from public.stores s where s.id = v_waiter.store_id;
  return public.get_menu(v_slug, null, false) || jsonb_build_object(
    'unavailable', coalesce((
      select jsonb_agg(jsonb_build_object('id', mi.id, 'name', mi.name) order by mi.name)
      from public.store_items si
      join public.menu_items mi on mi.id = si.menu_item_id
      where si.store_id = v_waiter.store_id and not si.available
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. O telemóvel: retirar e cobrar
-- ---------------------------------------------------------------------------
create or replace function public.waiter_remove_item(p_token text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_waiter public.waiters%rowtype := private.waiter_from_token(p_token);
  v_request_id uuid;
  v_item_id uuid;
  v_qty integer;
  v_reason text;
  v_existing public.event_log%rowtype;
  v_order public.orders%rowtype;
  v_minutes integer;
begin
  begin
    v_request_id := nullif(p_payload ->> 'requestId', '')::uuid;
    v_item_id := nullif(p_payload ->> 'orderItemId', '')::uuid;
    v_qty := nullif(p_payload ->> 'qty', '')::integer;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'invalid_waiter_payload' using errcode = 'P0007';
  end;
  v_reason := left(nullif(btrim(p_payload ->> 'reason'), ''), 120);
  if v_request_id is null or v_item_id is null then
    raise exception 'invalid_waiter_payload' using errcode = 'P0007';
  end if;
  if v_reason is null then
    raise exception 'reason_required' using errcode = 'P0007';
  end if;
  if v_qty is not null and v_qty < 1 then
    raise exception 'invalid_qty' using errcode = 'P0007';
  end if;

  -- Repetir responde o mesmo, mesmo que o limite já tenha passado (Regra 4).
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('remove_table_item:' || v_request_id::text, 0)
  );
  select e.* into v_existing
  from public.event_log e
  where e.type = 'table.item_removed'
    and e.store_id = v_waiter.store_id
    and e.payload ->> 'request_id' = v_request_id::text
  limit 1;
  if found then
    return v_existing.payload || jsonb_build_object('duplicate', true);
  end if;

  select o.* into v_order
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  where oi.id = v_item_id
    and oi.store_id = v_waiter.store_id
  for update of o;
  if not found then
    raise exception 'order_item_not_found' using errcode = 'P0404';
  end if;
  if v_order.waiter_id is distinct from v_waiter.id then
    raise exception 'waiter_order_not_yours' using errcode = 'P0403';
  end if;

  select s.waiter_remove_minutes into v_minutes from public.stores s where s.id = v_waiter.store_id;
  if v_order.status <> 'in_preparation'
     or v_minutes = 0
     or now() - v_order.created_at > make_interval(mins => v_minutes) then
    raise exception 'waiter_remove_window_over' using errcode = 'P0409';
  end if;

  return private.remove_table_item_core(
    v_waiter.store_id, v_request_id, v_item_id, v_qty, v_reason, null, null, v_waiter.id
  );
end;
$$;

create or replace function public.waiter_close_bill(p_token text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_waiter public.waiters%rowtype := private.waiter_from_token(p_token);
  v_store public.stores%rowtype;
  v_client_close_id uuid;
  v_table_id uuid;
  v_expected integer;
  v_existing public.table_bills%rowtype;
begin
  begin
    v_client_close_id := nullif(p_payload ->> 'clientCloseId', '')::uuid;
    v_table_id := nullif(p_payload ->> 'tableId', '')::uuid;
    v_expected := (p_payload ->> 'expectedTotalCents')::integer;
  exception when invalid_text_representation then
    raise exception 'invalid_waiter_payload' using errcode = 'P0007';
  end;
  if v_client_close_id is null then
    raise exception 'client_close_id_required' using errcode = 'P0007';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('table_bill:' || v_client_close_id::text, 0)
  );
  select b.* into v_existing
  from public.table_bills b
  where b.client_close_id = v_client_close_id;
  if found then
    if v_existing.waiter_id is distinct from v_waiter.id then
      raise exception 'client_close_id_store_conflict' using errcode = 'P0409';
    end if;
    return jsonb_build_object(
      'bill_id', v_existing.id,
      'table_number', v_existing.table_number,
      'total_cents', v_existing.total_cents,
      'cash_received_cents', v_existing.cash_received_cents,
      'change_cents', v_existing.change_cents,
      'order_count', coalesce(array_length(v_existing.order_ids, 1), 0),
      'duplicate', true
    );
  end if;

  if not v_waiter.can_charge then
    raise exception 'waiter_charge_denied' using errcode = 'P0403';
  end if;
  if jsonb_typeof(p_payload -> 'payments') = 'array' and exists (
    select 1 from jsonb_array_elements(p_payload -> 'payments') p where p.value ->> 'method' = 'cash'
  ) then
    raise exception 'waiter_cash_not_allowed' using errcode = 'P0403';
  end if;

  v_store := private.waiter_store(v_waiter);

  return private.close_table_bill_core(
    v_store, v_table_id, v_client_close_id, v_expected,
    -- Sem notas: nada de dinheiro recebido a entrar por aqui.
    p_payload - 'cashReceivedCents',
    null, null, v_waiter.id
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. O telemóvel: mudar de mesa e papel
-- ---------------------------------------------------------------------------
create or replace function public.waiter_move_table(p_token text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_waiter public.waiters%rowtype := private.waiter_from_token(p_token);
  v_request_id uuid;
  v_from public.tables%rowtype;
  v_to public.tables%rowtype;
  v_from_id uuid;
  v_to_id uuid;
  v_existing public.event_log%rowtype;
  v_ids uuid[];
  v_dest_name text;
  v_order record;
  v_nome text;
  v_seq integer;
  v_result jsonb;
begin
  begin
    v_request_id := nullif(p_payload ->> 'requestId', '')::uuid;
    v_from_id := nullif(p_payload ->> 'fromTableId', '')::uuid;
    v_to_id := nullif(p_payload ->> 'toTableId', '')::uuid;
  exception when invalid_text_representation then
    raise exception 'invalid_waiter_payload' using errcode = 'P0007';
  end;
  if v_request_id is null then
    raise exception 'invalid_waiter_payload' using errcode = 'P0007';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('table_move:' || v_request_id::text, 0)
  );
  select e.* into v_existing
  from public.event_log e
  where e.type = 'table.orders_moved'
    and e.store_id = v_waiter.store_id
    and e.payload ->> 'request_id' = v_request_id::text
  limit 1;
  if found then
    return v_existing.payload || jsonb_build_object('duplicate', true);
  end if;

  -- Regra 3: as duas mesas são da loja dele. A de destino tem de estar activa.
  select t.* into v_from from public.tables t where t.id = v_from_id and t.store_id = v_waiter.store_id;
  if not found then
    raise exception 'invalid_table' using errcode = 'P0060';
  end if;
  select t.* into v_to from public.tables t
  where t.id = v_to_id and t.store_id = v_waiter.store_id and t.active;
  if not found or v_to.id = v_from.id then
    raise exception 'invalid_table' using errcode = 'P0060';
  end if;

  -- O mesmo lock do fecho de conta, por ordem fixa: não há conta a fechar-se a meio.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('table_tab:' || x::text, 0))
  from unnest(array[least(v_from.id, v_to.id), greatest(v_from.id, v_to.id)]) x;

  select array_agg(t.id) into v_ids
  from private.table_tab_order_ids(v_waiter.store_id, v_from.id) t(id);
  if v_ids is null then
    raise exception 'table_has_no_open_orders' using errcode = 'P0409';
  end if;

  perform 1 from public.orders o where o.id = any(v_ids) for update;
  v_dest_name := private.table_tab_name(v_waiter.store_id, v_to.id);

  for v_order in
    select o.id, o.status,
      nullif(btrim(regexp_replace(o.customer_name, '^mesa\s+\d+\s*(·\s*)?', '', 'i')), '') as nome
    from public.orders o where o.id = any(v_ids)
  loop
    v_nome := coalesce(v_order.nome, v_dest_name);
    update public.orders
    set table_id = v_to.id,
        customer_name = 'Mesa ' || v_to.number || coalesce(' · ' || v_nome, ''),
        updated_at = now()
    where id = v_order.id;

    -- A cozinha tem o papel com a mesa antiga. Best-effort (Regra 1).
    if v_order.status in ('in_preparation', 'ready') then
      begin
        select coalesce(max(pj.reprint_seq), -1) + 1 into v_seq
        from public.print_jobs pj
        where pj.order_id = v_order.id and pj.station = 'kitchen' and pj.kind = 'order';
        insert into public.print_jobs (store_id, order_id, station, kind, reprint_seq, payload)
        values (
          v_waiter.store_id, v_order.id, 'kitchen', 'order', v_seq,
          private.build_table_comanda(v_order.id) || jsonb_build_object(
            'customer_name', '*** MUDOU DE MESA ***',
            'via', null, 'station', 'kitchen',
            'notes', 'Era a mesa ' || v_from.number || ' · Garçom: ' || v_waiter.full_name)
        )
        on conflict (order_id, station, kind, reprint_seq) do nothing;
      exception when others then
        insert into public.event_log (order_id, store_id, type, payload)
        values (v_order.id, v_waiter.store_id, 'print.table_move_failed', jsonb_build_object('error', sqlstate));
      end;
    end if;
  end loop;

  v_result := jsonb_build_object(
    'request_id', v_request_id,
    'waiter_id', v_waiter.id,
    'from_table_id', v_from.id,
    'from_table_number', v_from.number,
    'to_table_id', v_to.id,
    'to_table_number', v_to.number,
    'order_ids', to_jsonb(v_ids),
    'moved_orders', array_length(v_ids, 1)
  );
  insert into public.event_log (store_id, type, payload)
  values (v_waiter.store_id, 'table.orders_moved', v_result);

  return v_result || jsonb_build_object('duplicate', false);
end;
$$;

-- "A mesa pediu a conta": papel no balcão, com os artigos e o total. Não fecha nada.
create or replace function public.waiter_request_bill(p_token text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_waiter public.waiters%rowtype := private.waiter_from_token(p_token);
  v_request_id uuid;
  v_table_id uuid;
  v_table public.tables%rowtype;
  v_ids uuid[];
  v_total integer;
  v_name text;
  v_items jsonb;
  v_job_id uuid;
begin
  begin
    v_request_id := nullif(p_payload ->> 'requestId', '')::uuid;
    v_table_id := nullif(p_payload ->> 'tableId', '')::uuid;
  exception when invalid_text_representation then
    raise exception 'invalid_waiter_payload' using errcode = 'P0007';
  end;
  if v_request_id is null then
    raise exception 'invalid_waiter_payload' using errcode = 'P0007';
  end if;

  if exists (
    select 1 from public.print_jobs pj
    where pj.store_id = v_waiter.store_id and pj.request_id = v_request_id
  ) then
    return jsonb_build_object('request_id', v_request_id, 'duplicate', true);
  end if;

  select t.* into v_table from public.tables t where t.id = v_table_id and t.store_id = v_waiter.store_id;
  if not found then
    raise exception 'invalid_table' using errcode = 'P0060';
  end if;

  select array_agg(t.id), sum(o.total_cents)::integer into v_ids, v_total
  from private.table_tab_order_ids(v_waiter.store_id, v_table.id) t(id)
  join public.orders o on o.id = t.id;
  if v_ids is null then
    raise exception 'table_has_no_open_orders' using errcode = 'P0409';
  end if;
  v_name := private.table_tab_name(v_waiter.store_id, v_table.id);

  select coalesce(jsonb_agg(jsonb_build_object(
    'name', oi.name_snapshot,
    'quantity', oi.qty,
    'variant', oi.variant_name_snapshot,
    'notes', oi.notes,
    'person', oi.person_label,
    'modifiers', '[]'::jsonb
  ) order by oi.id), '[]'::jsonb) into v_items
  from public.order_items oi where oi.order_id = any(v_ids);

  insert into public.print_jobs (store_id, order_id, station, kind, reprint_seq, request_id, payload)
  values (
    v_waiter.store_id, null, 'counter', 'order', 0, v_request_id,
    jsonb_build_object(
      'order_number', 'CONTA MESA ' || v_table.number,
      'daily_number', v_table.number,
      'customer_name', '*** PEDE A CONTA ***',
      'fulfillment_type', 'dine_in',
      'table_number', v_table.number,
      'items', v_items,
      'payment_method', 'no_payment',
      'total_cents', v_total,
      'notes', concat_ws(' · ',
        'Total: ' || to_char(v_total / 100.0, 'FM9999999990.00') || ' MT',
        v_name,
        'Garçom: ' || v_waiter.full_name),
      'created_at', now()
    )
  )
  on conflict (store_id, request_id, station, kind) where request_id is not null do nothing
  returning id into v_job_id;

  insert into public.event_log (store_id, type, payload)
  values (v_waiter.store_id, 'table.bill_requested', jsonb_build_object(
    'request_id', v_request_id, 'waiter_id', v_waiter.id, 'table_number', v_table.number,
    'total_cents', v_total, 'job_id', v_job_id));

  return jsonb_build_object('request_id', v_request_id, 'table_number', v_table.number,
    'total_cents', v_total, 'duplicate', false);
end;
$$;

-- Reimprimir fica no registo e marcado no papel, para não virar comida a mais.
create or replace function public.waiter_reprint_order(p_token text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_waiter public.waiters%rowtype := private.waiter_from_token(p_token);
  v_request_id uuid;
  v_order_id uuid;
  v_order public.orders%rowtype;
  v_comanda jsonb;
  v_seq integer;
begin
  begin
    v_request_id := nullif(p_payload ->> 'requestId', '')::uuid;
    v_order_id := nullif(p_payload ->> 'orderId', '')::uuid;
  exception when invalid_text_representation then
    raise exception 'invalid_waiter_payload' using errcode = 'P0007';
  end;
  if v_request_id is null then
    raise exception 'invalid_waiter_payload' using errcode = 'P0007';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('table_reprint:' || v_request_id::text, 0)
  );

  select o.* into v_order from public.orders o where o.id = v_order_id;
  if not found
     or v_order.store_id <> v_waiter.store_id
     or v_order.table_id is null then
    raise exception 'order_not_found' using errcode = 'P0404';
  end if;
  if v_order.status = 'cancelled' then
    raise exception 'order_cancelled' using errcode = 'P0409';
  end if;

  if exists (
    select 1 from public.event_log e
    where e.order_id = v_order.id and e.type = 'table.comanda_reprinted'
      and e.payload ->> 'request_id' = v_request_id::text
  ) then
    return jsonb_build_object('order_id', v_order.id, 'duplicate', true);
  end if;

  v_comanda := private.build_table_comanda(v_order.id);
  select coalesce(max(pj.reprint_seq), -1) + 1 into v_seq
  from public.print_jobs pj
  where pj.order_id = v_order.id and pj.station = 'kitchen' and pj.kind = 'order';

  insert into public.print_jobs (store_id, order_id, station, kind, reprint_seq, payload)
  values (
    v_waiter.store_id, v_order.id, 'kitchen', 'order', v_seq,
    v_comanda || jsonb_build_object(
      'via', null, 'station', 'kitchen',
      'notes', concat_ws(' · ', 'REIMPRESSÃO', v_comanda ->> 'notes'))
  );

  insert into public.event_log (order_id, store_id, type, payload)
  values (v_order.id, v_waiter.store_id, 'table.comanda_reprinted',
    jsonb_build_object('request_id', v_request_id, 'waiter_id', v_waiter.id));

  return jsonb_build_object('order_id', v_order.id, 'duplicate', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Esgotado
-- ---------------------------------------------------------------------------
-- As mesmas regras de `set_item_availability` (1061), na loja dele e assinado por ele.
create or replace function public.waiter_set_availability(
  p_token text,
  p_menu_item_id uuid,
  p_available boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_waiter public.waiters%rowtype := private.waiter_from_token(p_token);
  v_antes boolean;
begin
  if p_available is null then
    raise exception 'available_required' using errcode = 'P0007';
  end if;

  select si.available into v_antes
  from public.store_items si
  where si.store_id = v_waiter.store_id and si.menu_item_id = p_menu_item_id
  for update;
  if not found then
    raise exception 'store_item_not_found' using errcode = 'P0404';
  end if;

  if v_antes is distinct from p_available then
    update public.store_items si set available = p_available
    where si.store_id = v_waiter.store_id and si.menu_item_id = p_menu_item_id;

    insert into public.event_log (store_id, type, payload)
    values (v_waiter.store_id, 'stock.availability_changed', jsonb_build_object(
      'menu_item_id', p_menu_item_id, 'available', p_available, 'reason', null,
      'role', 'waiter', 'waiter_id', v_waiter.id));
  end if;

  return jsonb_build_object('menu_item_id', p_menu_item_id, 'available', p_available,
    'changed', v_antes is distinct from p_available);
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. O histórico: uma só leitura, para o telemóvel e para o painel
-- ---------------------------------------------------------------------------
create or replace function private.waiter_orders_page(
  p_waiter_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_limit integer,
  p_offset integer
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'total', (
      select count(*) from public.orders o
      where o.waiter_id = p_waiter_id and o.created_at >= p_from and o.created_at < p_to),
    'orders', coalesce((
      select jsonb_agg(linha.j order by linha.created_at desc, linha.id desc)
      from (
        select o.created_at, o.id, jsonb_build_object(
          'id', o.id,
          'order_number', o.order_number,
          'daily_number', o.daily_number,
          'table_number', t.number,
          'status', o.status,
          'customer_name', o.customer_name,
          'total_cents', o.total_cents,
          'created_at', o.created_at,
          'notes', o.notes,
          'paid', o.table_bill_id is not null,
          'charged_by_waiter', cobrador.full_name,
          'payments', b.payments,
          'items', coalesce((
            select jsonb_agg(jsonb_build_object(
              'name', oi.name_snapshot,
              'variant', oi.variant_name_snapshot,
              'qty', oi.qty,
              'unit_price_cents', oi.unit_price_cents,
              'notes', oi.notes,
              'addons', case when jsonb_typeof(oi.addons) = 'array' then oi.addons else '[]'::jsonb end
            ) order by oi.id)
            from public.order_items oi where oi.order_id = o.id
          ), '[]'::jsonb),
          'removed', coalesce((
            select jsonb_agg(jsonb_build_object(
              'name', ev.payload #>> '{item,name}',
              'variant', ev.payload #>> '{item,variant}',
              'qty', (ev.payload #>> '{item,qty}')::integer,
              'removed_cents', (ev.payload ->> 'removed_cents')::integer,
              'reason', ev.payload ->> 'reason',
              'by_waiter', ev.payload ->> 'waiter_id' is not null,
              'created_at', ev.created_at
            ) order by ev.created_at)
            from public.event_log ev
            where ev.order_id = o.id and ev.type = 'table.item_removed'
          ), '[]'::jsonb)
        ) as j
        from public.orders o
        left join public.tables t on t.id = o.table_id
        left join public.table_bills b on b.id = o.table_bill_id
        left join public.waiters cobrador on cobrador.id = b.waiter_id
        where o.waiter_id = p_waiter_id and o.created_at >= p_from and o.created_at < p_to
        order by o.created_at desc, o.id desc
        limit greatest(least(coalesce(p_limit, 50), 100), 1)
        offset greatest(coalesce(p_offset, 0), 0)
      ) linha
    ), '[]'::jsonb)
  );
$$;

revoke all on function private.waiter_orders_page(uuid, timestamptz, timestamptz, integer, integer)
  from public, anon, authenticated;

create or replace function public.waiter_history(p_token text, p_days integer default 1)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_waiter public.waiters%rowtype := private.waiter_from_token(p_token);
  v_days integer := greatest(least(coalesce(p_days, 1), 30), 1);
  v_from timestamptz :=
    (date_trunc('day', now() at time zone 'Africa/Maputo') - make_interval(days => v_days - 1))
    at time zone 'Africa/Maputo';
  v_to timestamptz := now() + interval '1 minute';
begin
  return private.waiter_orders_page(v_waiter.id, v_from, v_to, 100, 0) || jsonb_build_object(
    'days', v_days,
    'summary', (
      select jsonb_build_object(
        'orders', count(*),
        'revenue_cents', coalesce(sum(o.total_cents), 0),
        'avg_ticket_cents', case when count(*) > 0 then round(sum(o.total_cents)::numeric / count(*))::bigint else 0 end,
        'tables', count(distinct (o.table_id, (o.created_at at time zone 'Africa/Maputo')::date))
      )
      from public.orders o
      where o.waiter_id = v_waiter.id and o.created_at >= v_from and o.created_at < v_to
        and o.status in ('in_preparation', 'ready', 'delivered'))
  );
end;
$$;

-- No painel: gerente da loja e dono. Todas as lojas só o dono, como as métricas.
create or replace function public.get_waiter_orders(
  p_store_id uuid,
  p_waiter_id uuid,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_store_id is null then
    if (select auth.uid()) is null then
      raise exception 'not_authenticated' using errcode = 'P0020';
    end if;
    if not coalesce(private.auth_is_owner(), false) then
      raise exception 'waiter_access_denied' using errcode = 'P0403';
    end if;
  else
    perform private.assert_waiter_admin(p_store_id);
    -- Regra 3: um garçom de outra loja não abre nada.
    if not exists (select 1 from public.waiters w where w.id = p_waiter_id and w.store_id = p_store_id) then
      return jsonb_build_object('total', 0, 'orders', '[]'::jsonb);
    end if;
  end if;

  return private.waiter_orders_page(
    p_waiter_id,
    coalesce(p_from, '-infinity'::timestamptz),
    coalesce(p_to, 'infinity'::timestamptz),
    p_limit,
    p_offset
  );
end;
$$;

revoke all on function public.get_waiter_orders(uuid, uuid, timestamptz, timestamptz, integer, integer) from public, anon;
grant execute on function public.get_waiter_orders(uuid, uuid, timestamptz, timestamptz, integer, integer) to authenticated;

revoke all on function public.waiter_state(text) from public, anon, authenticated;
revoke all on function public.waiter_menu(text) from public, anon, authenticated;
revoke all on function public.waiter_remove_item(text, jsonb) from public, anon, authenticated;
revoke all on function public.waiter_close_bill(text, jsonb) from public, anon, authenticated;
revoke all on function public.waiter_move_table(text, jsonb) from public, anon, authenticated;
revoke all on function public.waiter_request_bill(text, jsonb) from public, anon, authenticated;
revoke all on function public.waiter_reprint_order(text, jsonb) from public, anon, authenticated;
revoke all on function public.waiter_set_availability(text, uuid, boolean) from public, anon, authenticated;
revoke all on function public.waiter_history(text, integer) from public, anon, authenticated;
grant execute on function public.waiter_state(text) to service_role;
grant execute on function public.waiter_menu(text) to service_role;
grant execute on function public.waiter_remove_item(text, jsonb) to service_role;
grant execute on function public.waiter_close_bill(text, jsonb) to service_role;
grant execute on function public.waiter_move_table(text, jsonb) to service_role;
grant execute on function public.waiter_request_bill(text, jsonb) to service_role;
grant execute on function public.waiter_reprint_order(text, jsonb) to service_role;
grant execute on function public.waiter_set_availability(text, uuid, boolean) to service_role;
grant execute on function public.waiter_history(text, integer) to service_role;

notify pgrst, 'reload schema';
