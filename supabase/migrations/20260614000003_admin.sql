-- ============================================================================
-- DELIVERY OS — Admin RPCs: advance_order, get_orders, get_order_stats,
--               attach_payment_proof
-- F0.4: Painel admin com gestão de pedidos
-- Ref: CLAUDE.md secções 5, 8, 14.2
-- ============================================================================

-- customer_email: campo opcional para emails ao cliente (F0.4)
alter table orders add column if not exists customer_email text;

-- ============================================================================
-- RPC: advance_order(p_order_id, p_event, p_reason)
-- Máquina de estados do pedido — CLAUDE.md secção 5
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

grant execute on function public.advance_order(uuid, text, text) to authenticated;

-- ============================================================================
-- RPC: get_orders(p_filters jsonb)
-- Lista pedidos com filtros opcionais. SQL estático com condicionais.
-- ============================================================================

create or replace function public.get_orders(p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_search  text;
  v_limit   int;
  v_offset  int;
  v_result  jsonb;
  v_count   int;
begin
  v_search := p_filters ->> 'search';
  v_limit  := coalesce((p_filters ->> 'limit')::int,  100);
  v_offset := coalesce((p_filters ->> 'offset')::int, 0);

  select
    count(*) over ()::int,
    coalesce(jsonb_agg(
      jsonb_build_object(
        'id',                 o.id,
        'order_number',       o.order_number,
        'status',             o.status,
        'flow',               o.flow,
        'fulfillment_type',   o.fulfillment_type,
        'delivery_zone_id',   o.delivery_zone_id,
        'address',            o.address,
        'customer_name',      o.customer_name,
        'customer_phone',     o.customer_phone,
        'customer_email',     o.customer_email,
        'scheduled_for',      o.scheduled_for,
        'subtotal_cents',     o.subtotal_cents,
        'delivery_fee_cents', o.delivery_fee_cents,
        'total_cents',        o.total_cents,
        'payment_method',     o.payment_method,
        'payment_proof_path', o.payment_proof_path,
        'notes',              o.notes,
        'created_at',         o.created_at,
        'updated_at',         o.updated_at,
        'items', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'id',              oi.id,
            'menu_item_id',    oi.menu_item_id,
            'name',            oi.name_snapshot,
            'qty',             oi.qty,
            'unit_price_cents',oi.unit_price_cents,
            'station',         oi.station,
            'notes',           oi.notes
          )), '[]'::jsonb)
          from order_items oi where oi.order_id = o.id
        )
      ) order by o.created_at desc
    ), '[]'::jsonb)
  into v_count, v_result
  from orders o
  where
    -- filtros opcionais (null = sem filtro)
    (p_filters ->> 'status'           is null or o.status           = p_filters ->> 'status')
    and (p_filters ->> 'flow'         is null or o.flow             = p_filters ->> 'flow')
    and (p_filters ->> 'fulfillment_type' is null
         or o.fulfillment_type        = p_filters ->> 'fulfillment_type')
    and (p_filters ->> 'date_from'    is null
         or o.created_at             >= (p_filters ->> 'date_from')::timestamptz)
    and (p_filters ->> 'date_to'      is null
         or o.created_at             <= (p_filters ->> 'date_to')::timestamptz)
    and (v_search is null or length(v_search) = 0
         or o.order_number  ilike '%' || v_search || '%'
         or o.customer_name ilike '%' || v_search || '%'
         or o.customer_phone ilike '%' || v_search || '%')
  limit  v_limit
  offset v_offset;

  return jsonb_build_object(
    'orders', coalesce(v_result, '[]'::jsonb),
    'total',  coalesce(v_count, 0)
  );
end;
$$;

grant execute on function public.get_orders(jsonb) to authenticated;

-- ============================================================================
-- RPC: get_order_stats()
-- Cards de stat no topo do painel Pedidos
-- ============================================================================

create or replace function public.get_order_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_total_faturado    int := 0;
  v_ativos            int := 0;
  v_aguarda_pagamento int := 0;
  v_em_preparo        int := 0;
  v_prontos           int := 0;
begin
  select coalesce(sum(o.total_cents), 0) into v_total_faturado
  from orders o
  where o.status in ('approved','paid','in_preparation','ready','delivered');

  select count(*) into v_ativos
  from orders o
  where o.status in ('in_preparation','ready','delivered');

  select count(*) into v_aguarda_pagamento
  from orders o
  where o.status = 'awaiting_approval';

  select count(*) into v_em_preparo
  from orders o
  where o.status = 'in_preparation';

  select count(*) into v_prontos
  from orders o
  where o.status = 'ready';

  return jsonb_build_object(
    'total_faturado',       v_total_faturado,
    'ativos',               v_ativos,
    'aguarda_pagamento',    v_aguarda_pagamento,
    'em_preparo',           v_em_preparo,
    'prontos',              v_prontos
  );
end;
$$;

grant execute on function public.get_order_stats() to authenticated;

-- ============================================================================
-- RPC: attach_payment_proof(p_order_id, p_path)
-- F0.3: liga o comprovativo ao pedido após upload (fluxo manual).
-- anon executa logo após o upload no checkout.
-- ============================================================================

create or replace function public.attach_payment_proof(p_order_id uuid, p_path text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order       record;
  v_owner_email text;
begin
  if p_path is null or length(trim(p_path)) = 0 then
    raise exception 'invalid_proof_path' using errcode = 'P0020';
  end if;

  update orders
  set payment_proof_path = p_path,
      updated_at         = now()
  where id = p_order_id
    and status = 'awaiting_approval'
    and payment_proof_path is null
  returning * into v_order;

  if not found then
    raise exception 'order_not_attachable' using errcode = 'P0021';
  end if;

  select owner_email into v_owner_email from settings where id = 1;

  insert into event_log (order_id, type, payload)
  values (p_order_id, 'payment.proof_attached', jsonb_build_object('path', p_path));

  return jsonb_build_object(
    'order_number',     v_order.order_number,
    'customer_name',    v_order.customer_name,
    'customer_email',   v_order.customer_email,
    'total_cents',      v_order.total_cents,
    'payment_method',   v_order.payment_method,
    'fulfillment_type', v_order.fulfillment_type,
    'owner_email',      v_owner_email
  );
end;
$$;

grant execute on function public.attach_payment_proof(uuid, text) to anon;
