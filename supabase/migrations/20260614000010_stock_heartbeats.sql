-- ============================================================================
-- DELIVERY OS — F2.3: Atomic stock deduction + device heartbeats
-- 
-- Features:
-- 1. Atomic stock deduction in confirm_payment (digital) and advance_order APPROVE (manual)
-- 2. Trigger: stock_qty=0 → available=false
-- 3. Manual stock adjustment logging in event_log
-- 4. device_heartbeats table for print-bridge/admin online status
-- 5. RPCs: adjust_stock, upsert_heartbeat, get_device_status
--
-- Ref: CLAUDE.md secções 8, 9, 14.4
-- ============================================================================

-- ============================================================================
-- Tabela: device_heartbeats
-- Regista heartbeat de print-bridge e admin dashboard (60s)
-- ============================================================================
create table if not exists device_heartbeats (
  id          text    primary key,  -- 'printer', 'admin', etc.
  kind        text    not null check (kind in ('printer', 'admin')),
  last_seen_at timestamptz not null default now()
);

alter table device_heartbeats enable row level security;
create policy "staff_all" on device_heartbeats
  for all to authenticated using (true) with check (true);

-- ============================================================================
-- Trigger: stock_qty=0 → available=false
-- Quando o stock chega a zero, marca o item como unavailable automaticamente
-- ============================================================================
create or replace function trigger_set_available_on_stock()
returns trigger
language plpgsql
as $$
begin
  if new.stock_qty = 0 then
    new.available := false;
  elsif new.stock_qty > 0 and not new.available then
    -- DECISÃO: Não reactiva automaticamente quando stock > 0
    -- O staff deve decidir quando tornar o item available novamente
    new.available := false;
  end if;
  return new;
end;
$$;

drop trigger if exists set_available_on_stock on menu_items;
create trigger set_available_on_stock
  before update of stock_qty on menu_items
  for each row execute function trigger_set_available_on_stock();

-- ============================================================================
-- RPC: adjust_stock(p_menu_item_id, p_new_qty, p_reason, p_adjusted_by)
-- Ajuste manual de stock com logging em event_log
-- Só staff autenticado pode chamar
-- ============================================================================
create or replace function public.adjust_stock(
  p_menu_item_id uuid,
  p_new_qty      int,
  p_reason       text,
  p_adjusted_by  text default 'system'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item     record;
  v_old_qty  int;
  v_diff     int;
begin
  -- Validar p_new_qty
  if p_new_qty < 0 then
    raise exception 'invalid_stock_qty: cannot be negative' using errcode = 'P0100';
  end if;

  -- Validar p_reason
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'adjust_reason_required' using errcode = 'P0101';
  end if;

  -- Lock e ler item actual
  select mi.id, mi.name, mi.stock_qty, mi.track_stock, mi.available
  into v_item
  from menu_items mi
  where mi.id = p_menu_item_id
  for update;

  if not found then
    raise exception 'menu_item_not_found' using errcode = 'P0102';
  end if;

  if not v_item.track_stock then
    raise exception 'stock_not_tracked: item does not track stock' using errcode = 'P0103';
  end if;

  -- Calcular diferença
  v_old_qty := v_item.stock_qty;
  v_diff    := p_new_qty - v_old_qty;

  -- Actualizar stock
  update menu_items
  set stock_qty = p_new_qty,
      updated_at = now()
  where id = p_menu_item_id;

  -- Log em event_log (sem order_id, é evento de menu)
  insert into event_log (order_id, type, payload)
  values (
    null,
    'stock.adjusted',
    jsonb_build_object(
      'menu_item_id', p_menu_item_id,
      'menu_item_name', v_item.name,
      'old_qty', v_old_qty,
      'new_qty', p_new_qty,
      'diff', v_diff,
      'reason', p_reason,
      'adjusted_by', p_adjusted_by
    )
  );

  return jsonb_build_object(
    'success', true,
    'menu_item_id', p_menu_item_id,
    'menu_item_name', v_item.name,
    'old_qty', v_old_qty,
    'new_qty', p_new_qty,
    'diff', v_diff
  );
end;
$$;

grant execute on function public.adjust_stock(uuid, int, text, text) to authenticated;

-- ============================================================================
-- RPC: upsert_heartbeat(p_device_id, p_kind)
-- Regista heartbeat (chamado pelo print-bridge a cada 60s)
-- ============================================================================
create or replace function public.upsert_heartbeat(p_device_id text, p_kind text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Validar kind
  if p_kind not in ('printer', 'admin') then
    raise exception 'invalid_device_kind: must be printer or admin' using errcode = 'P0104';
  end if;

  insert into device_heartbeats (id, kind, last_seen_at)
  values (p_device_id, p_kind, now())
  on conflict (id) do update set
    last_seen_at = now(),
    kind = excluded.kind;

  return jsonb_build_object(
    'success', true,
    'device_id', p_device_id,
    'kind', p_kind,
    'last_seen_at', now()
  );
end;
$$;

grant execute on function public.upsert_heartbeat(text, text) to authenticated;

-- ============================================================================
-- RPC: get_device_status()
-- Retorna status online/offline de todos os dispositivos (threshold: 60s)
-- ============================================================================
create or replace function public.get_device_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_threshold timestamptz := now() - interval '60 seconds';
begin
  return jsonb_build_object(
    'devices', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', dh.id,
            'kind', dh.kind,
            'last_seen_at', dh.last_seen_at,
            'online', dh.last_seen_at >= v_threshold
          )
        ),
        '[]'::jsonb
      )
      from device_heartbeats dh
    ),
    'threshold_seconds', 60
  );
end;
$$;

grant execute on function public.get_device_status() to authenticated;

-- ============================================================================
-- ATUALIZA confirm_payment: dedução atómica de stock
-- Segue padrão CLAUDE.md 14.4 dentro da mesma transação
-- ============================================================================
create or replace function public.confirm_payment(
  p_idempotency_key text,
  p_order_id        uuid,
  p_provider        text,
  p_provider_ref    text,
  p_method          text,
  p_amount_cents    int,
  p_raw_webhook     jsonb default '{}'::jsonb
) returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_inserted   int;
  v_payment_id uuid;
  v_order      record;
  v_item_el    record;
  v_updated    int;
begin
  -- 1. Inserir registo de pagamento (ON CONFLICT = duplicado → retorna 'duplicate')
  insert into payments (
    order_id, provider, provider_ref, method,
    amount_cents, idempotency_key, raw_webhook
  ) values (
    p_order_id, p_provider, p_provider_ref, p_method,
    p_amount_cents, p_idempotency_key, p_raw_webhook
  ) on conflict (idempotency_key) do nothing;

  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    return 'duplicate';
  end if;

  select id into v_payment_id
  from payments
  where idempotency_key = p_idempotency_key;

  -- 2. Lock + leitura do pedido
  select o.id, o.status, o.total_cents, o.order_number
  into   v_order
  from   orders o
  where  o.id = p_order_id
  for    update;

  if not found then
    insert into event_log (order_id, type, payload) values (
      p_order_id, 'payment.order_not_found',
      jsonb_build_object('idempotency_key', p_idempotency_key)
    );
    return 'order_not_found';
  end if;

  -- 3. Verificação de montante (CLAUDE.md 6.4)
  if p_amount_cents != v_order.total_cents then
    insert into event_log (order_id, type, payload) values (
      p_order_id, 'payment.amount_mismatch',
      jsonb_build_object(
        'expected', v_order.total_cents,
        'received', p_amount_cents,
        'idempotency_key', p_idempotency_key
      )
    );
    return 'amount_mismatch';
  end if;

  -- 4. DEDUÇÃO ATÓMICA DE ESTOQUE — CLAUDE.md 14.4
  -- Para cada item do pedido, deduzir stock se track_stock=true
  -- Se algum item não tiver stock suficiente → rollback total
  for v_item_el in
    select oi.menu_item_id, oi.qty
    from order_items oi
    where oi.order_id = p_order_id
  loop
    -- Só deduz stock se track_stock=true
    update menu_items
    set stock_qty = stock_qty - v_item_el.qty
    where id = v_item_el.menu_item_id
      and track_stock = true
      and stock_qty >= v_item_el.qty;

    get diagnostics v_updated = row_count;
    if v_updated = 0 then
      -- Falha de stock: ou não track_stock, ou insuficiente
      -- Verificar se track_stock está activo
      select track_stock into v_updated
      from menu_items
      where id = v_item_el.menu_item_id;

      if v_updated = 1 then
        -- track_stock=true mas stock insuficiente → rollback
        insert into event_log (order_id, type, payload) values (
          p_order_id, 'payment.stock_insufficient',
          jsonb_build_object(
            'menu_item_id', v_item_el.menu_item_id,
            'requested_qty', v_item_el.qty,
            'idempotency_key', p_idempotency_key
          )
        );
        raise exception 'out_of_stock:%.', v_item_el.menu_item_id using errcode = 'P0105';
      end if;
    end if;
  end loop;

  -- 5. Marcar pagamento como confirmado
  update payments set status = 'confirmed' where id = v_payment_id;

  -- 6. Verificar estado do pedido (CLAUDE.md 6.4)
  if v_order.status not in ('awaiting_payment', 'payment_failed') then
    insert into event_log (order_id, type, payload) values (
      p_order_id, 'payment.confirmed_on_invalid_state',
      jsonb_build_object(
        'status', v_order.status,
        'idempotency_key', p_idempotency_key
      )
    );
    return 'invalid_state';
  end if;

  -- 7. Transicionar pedido para 'paid' + print_job + event
  update orders
  set    status = 'paid', updated_at = now()
  where  id = p_order_id;

  insert into print_jobs (order_id, station, payload)
  values (
    p_order_id, 'kitchen',
    jsonb_build_object(
      'order_number', v_order.order_number,
      'trigger',      'payment.confirmed'
    )
  );

  insert into event_log (order_id, type, payload)
  values (
    p_order_id, 'payment.confirmed',
    jsonb_build_object(
      'provider',     p_provider,
      'method',       p_method,
      'amount_cents', p_amount_cents
    )
  );

  return 'ok';
end;
$$;

-- ============================================================================
-- ATUALIZA advance_order: dedução atómica de stock no APPROVE (manual flow)
-- ============================================================================
create or replace function public.advance_order(
  p_order_id uuid,
  p_event    text,
  p_reason   text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order     record;
  v_new_status text;
  v_message    text;
  v_item_el    record;
  v_updated    int;
begin
  select o.id, o.status, o.flow, o.payment_proof_path, o.customer_name, o.customer_phone
  into v_order
  from orders o
  where o.id = p_order_id;

  if not found then
    raise exception 'order_not_found' using errcode = 'P0001';
  end if;

  if p_event = 'APPROVE' then
    if v_order.status != 'awaiting_approval' then
      raise exception 'invalid_transition: cannot approve from status %', v_order.status;
    end if;
    v_new_status := 'approved';
    v_message    := 'Pagamento confirmado pelo dono';

    -- DEDUÇÃO ATÓMICA DE ESTOQUE no APPROVE — CLAUDE.md 14.4
    -- Só para itens com track_stock=true
    for v_item_el in
      select oi.menu_item_id, oi.qty
      from order_items oi
      where oi.order_id = p_order_id
    loop
      update menu_items
      set stock_qty = stock_qty - v_item_el.qty
      where id = v_item_el.menu_item_id
        and track_stock = true
        and stock_qty >= v_item_el.qty;

      get diagnostics v_updated = row_count;
      if v_updated = 0 then
        -- Verificar se track_stock está activo
        select track_stock into v_updated
        from menu_items
        where id = v_item_el.menu_item_id;

        if v_updated = 1 then
          -- track_stock=true mas stock insuficiente → rollback
          insert into event_log (order_id, type, payload) values (
            p_order_id, 'order.approve_stock_insufficient',
            jsonb_build_object(
              'menu_item_id', v_item_el.menu_item_id,
              'requested_qty', v_item_el.qty
            )
          );
          raise exception 'out_of_stock:%.', v_item_el.menu_item_id using errcode = 'P0105';
        end if;
      end if;
    end loop;

  elsif p_event = 'START_PREPARATION' then
    if v_order.status not in ('approved', 'paid') then
      raise exception 'invalid_transition: cannot start preparation from status %', v_order.status;
    end if;
    v_new_status := 'in_preparation';
    v_message    := 'Em preparação';

  elsif p_event = 'MARK_READY' then
    if v_order.status != 'in_preparation' then
      raise exception 'invalid_transition: cannot mark ready from status %', v_order.status;
    end if;
    v_new_status := 'ready';
    v_message    := 'Pronto para entrega/levantamento';

  elsif p_event = 'DELIVER' then
    if v_order.status != 'ready' then
      raise exception 'invalid_transition: cannot deliver from status %', v_order.status;
    end if;
    v_new_status := 'delivered';
    v_message    := 'Entregue';

  elsif p_event = 'CANCEL' then
    if v_order.status in ('delivered', 'cancelled') then
      raise exception 'invalid_transition: cannot cancel terminal state %', v_order.status;
    end if;
    if p_reason is null or length(trim(p_reason)) = 0 then
      raise exception 'cancel_reason_required' using errcode = 'P0002';
    end if;
    v_new_status := 'cancelled';
    v_message    := p_reason;

  else
    raise exception 'invalid_event:%.', p_event using errcode = 'P0003';
  end if;

  update orders
  set status     = v_new_status,
      updated_at = now()
  where id = p_order_id;

  insert into event_log (order_id, type, payload)
  values (
    p_order_id,
    'order.' || lower(p_event),
    jsonb_build_object(
      'new_status', v_new_status,
      'reason',     p_reason,
      'message',    v_message
    )
  );

  return jsonb_build_object(
    'success',    true,
    'order_id',   p_order_id,
    'new_status', v_new_status,
    'message',    v_message
  );
end;
$$;