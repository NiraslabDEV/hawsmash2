-- HAWSMASH 2.0 — F6 / 1008: estoque por loja com histórico auditável.
--
-- O stock real vive em store_items (F1). Esta migration acrescenta o livro de
-- movimentos que explica cada variação: venda, anulação, entrada, quebra,
-- contagem ou ajuste à mão. Nenhum movimento é apagado — é o que permite
-- explicar um desvio em vez de o adivinhar (CLAUDE §10).

create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  menu_item_id uuid not null references public.menu_items(id) on delete cascade,
  delta integer not null check (delta <> 0),
  qty_after integer not null check (qty_after >= 0),
  reason text not null check (reason in ('sale', 'void', 'manual', 'waste', 'receive', 'count')),
  -- O pedido pode ser removido do histórico operacional; o movimento fica.
  order_id uuid references public.orders(id) on delete set null,
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists stock_movements_store_created_at_idx
  on public.stock_movements (store_id, created_at desc);
create index if not exists stock_movements_store_item_created_at_idx
  on public.stock_movements (store_id, menu_item_id, created_at desc);
create index if not exists stock_movements_order_idx
  on public.stock_movements (order_id)
  where order_id is not null;
create index if not exists stock_movements_sale_lookup_idx
  on public.stock_movements (order_id, reason)
  where order_id is not null;

alter table public.stock_movements enable row level security;

-- Leitura restrita à loja do utilizador; escrita só pelas RPC SECURITY DEFINER.
drop policy if exists stock_movements_select on public.stock_movements;
create policy stock_movements_select on public.stock_movements
  for select to authenticated
  using (private.auth_can_store(store_id));

revoke all on table public.stock_movements from public, anon, authenticated;
grant select on table public.stock_movements to authenticated;
grant select, insert, update, delete on table public.stock_movements to service_role;

-- ---------------------------------------------------------------------------
-- Registo de um movimento + alerta de rotura (CLAUDE §11.5).
-- ---------------------------------------------------------------------------
create or replace function private.record_stock_movement(
  p_store_id uuid,
  p_menu_item_id uuid,
  p_delta integer,
  p_reason text,
  p_order_id uuid default null,
  p_note text default null,
  p_qty_after integer default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_movement_id uuid;
  v_item record;
  v_qty_after integer := p_qty_after;
begin
  if p_delta = 0 then
    return null;
  end if;

  select si.stock_qty, si.low_stock_qty, si.track_stock, mi.name
  into v_item
  from public.store_items si
  join public.menu_items mi on mi.id = si.menu_item_id
  where si.store_id = p_store_id
    and si.menu_item_id = p_menu_item_id;

  if not found then
    raise exception 'store_item_not_found' using errcode = 'P0404';
  end if;

  v_qty_after := coalesce(v_qty_after, v_item.stock_qty);

  insert into public.stock_movements (
    store_id, menu_item_id, delta, qty_after, reason, order_id, note, created_by
  ) values (
    p_store_id,
    p_menu_item_id,
    p_delta,
    v_qty_after,
    p_reason,
    p_order_id,
    nullif(btrim(coalesce(p_note, '')), ''),
    (select auth.uid())
  )
  returning id into v_movement_id;

  -- O alerta é best-effort: nunca pode reverter a venda que o gerou.
  if p_delta < 0 and v_item.track_stock then
    if v_qty_after = 0 then
      insert into public.event_log (order_id, store_id, actor_user_id, type, payload)
      values (
        p_order_id,
        p_store_id,
        (select auth.uid()),
        'stock.out',
        jsonb_build_object(
          'menu_item_id', p_menu_item_id,
          'item_name', v_item.name,
          'stock_qty', v_qty_after,
          'low_stock_qty', v_item.low_stock_qty,
          'movement_id', v_movement_id,
          'reason', p_reason
        )
      );
    elsif v_item.low_stock_qty > 0 and v_qty_after <= v_item.low_stock_qty then
      insert into public.event_log (order_id, store_id, actor_user_id, type, payload)
      values (
        p_order_id,
        p_store_id,
        (select auth.uid()),
        'stock.low',
        jsonb_build_object(
          'menu_item_id', p_menu_item_id,
          'item_name', v_item.name,
          'stock_qty', v_qty_after,
          'low_stock_qty', v_item.low_stock_qty,
          'movement_id', v_movement_id,
          'reason', p_reason
        )
      );
    end if;
  end if;

  return v_movement_id;
end;
$$;

revoke all on function private.record_stock_movement(uuid, uuid, integer, text, uuid, text, integer)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Consumo do estoque de um pedido (online: aprovação manual ou pagamento
-- digital). A baixa acontece na mesma transacção do pedido e é idempotente:
-- se já existe movimento de venda para o pedido, não desconta outra vez.
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
-- Reposição na anulação: repõe exactamente o que foi consumido (lê o livro de
-- movimentos, não o pedido) e nunca repõe duas vezes.
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
