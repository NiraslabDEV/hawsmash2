-- HAWSMASH 2.0 — 1026: gestão de ingredientes, ficha técnica e CMV no painel.
--
-- Custo é dinheiro: editar um custo ou uma ficha técnica muda a margem de todo
-- o histórico seguinte, por isso é `owner`. Contar, receber e lançar quebra é
-- operação da loja: `manager` chega (mesma regra do estoque de produto final).

-- ---------------------------------------------------------------------------
-- Guardas
-- ---------------------------------------------------------------------------
create or replace function private.assert_recipe_owner()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated' using errcode = 'P0020';
  end if;
  if not private.auth_is_owner() then
    raise exception 'recipe_access_denied' using errcode = 'P0403';
  end if;
end;
$$;

revoke all on function private.assert_recipe_owner() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Catálogo de ingredientes: criar/editar (inclui o custo)
-- ---------------------------------------------------------------------------
create or replace function public.save_ingredient(
  p_name text,
  p_cost_cents integer,
  p_id uuid default null,
  p_unit text default 'un',
  p_active boolean default true,
  p_sort integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_id uuid;
  v_previous public.ingredients%rowtype;
begin
  perform private.assert_recipe_owner();

  if v_name is null or length(v_name) > 80 then
    raise exception 'invalid_ingredient_name' using errcode = 'P0007';
  end if;
  if p_cost_cents is null or p_cost_cents < 0 then
    raise exception 'invalid_ingredient_cost' using errcode = 'P0007';
  end if;
  if p_unit not in ('un', 'g', 'ml') then
    raise exception 'invalid_ingredient_unit' using errcode = 'P0007';
  end if;

  if p_id is null then
    insert into public.ingredients (name, unit, cost_cents, active, sort)
    values (v_name, p_unit, p_cost_cents, coalesce(p_active, true), coalesce(p_sort, 0))
    returning id into v_id;
  else
    select * into v_previous from public.ingredients where id = p_id;
    if not found then
      raise exception 'ingredient_not_found' using errcode = 'P0404';
    end if;

    update public.ingredients
    set name = v_name,
        unit = p_unit,
        cost_cents = p_cost_cents,
        active = coalesce(p_active, active),
        sort = coalesce(p_sort, sort)
    where id = p_id;
    v_id := p_id;
  end if;

  insert into public.event_log (actor_user_id, type, payload)
  values (
    v_uid,
    case when p_id is null then 'ingredient.created' else 'ingredient.updated' end,
    jsonb_build_object(
      'ingredient_id', v_id,
      'name', v_name,
      'unit', p_unit,
      'cost_cents', p_cost_cents,
      'previous_cost_cents', v_previous.cost_cents
    )
  );

  return jsonb_build_object('ingredient_id', v_id, 'name', v_name, 'cost_cents', p_cost_cents);
end;
$$;

revoke all on function public.save_ingredient(text, integer, uuid, text, boolean, integer)
  from public, anon;
grant execute on function public.save_ingredient(text, integer, uuid, text, boolean, integer)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Ficha técnica: gravar e remover uma linha
-- ---------------------------------------------------------------------------
create or replace function public.save_recipe_item(
  p_menu_item_id uuid,
  p_ingredient_id uuid,
  p_qty integer,
  p_variant_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_id uuid;
begin
  perform private.assert_recipe_owner();

  if p_qty is null or p_qty <= 0 then
    raise exception 'invalid_recipe_qty' using errcode = 'P0007';
  end if;

  insert into public.recipe_items (menu_item_id, variant_id, ingredient_id, qty)
  values (p_menu_item_id, p_variant_id, p_ingredient_id, p_qty)
  on conflict (
    menu_item_id,
    ingredient_id,
    coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  do update set qty = excluded.qty
  returning id into v_id;

  insert into public.event_log (actor_user_id, type, payload)
  values (
    v_uid,
    'recipe.saved',
    jsonb_build_object(
      'recipe_item_id', v_id,
      'menu_item_id', p_menu_item_id,
      'variant_id', p_variant_id,
      'ingredient_id', p_ingredient_id,
      'qty', p_qty
    )
  );

  return jsonb_build_object('recipe_item_id', v_id);
end;
$$;

revoke all on function public.save_recipe_item(uuid, uuid, integer, uuid) from public, anon;
grant execute on function public.save_recipe_item(uuid, uuid, integer, uuid) to authenticated;

create or replace function public.delete_recipe_item(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.recipe_items%rowtype;
begin
  perform private.assert_recipe_owner();

  delete from public.recipe_items where id = p_id returning * into v_row;
  if not found then
    raise exception 'recipe_item_not_found' using errcode = 'P0404';
  end if;

  insert into public.event_log (actor_user_id, type, payload)
  values (
    (select auth.uid()),
    'recipe.deleted',
    jsonb_build_object(
      'recipe_item_id', p_id,
      'menu_item_id', v_row.menu_item_id,
      'variant_id', v_row.variant_id,
      'ingredient_id', v_row.ingredient_id
    )
  );

  return jsonb_build_object('recipe_item_id', p_id, 'deleted', true);
end;
$$;

revoke all on function public.delete_recipe_item(uuid) from public, anon;
grant execute on function public.delete_recipe_item(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Leitura: ficha técnica completa (produto → variante → ingredientes)
-- ---------------------------------------------------------------------------
create or replace function public.list_recipes()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'menu_item_id', x.menu_item_id,
        'item_name', x.item_name,
        'variant_id', x.variant_id,
        'variant_name', x.variant_name,
        'ingredient_id', x.ingredient_id,
        'ingredient_name', x.ingredient_name,
        'unit', x.unit,
        'qty', x.qty,
        'cost_cents', x.qty * x.cost_cents,
        'recipe_item_id', x.recipe_item_id
      )
      order by x.item_sort, x.item_name, x.variant_name nulls first, x.ingredient_name
    ),
    '[]'::jsonb
  )
  from (
    select
      r.id as recipe_item_id,
      r.menu_item_id,
      mi.name as item_name,
      mi.sort as item_sort,
      r.variant_id,
      mv.name as variant_name,
      r.ingredient_id,
      i.name as ingredient_name,
      i.unit,
      r.qty,
      i.cost_cents
    from public.recipe_items r
    join public.menu_items mi on mi.id = r.menu_item_id
    join public.ingredients i on i.id = r.ingredient_id
    left join public.menu_item_variants mv on mv.id = r.variant_id
  ) x;
$$;

revoke all on function public.list_recipes() from public, anon;
grant execute on function public.list_recipes() to authenticated;

-- ---------------------------------------------------------------------------
-- Leitura: ingredientes de uma loja, com nível de alerta
-- ---------------------------------------------------------------------------
create or replace function public.list_store_ingredients(p_store_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated' using errcode = 'P0020';
  end if;
  if not private.auth_can_store(p_store_id) then
    raise exception 'stock_access_denied' using errcode = 'P0403';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'ingredient_id', i.id,
        'name', i.name,
        'unit', i.unit,
        'cost_cents', i.cost_cents,
        'active', i.active,
        'track', si.track,
        'qty', si.qty,
        'low_qty', si.low_qty,
        'value_cents', si.qty * i.cost_cents,
        'level', private.stock_level(si.track, si.qty, si.low_qty)
      )
      order by i.sort, i.name
    ),
    '[]'::jsonb
  )
  into v_result
  from public.store_ingredients si
  join public.ingredients i on i.id = si.ingredient_id
  where si.store_id = p_store_id;

  return v_result;
end;
$$;

revoke all on function public.list_store_ingredients(uuid) from public, anon;
grant execute on function public.list_store_ingredients(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Contagem, entrada, quebra e correcção — sempre com motivo e sempre logadas
-- ---------------------------------------------------------------------------
create or replace function public.adjust_store_ingredient(
  p_store_id uuid,
  p_ingredient_id uuid,
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
  v_row record;
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

  select si.qty, si.track, i.name
  into v_row
  from public.store_ingredients si
  join public.ingredients i on i.id = si.ingredient_id
  where si.store_id = p_store_id
    and si.ingredient_id = p_ingredient_id
  for update of si;

  if not found then
    raise exception 'store_ingredient_not_found' using errcode = 'P0404';
  end if;

  if not v_row.track then
    raise exception 'ingredient_not_tracked' using errcode = 'P0003';
  end if;

  if p_new_qty is not null then
    if p_new_qty < 0 then
      raise exception 'invalid_stock_qty' using errcode = 'P0007';
    end if;
    v_new_qty := p_new_qty;
    v_delta := p_new_qty - v_row.qty;
  else
    v_delta := p_delta;
    v_new_qty := v_row.qty + p_delta;
    if v_new_qty < 0 then
      raise exception 'insufficient_stock' using errcode = 'P0014';
    end if;
  end if;

  update public.store_ingredients si
  set qty = v_new_qty
  where si.store_id = p_store_id
    and si.ingredient_id = p_ingredient_id;

  if v_delta <> 0 then
    v_movement_id := private.record_ingredient_movement(
      p_store_id, p_ingredient_id, v_delta, p_reason, null, v_note, v_new_qty
    );
  end if;

  insert into public.event_log (store_id, actor_user_id, type, payload)
  values (
    p_store_id,
    v_uid,
    'ingredient.adjusted',
    jsonb_build_object(
      'ingredient_id', p_ingredient_id,
      'ingredient_name', v_row.name,
      'previous_qty', v_row.qty,
      'new_qty', v_new_qty,
      'delta', v_delta,
      'reason', p_reason,
      'note', v_note,
      'movement_id', v_movement_id
    )
  );

  return jsonb_build_object(
    'store_id', p_store_id,
    'ingredient_id', p_ingredient_id,
    'ingredient_name', v_row.name,
    'previous_qty', v_row.qty,
    'new_qty', v_new_qty,
    'delta', v_delta,
    'reason', p_reason,
    'movement_id', v_movement_id
  );
end;
$$;

revoke all on function public.adjust_store_ingredient(uuid, uuid, text, integer, integer, text)
  from public, anon;
grant execute on function public.adjust_store_ingredient(uuid, uuid, text, integer, integer, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Ligar/desligar a contagem de um ingrediente numa loja
-- ---------------------------------------------------------------------------
create or replace function public.set_ingredient_tracking(
  p_store_id uuid,
  p_ingredient_id uuid,
  p_track boolean,
  p_low_qty integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
begin
  perform private.assert_stock_manager(p_store_id);

  if p_low_qty is not null and p_low_qty < 0 then
    raise exception 'invalid_low_qty' using errcode = 'P0007';
  end if;

  update public.store_ingredients si
  set track = coalesce(p_track, si.track),
      low_qty = coalesce(p_low_qty, si.low_qty)
  where si.store_id = p_store_id
    and si.ingredient_id = p_ingredient_id
  returning si.track, si.qty, si.low_qty into v_row;

  if not found then
    raise exception 'store_ingredient_not_found' using errcode = 'P0404';
  end if;

  insert into public.event_log (store_id, actor_user_id, type, payload)
  values (
    p_store_id,
    (select auth.uid()),
    'ingredient.tracking_changed',
    jsonb_build_object(
      'ingredient_id', p_ingredient_id,
      'track', v_row.track,
      'low_qty', v_row.low_qty
    )
  );

  return jsonb_build_object(
    'store_id', p_store_id,
    'ingredient_id', p_ingredient_id,
    'track', v_row.track,
    'qty', v_row.qty,
    'low_qty', v_row.low_qty
  );
end;
$$;

revoke all on function public.set_ingredient_tracking(uuid, uuid, boolean, integer)
  from public, anon;
grant execute on function public.set_ingredient_tracking(uuid, uuid, boolean, integer)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Histórico de movimentos de um ingrediente
-- ---------------------------------------------------------------------------
create or replace function public.list_ingredient_movements(
  p_store_id uuid,
  p_ingredient_id uuid default null,
  p_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_result jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated' using errcode = 'P0020';
  end if;
  if not private.auth_can_store(p_store_id) then
    raise exception 'stock_access_denied' using errcode = 'P0403';
  end if;

  select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb)
  into v_result
  from (
    select
      im.created_at,
      jsonb_build_object(
        'id', im.id,
        'ingredient_id', im.ingredient_id,
        'ingredient_name', i.name,
        'unit', i.unit,
        'delta', im.delta,
        'qty_after', im.qty_after,
        'reason', im.reason,
        'order_id', im.order_id,
        'order_number', o.order_number,
        'note', im.note,
        'created_by', sp.full_name,
        'created_at', im.created_at
      ) as x
    from public.ingredient_movements im
    join public.ingredients i on i.id = im.ingredient_id
    left join public.orders o on o.id = im.order_id
    left join public.staff_profiles sp on sp.user_id = im.created_by
    where im.store_id = p_store_id
      and (p_ingredient_id is null or im.ingredient_id = p_ingredient_id)
    order by im.created_at desc
    limit v_limit
  ) t(created_at, x);

  return v_result;
end;
$$;

revoke all on function public.list_ingredient_movements(uuid, uuid, integer) from public, anon;
grant execute on function public.list_ingredient_movements(uuid, uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- CMV: receita, custo e margem por produto, no período.
--
-- Lê o custo GRAVADO na linha (order_items.cost_cents). Alterar o custo de um
-- ingrediente hoje não reescreve a margem de ontem — que é o que torna este
-- relatório utilizável para decidir preço.
-- ---------------------------------------------------------------------------
create or replace function public.report_cmv(
  p_store_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
  v_revenue bigint;
  v_cost bigint;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated' using errcode = 'P0020';
  end if;
  if not private.auth_can_store(p_store_id) then
    raise exception 'stock_access_denied' using errcode = 'P0403';
  end if;
  if private.auth_role() not in ('owner', 'manager') then
    raise exception 'report_access_denied' using errcode = 'P0403';
  end if;

  with linhas as (
    select
      oi.menu_item_id,
      oi.name_snapshot,
      oi.variant_name_snapshot,
      sum(oi.qty)::bigint as qty,
      sum(oi.qty * oi.unit_price_cents)::bigint as revenue_cents,
      sum(coalesce(oi.cost_cents, 0))::bigint as cost_cents,
      count(*) filter (where oi.cost_cents is null)::bigint as linhas_sem_custo
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    where oi.store_id = p_store_id
      and o.created_at >= p_from
      and o.created_at < p_to
      and o.status not in ('cancelled', 'draft', 'awaiting_payment', 'awaiting_approval')
    group by oi.menu_item_id, oi.name_snapshot, oi.variant_name_snapshot
  )
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'menu_item_id', l.menu_item_id,
          'item_name', l.name_snapshot,
          'variant_name', l.variant_name_snapshot,
          'qty', l.qty,
          'revenue_cents', l.revenue_cents,
          'cost_cents', l.cost_cents,
          'margin_cents', l.revenue_cents - l.cost_cents,
          'lines_without_cost', l.linhas_sem_custo
        )
        order by (l.revenue_cents - l.cost_cents) desc
      ),
      '[]'::jsonb
    ),
    coalesce(sum(l.revenue_cents), 0),
    coalesce(sum(l.cost_cents), 0)
  into v_rows, v_revenue, v_cost
  from linhas l;

  return jsonb_build_object(
    'store_id', p_store_id,
    'from', p_from,
    'to', p_to,
    'revenue_cents', v_revenue,
    'cost_cents', v_cost,
    'margin_cents', v_revenue - v_cost,
    'items', v_rows
  );
end;
$$;

revoke all on function public.report_cmv(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.report_cmv(uuid, timestamptz, timestamptz) to authenticated;
