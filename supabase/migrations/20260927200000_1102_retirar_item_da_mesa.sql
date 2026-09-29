-- HAWSMASH 2.0 — 1102: retirar um artigo de um pedido da mesa que ainda não
-- foi pago.
--
-- Pedido do balcão (27 Set): a mesa pede três hambúrgueres e desiste de um, ou
-- o caixa lançou um artigo por engano. Até aqui não havia volta: o artigo
-- ficava na conta e a mesa pagava-o. Agora a caixa retira-o no POS.
--
-- Só enquanto a conta está aberta (sem `table_bill_id`). Depois de paga é uma
-- anulação, que é de gerente (CLAUDE §6) — isto não abre essa porta.
--
-- O que acontece, tudo na mesma transacção:
--   · a linha perde a quantidade (ou sai, se ficar a zero) e o pedido recalcula
--     o total a partir do que sobra — o preço é o que a BD gravou (Regra 2);
--   · o produto e a matéria-prima dessa quantidade voltam ao stock;
--   · `event_log` guarda o artigo, a quantidade, o valor, o motivo e quem foi —
--     a linha pode desaparecer, o registo não;
--   · um pedido sem artigos passa a cancelado e sai da conta;
--   · a cozinha recebe um papel "ANULAR" (best-effort, Regra 1).
--
-- Idempotente por `requestId` (Regra 4): tocar duas vezes não retira dois.

-- ---------------------------------------------------------------------------
-- 1. A reposição passa a devolver só o que falta devolver.
--
-- Antes: "se já há um movimento `void` neste pedido, não faço nada". Com
-- artigos retirados um a um, isso deixava por repor o resto quando o pedido
-- inteiro fosse depois anulado. Agora cada artigo conta o que saiu (`sale`)
-- menos o que já voltou (`void`) e repõe a diferença — continua idempotente
-- (a segunda chamada encontra zero) e serve para os dois casos.
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

  for v_sale in
    select sm.store_id, sm.menu_item_id, sum(-sm.delta)::integer as qty
    from public.stock_movements sm
    where sm.order_id = p_order_id
      and sm.reason in ('sale', 'void')
    group by sm.store_id, sm.menu_item_id
    having sum(-sm.delta) > 0
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

create or replace function private.restore_order_ingredients(p_order_id uuid)
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
  for v_sale in
    select im.store_id, im.ingredient_id, sum(-im.delta)::integer as qty
    from public.ingredient_movements im
    where im.order_id = p_order_id
      and im.reason in ('sale', 'void')
    group by im.store_id, im.ingredient_id
    having sum(-im.delta) > 0
  loop
    update public.store_ingredients si
    set qty = si.qty + v_sale.qty
    where si.store_id = v_sale.store_id
      and si.ingredient_id = v_sale.ingredient_id
    returning si.qty into v_new_qty;

    if v_new_qty is null then
      continue;
    end if;

    perform private.record_ingredient_movement(
      v_sale.store_id, v_sale.ingredient_id, v_sale.qty, 'void', p_order_id, null, v_new_qty
    );
    v_restored := v_restored + v_sale.qty;
  end loop;

  return v_restored;
end;
$$;

revoke all on function private.restore_order_ingredients(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. O papel "ANULAR" para a cozinha, no formato herdado da comanda — o que
--    qualquer bridge já instalado imprime: nome em grande, MESA, artigo, nota.
-- ---------------------------------------------------------------------------
create or replace function private.enqueue_table_item_removed(
  p_order_id uuid,
  p_item jsonb,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order record;
  v_seq integer;
  v_job_id uuid;
begin
  select o.store_id, o.order_number, o.daily_number, o.total_cents, t.number as table_number
  into v_order
  from public.orders o
  join public.tables t on t.id = o.table_id
  where o.id = p_order_id;
  if not found then
    return null;
  end if;

  select coalesce(max(pj.reprint_seq), -1) + 1 into v_seq
  from public.print_jobs pj
  where pj.order_id = p_order_id
    and pj.station = 'kitchen'
    and pj.kind = 'order';

  insert into public.print_jobs (store_id, order_id, station, kind, reprint_seq, payload)
  values (
    v_order.store_id, p_order_id, 'kitchen', 'order', v_seq,
    jsonb_build_object(
      'order_number', v_order.order_number,
      'daily_number', v_order.daily_number,
      'customer_name', '*** ANULAR ***',
      'fulfillment_type', 'dine_in',
      'table_number', v_order.table_number,
      'items', jsonb_build_array(jsonb_build_object(
        'name', 'NAO FAZER: ' || (p_item ->> 'name'),
        'quantity', (p_item ->> 'qty')::integer,
        'variant', p_item ->> 'variant',
        'notes', p_item ->> 'notes',
        'person', p_item ->> 'person',
        'modifiers', '[]'::jsonb
      )),
      'payment_method', 'no_payment',
      'total_cents', v_order.total_cents,
      'notes', 'Retirado do pedido' || coalesce(' — ' || p_reason, ''),
      'created_at', now()
    )
  )
  on conflict (order_id, station, kind, reprint_seq) do nothing
  returning id into v_job_id;

  return v_job_id;
end;
$$;

revoke all on function private.enqueue_table_item_removed(uuid, jsonb, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Retirar o artigo
--
-- Payload: { requestId, deviceId, orderItemId, qty, reason }.
-- `qty` omitido retira a linha toda.
-- ---------------------------------------------------------------------------
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

  -- Tocar duas vezes devolve a primeira resposta (Regra 4).
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('remove_table_item:' || v_request_id::text, 0)
  );
  select e.* into v_existing
  from public.event_log e
  where e.type = 'table.item_removed'
    and e.store_id = v_store.id
    and e.payload ->> 'request_id' = v_request_id::text
  limit 1;
  if found then
    return v_existing.payload || jsonb_build_object('duplicate', true);
  end if;

  select oi.* into v_item
  from public.order_items oi
  where oi.id = v_item_id
    and oi.store_id = v_store.id;
  if not found then
    raise exception 'order_item_not_found' using errcode = 'P0404';
  end if;

  -- O pedido fica preso até ao fim: um fecho de conta ao mesmo tempo espera,
  -- e depois vê o total novo (table_bill_changed).
  select o.* into v_order
  from public.orders o
  where o.id = v_item.order_id
    and o.store_id = v_store.id
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
  where oi.id = v_item_id
  for update;
  if not found then
    raise exception 'order_item_not_found' using errcode = 'P0404';
  end if;

  v_qty := least(coalesce(v_qty, v_item.qty), v_item.qty);
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
      where si.store_id = v_store.id
        and si.menu_item_id = v_item.menu_item_id
      returning si.stock_qty into v_new_qty;

      if v_new_qty is not null then
        perform private.record_stock_movement(
          v_store.id, v_item.menu_item_id, v_restore, 'void', v_order.id,
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
        where si.store_id = v_store.id
          and si.ingredient_id = v_need.ingredient_id
        returning si.qty into v_new_qty;

        if v_new_qty is not null then
          perform private.record_ingredient_movement(
            v_store.id, v_need.ingredient_id, v_restore, 'void', v_order.id,
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

  perform set_config('app.request_store_id', v_store.id::text, true);

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
    v_order.id, v_store.id, v_uid, 'table.item_removed',
    jsonb_build_object(
      'request_id', v_request_id,
      'device_id', v_device_id,
      'order_id', v_order.id,
      'order_item_id', v_item.id,
      'menu_item_id', v_item.menu_item_id,
      'item', v_snapshot,
      'unit_price_cents', v_item.unit_price_cents,
      'removed_cents', v_removed_cents,
      'reason', v_reason,
      'order_total_cents', v_order.total_cents,
      'order_cancelled', v_cancelled
    )
  );

  -- O papel nunca desfaz a remoção (Regra 1). Um artigo já entregue à mesa
  -- não precisa de aviso na cozinha.
  if v_order.status <> 'delivered' then
    begin
      perform private.enqueue_table_item_removed(v_order.id, v_snapshot, v_reason);
    exception when others then
      insert into public.event_log (order_id, store_id, actor_user_id, type, payload)
      values (v_order.id, v_store.id, v_uid, 'print.table_item_removed_failed',
        jsonb_build_object('error', sqlstate));
    end;
  end if;

  update public.devices set last_seen_at = now() where id = v_device_id;

  return jsonb_build_object(
    'request_id', v_request_id,
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

revoke all on function public.remove_table_item(jsonb) from public, anon;
grant execute on function public.remove_table_item(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. A aba Mesas passa a saber o id de cada linha, para a poder retirar.
-- ---------------------------------------------------------------------------
create or replace function public.pos_table_overview(p_device_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_store public.stores%rowtype;
begin
  v_store := private.pos_device_store(p_device_id);

  return jsonb_build_object(
    'store_id', v_store.id,
    'tables', (
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
            from private.table_tab_order_ids(v_store.id, t.id) tab(id)
            join public.orders o on o.id = tab.id
          ), '[]'::jsonb)
        ) as mesa
        from public.tables t
        where t.store_id = v_store.id
      ) mesas
      -- Uma mesa desactivada com conta por fechar continua a aparecer.
      where (mesa ->> 'active')::boolean
        or jsonb_array_length(mesa -> 'orders') > 0
    )
  );
end;
$$;

revoke all on function public.pos_table_overview(uuid) from public, anon;
grant execute on function public.pos_table_overview(uuid) to authenticated;
