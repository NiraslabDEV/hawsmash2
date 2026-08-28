-- HAWSMASH 2.0 — 1025: a ficha técnica passa a descontar em cada venda.
--
-- A 1024 criou os ingredientes e a ficha. Esta liga-os aos três caminhos que
-- fecham uma venda, sempre na MESMA transacção que a regista:
--   · balcão (POS)           → nova camada em create_counter_sale
--   · online pago/aprovado   → private.consume_order_stock
--   · anulação/cancelamento  → private.restore_order_stock
--
-- Nenhum caminho novo foi inventado: o consumo entra onde o estoque de produto
-- final já entrava, para que não exista uma venda que baixe um e não o outro.

-- ---------------------------------------------------------------------------
-- 1. Online: aprovação manual e pagamento digital
-- ---------------------------------------------------------------------------
create or replace function private.consume_order_stock(p_order_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store_id uuid;
  v_line record;
  v_item record;
  v_new_qty integer;
  v_consumed integer := 0;
begin
  select o.store_id into v_store_id
  from public.orders o
  where o.id = p_order_id;

  if v_store_id is null then
    raise exception 'order_not_found' using errcode = 'P0002';
  end if;

  -- Matéria-prima primeiro: é idempotente por si e não pode ficar de fora
  -- quando o estoque de produto final já tiver sido descontado.
  perform private.consume_order_ingredients(p_order_id);

  if exists (
    select 1 from public.stock_movements sm
    where sm.order_id = p_order_id and sm.reason = 'sale'
  ) then
    return 0;
  end if;

  for v_line in
    select oi.menu_item_id, sum(oi.qty)::integer as qty
    from public.order_items oi
    where oi.order_id = p_order_id
      and oi.menu_item_id is not null
    group by oi.menu_item_id
  loop
    select si.track_stock, si.stock_qty
    into v_item
    from public.store_items si
    where si.store_id = v_store_id
      and si.menu_item_id = v_line.menu_item_id
    for update;

    if not found or not v_item.track_stock then
      continue;
    end if;

    update public.store_items si
    set stock_qty = si.stock_qty - v_line.qty
    where si.store_id = v_store_id
      and si.menu_item_id = v_line.menu_item_id
      and si.stock_qty >= v_line.qty
    returning si.stock_qty into v_new_qty;

    if v_new_qty is null then
      insert into public.event_log (order_id, store_id, type, payload)
      values (
        p_order_id,
        v_store_id,
        'order.stock_insufficient',
        jsonb_build_object('menu_item_id', v_line.menu_item_id, 'requested_qty', v_line.qty)
      );
      raise exception 'out_of_stock:%', v_line.menu_item_id using errcode = 'P0014';
    end if;

    perform private.record_stock_movement(
      v_store_id, v_line.menu_item_id, -v_line.qty, 'sale', p_order_id, null, v_new_qty
    );
    v_consumed := v_consumed + v_line.qty;
  end loop;

  return v_consumed;
end;
$$;

revoke all on function private.consume_order_stock(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Anulação e cancelamento: devolve também a matéria-prima
-- ---------------------------------------------------------------------------
create or replace function private.restore_order_stock(p_order_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sale record;
  v_new_qty integer;
  v_restored integer := 0;
begin
  perform private.restore_order_ingredients(p_order_id);

  if exists (
    select 1 from public.stock_movements sm
    where sm.order_id = p_order_id and sm.reason = 'void'
  ) then
    return 0;
  end if;

  for v_sale in
    select sm.store_id, sm.menu_item_id, sum(-sm.delta)::integer as qty
    from public.stock_movements sm
    where sm.order_id = p_order_id
      and sm.reason = 'sale'
    group by sm.store_id, sm.menu_item_id
  loop
    update public.store_items si
    set stock_qty = si.stock_qty + v_sale.qty
    where si.store_id = v_sale.store_id
      and si.menu_item_id = v_sale.menu_item_id
    returning si.stock_qty into v_new_qty;

    if v_new_qty is null then
      continue;
    end if;

    perform private.record_stock_movement(
      v_sale.store_id, v_sale.menu_item_id, v_sale.qty, 'void', p_order_id, null, v_new_qty
    );
    v_restored := v_restored + v_sale.qty;
  end loop;

  return v_restored;
end;
$$;

revoke all on function private.restore_order_stock(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Balcão: mais uma camada na cebola do create_counter_sale.
--
-- A venda de balcão desconta o estoque dentro da própria RPC (não passa por
-- consume_order_stock), por isso o consumo de matéria-prima entra como camada
-- por cima — o mesmo padrão que a F3 usou para a gaveta e os talões. Fica
-- dentro da transacção: se faltar carne, a venda inteira é revertida e o
-- operador vê `out_of_ingredient:<nome>`.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'create_counter_sale_without_recipe'
  ) then
    alter function public.create_counter_sale_without_tickets(jsonb)
      rename to create_counter_sale_without_recipe;
  end if;
end $$;

revoke all on function public.create_counter_sale_without_recipe(jsonb)
  from public, anon, authenticated;

create or replace function public.create_counter_sale_without_tickets(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_order_id uuid;
begin
  v_result := public.create_counter_sale_without_recipe(p_payload);
  v_order_id := (v_result ->> 'order_id')::uuid;

  if v_order_id is not null then
    perform private.consume_order_ingredients(v_order_id);
  end if;

  return v_result;
end;
$$;

revoke all on function public.create_counter_sale_without_tickets(jsonb)
  from public, anon, authenticated;
