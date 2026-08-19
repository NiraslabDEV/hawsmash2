-- HAWSMASH 2.0 — F6: gestão de estoque no painel (contagem, entrada, quebra,
-- histórico e alerta de rotura), sempre por loja e sempre auditada.

create or replace function private.assert_stock_manager(p_store_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated' using errcode = 'P0020';
  end if;

  v_role := private.auth_role();
  if v_role is null or v_role not in ('owner', 'manager') then
    raise exception 'stock_access_denied' using errcode = 'P0403';
  end if;

  if not private.auth_can_store(p_store_id) then
    raise exception 'stock_access_denied' using errcode = 'P0403';
  end if;
end;
$$;

revoke all on function private.assert_stock_manager(uuid) from public, anon, authenticated;

-- Nível de alerta de um item: fora de stock, crítico ou normal.
create or replace function private.stock_level(
  p_track_stock boolean,
  p_stock_qty integer,
  p_low_stock_qty integer
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when not p_track_stock then 'ok'
    when p_stock_qty <= 0 then 'out'
    when p_low_stock_qty > 0 and p_stock_qty <= p_low_stock_qty then 'low'
    else 'ok'
  end;
$$;

revoke all on function private.stock_level(boolean, integer, integer) from public, anon;
grant execute on function private.stock_level(boolean, integer, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Ajuste manual: entrada, quebra, contagem ou correcção.
-- ---------------------------------------------------------------------------
create or replace function public.adjust_store_stock(
  p_store_id uuid,
  p_menu_item_id uuid,
  p_reason text,
  p_delta integer default null,
  p_new_qty integer default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_item record;
  v_delta integer;
  v_new_qty integer;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_movement_id uuid;
begin
  perform private.assert_stock_manager(p_store_id);

  if p_reason is null or p_reason not in ('manual', 'waste', 'receive', 'count') then
    raise exception 'invalid_stock_reason' using errcode = 'P0007';
  end if;

  if (p_delta is null) = (p_new_qty is null) then
    raise exception 'stock_delta_or_qty_required' using errcode = 'P0007';
  end if;

  select si.stock_qty, si.track_stock, mi.name
  into v_item
  from public.store_items si
  join public.menu_items mi on mi.id = si.menu_item_id
  where si.store_id = p_store_id
    and si.menu_item_id = p_menu_item_id
  for update of si;

  if not found then
    raise exception 'store_item_not_found' using errcode = 'P0404';
  end if;

  if not v_item.track_stock then
    raise exception 'stock_not_tracked' using errcode = 'P0003';
  end if;

  if p_new_qty is not null then
    if p_new_qty < 0 then
      raise exception 'invalid_stock_qty' using errcode = 'P0007';
    end if;
    v_new_qty := p_new_qty;
    v_delta := p_new_qty - v_item.stock_qty;
  else
    v_delta := p_delta;
    v_new_qty := v_item.stock_qty + p_delta;
    if v_new_qty < 0 then
      raise exception 'insufficient_stock' using errcode = 'P0014';
    end if;
  end if;

  update public.store_items si
  set stock_qty = v_new_qty
  where si.store_id = p_store_id
    and si.menu_item_id = p_menu_item_id;

  if v_delta <> 0 then
    v_movement_id := private.record_stock_movement(
      p_store_id, p_menu_item_id, v_delta, p_reason, null, v_note, v_new_qty
    );
  end if;

  insert into public.event_log (store_id, actor_user_id, type, payload)
  values (
    p_store_id,
    v_uid,
    'stock.adjusted',
    jsonb_build_object(
      'menu_item_id', p_menu_item_id,
      'item_name', v_item.name,
      'previous_qty', v_item.stock_qty,
      'new_qty', v_new_qty,
      'delta', v_delta,
      'reason', p_reason,
      'note', v_note,
      'movement_id', v_movement_id
    )
  );

  return jsonb_build_object(
    'store_id', p_store_id,
    'menu_item_id', p_menu_item_id,
    'item_name', v_item.name,
    'previous_qty', v_item.stock_qty,
    'new_qty', v_new_qty,
    'delta', v_delta,
    'reason', p_reason,
    'movement_id', v_movement_id
  );
end;
$$;

revoke all on function public.adjust_store_stock(uuid, uuid, text, integer, integer, text)
  from public, anon;
grant execute on function public.adjust_store_stock(uuid, uuid, text, integer, integer, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Ligar/desligar o controlo de stock de um item numa loja.
-- ---------------------------------------------------------------------------
create or replace function public.set_stock_tracking(
  p_store_id uuid,
  p_menu_item_id uuid,
  p_track_stock boolean,
  p_low_stock_qty integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row record;
begin
  perform private.assert_stock_manager(p_store_id);

  if p_track_stock is null then
    raise exception 'track_stock_required' using errcode = 'P0007';
  end if;
  if p_low_stock_qty is not null and p_low_stock_qty < 0 then
    raise exception 'invalid_low_stock_qty' using errcode = 'P0007';
  end if;

  update public.store_items si
  set track_stock = p_track_stock,
      low_stock_qty = coalesce(p_low_stock_qty, si.low_stock_qty)
  where si.store_id = p_store_id
    and si.menu_item_id = p_menu_item_id
  returning si.track_stock, si.stock_qty, si.low_stock_qty into v_row;

  if not found then
    raise exception 'store_item_not_found' using errcode = 'P0404';
  end if;

  insert into public.event_log (store_id, actor_user_id, type, payload)
  values (
    p_store_id,
    v_uid,
    'stock.tracking_changed',
    jsonb_build_object(
      'menu_item_id', p_menu_item_id,
      'track_stock', v_row.track_stock,
      'low_stock_qty', v_row.low_stock_qty
    )
  );

  return jsonb_build_object(
    'store_id', p_store_id,
    'menu_item_id', p_menu_item_id,
    'track_stock', v_row.track_stock,
    'stock_qty', v_row.stock_qty,
    'low_stock_qty', v_row.low_stock_qty
  );
end;
$$;

revoke all on function public.set_stock_tracking(uuid, uuid, boolean, integer) from public, anon;
grant execute on function public.set_stock_tracking(uuid, uuid, boolean, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Listagens paginadas (nunca cortar em silêncio: o total vai sempre junto).
-- ---------------------------------------------------------------------------
create or replace function public.list_store_stock(
  p_store_id uuid,
  p_only_tracked boolean default false,
  p_limit integer default 200,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 500);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_total integer;
  v_items jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated' using errcode = 'P0020';
  end if;
  if not private.auth_can_store(p_store_id) then
    raise exception 'store_access_denied' using errcode = 'P0403';
  end if;

  select count(*)::integer
  into v_total
  from public.store_items si
  where si.store_id = p_store_id
    and (not p_only_tracked or si.track_stock);

  select coalesce(jsonb_agg(row_to_json(entry)::jsonb order by entry.category_sort, entry.name), '[]'::jsonb)
  into v_items
  from (
    select
      si.menu_item_id,
      mi.name,
      mc.id as category_id,
      mc.name as category_name,
      mc.sort as category_sort,
      si.available,
      si.track_stock,
      si.stock_qty,
      si.low_stock_qty,
      coalesce(si.price_cents_override, mi.price_cents) as price_cents,
      private.stock_level(si.track_stock, si.stock_qty, si.low_stock_qty) as level
    from public.store_items si
    join public.menu_items mi on mi.id = si.menu_item_id
    join public.menu_categories mc on mc.id = mi.category_id
    where si.store_id = p_store_id
      and (not p_only_tracked or si.track_stock)
    order by mc.sort, mi.name
    limit v_limit offset v_offset
  ) entry;

  return jsonb_build_object(
    'store_id', p_store_id,
    'items', v_items,
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset
  );
end;
$$;

revoke all on function public.list_store_stock(uuid, boolean, integer, integer) from public, anon;
grant execute on function public.list_store_stock(uuid, boolean, integer, integer) to authenticated;

create or replace function public.list_stock_movements(
  p_store_id uuid,
  p_menu_item_id uuid default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_total integer;
  v_movements jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated' using errcode = 'P0020';
  end if;
  if not private.auth_can_store(p_store_id) then
    raise exception 'store_access_denied' using errcode = 'P0403';
  end if;

  select count(*)::integer
  into v_total
  from public.stock_movements sm
  where sm.store_id = p_store_id
    and (p_menu_item_id is null or sm.menu_item_id = p_menu_item_id);

  select coalesce(jsonb_agg(row_to_json(entry)::jsonb order by entry.created_at desc), '[]'::jsonb)
  into v_movements
  from (
    select
      sm.id,
      sm.created_at,
      sm.menu_item_id,
      mi.name as item_name,
      sm.delta,
      sm.qty_after,
      sm.reason,
      sm.note,
      sm.order_id,
      o.order_number,
      sp.full_name as actor_name
    from public.stock_movements sm
    join public.menu_items mi on mi.id = sm.menu_item_id
    left join public.orders o on o.id = sm.order_id
    left join public.staff_profiles sp on sp.user_id = sm.created_by
    where sm.store_id = p_store_id
      and (p_menu_item_id is null or sm.menu_item_id = p_menu_item_id)
    order by sm.created_at desc
    limit v_limit offset v_offset
  ) entry;

  return jsonb_build_object(
    'store_id', p_store_id,
    'movements', v_movements,
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset
  );
end;
$$;

revoke all on function public.list_stock_movements(uuid, uuid, integer, integer) from public, anon;
grant execute on function public.list_stock_movements(uuid, uuid, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Alerta de rotura: o que está esgotado ou abaixo do mínimo, por loja.
-- ---------------------------------------------------------------------------
create or replace function public.list_stock_alerts(p_store_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_alerts jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated' using errcode = 'P0020';
  end if;
  if p_store_id is not null and not private.auth_can_store(p_store_id) then
    raise exception 'store_access_denied' using errcode = 'P0403';
  end if;

  select coalesce(jsonb_agg(row_to_json(entry)::jsonb order by entry.level, entry.item_name), '[]'::jsonb)
  into v_alerts
  from (
    select
      si.store_id,
      s.short_name as store_name,
      si.menu_item_id,
      mi.name as item_name,
      si.stock_qty,
      si.low_stock_qty,
      private.stock_level(si.track_stock, si.stock_qty, si.low_stock_qty) as level
    from public.store_items si
    join public.stores s on s.id = si.store_id
    join public.menu_items mi on mi.id = si.menu_item_id
    where si.track_stock
      and (p_store_id is null or si.store_id = p_store_id)
      and private.auth_can_store(si.store_id)
      and private.stock_level(si.track_stock, si.stock_qty, si.low_stock_qty) <> 'ok'
  ) entry;

  return v_alerts;
end;
$$;

revoke all on function public.list_stock_alerts(uuid) from public, anon;
grant execute on function public.list_stock_alerts(uuid) to authenticated;
