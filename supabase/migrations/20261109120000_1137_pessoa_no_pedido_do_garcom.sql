-- ============================================================================
-- 1137 · O garçom diz de quem é cada prato
--
-- Numa mesa de três, o garçom escreve "Ana", "Rui", "Marta" e põe cada pedido
-- na pessoa certa, como o cardápio do QR já faz desde 2026-06 ("A pedir para").
-- A coluna `order_items.person_label` e a comanda agrupada por pessoa já
-- existem; faltava o `waiter_launch_order` gravar o nome.
--
-- Só muda isso. O preço continua a vir de `private.price_table_items`
-- (Regra 2), que não se toca: o POS usa-a igual. O nome é texto livre,
-- efémero, até 40 caracteres, e não se liga a cliente nenhum.
-- ============================================================================

create or replace function public.waiter_launch_order(p_token text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_waiter public.waiters%rowtype := private.waiter_from_token(p_token);
  v_store public.stores%rowtype;
  v_client_sale_id uuid;
  v_table_id uuid;
  v_table public.tables%rowtype;
  v_existing public.orders%rowtype;
  v_lines jsonb;
  v_line jsonb;
  v_subtotal integer := 0;
  v_day date;
  v_daily integer;
  v_order_number text;
  v_order_id uuid;
  v_name text;
  v_phone text;
  v_note text;
  v_i bigint;
  v_person text;
begin
  begin
    v_client_sale_id := nullif(p_payload ->> 'clientSaleId', '')::uuid;
    v_table_id := nullif(p_payload ->> 'tableId', '')::uuid;
  exception when invalid_text_representation then
    raise exception 'invalid_waiter_payload' using errcode = 'P0007';
  end;
  if v_client_sale_id is null then
    raise exception 'client_sale_id_required' using errcode = 'P0007';
  end if;

  -- Repetir o mesmo envio devolve o mesmo pedido (Regra 4).
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_client_sale_id::text, 0)
  );
  select o.* into v_existing
  from public.orders o
  where o.client_sale_id = v_client_sale_id;
  if found then
    -- A chave de outro garçom, ou de outra loja, não abre o pedido dele.
    if v_existing.waiter_id is distinct from v_waiter.id then
      raise exception 'client_sale_id_store_conflict' using errcode = 'P0409';
    end if;
    return jsonb_build_object(
      'order_id', v_existing.id,
      'order_number', v_existing.order_number,
      'daily_number', v_existing.daily_number,
      'total_cents', v_existing.total_cents,
      'table_id', v_existing.table_id,
      'table_number', (select t.number from public.tables t where t.id = v_existing.table_id),
      'customer_name', v_existing.customer_name,
      'duplicate', true
    );
  end if;

  v_store := private.waiter_store(v_waiter);

  -- Regra 3: a mesa tem de ser da loja dele.
  select t.* into v_table
  from public.tables t
  where t.id = v_table_id
    and t.store_id = v_store.id
    and t.active;
  if not found then
    raise exception 'invalid_table' using errcode = 'P0060';
  end if;

  -- O nome da conta (1092): o que o garçom escreveu, ou o que a conta já tem.
  v_name := left(nullif(btrim(p_payload ->> 'customerName'), ''), 60);
  if v_name is null then
    v_name := private.table_tab_name(v_store.id, v_table.id);
  end if;

  -- (1129) O telefone e a característica são da conta, como o nome.
  v_phone := private.normalize_phone(left(p_payload ->> 'customerPhone', 30));
  if v_phone is null then
    v_phone := private.table_tab_phone(v_store.id, v_table.id);
  end if;
  v_note := left(nullif(btrim(p_payload ->> 'tabNote'), ''), 120);
  if v_note is null then
    v_note := private.table_tab_note(v_store.id, v_table.id);
  end if;

  -- Regra 2: o preço é da loja, calculado aqui.
  v_lines := private.price_table_items(v_store.id, p_payload -> 'items');
  for v_line in select value from jsonb_array_elements(v_lines)
  loop
    v_subtotal := v_subtotal
      + (v_line ->> 'unit_price_cents')::integer * (v_line ->> 'qty')::integer;
  end loop;

  v_day := (now() at time zone 'Africa/Maputo')::date;
  insert into public.order_counters (store_id, day, seq)
  values (v_store.id, v_day, 1)
  on conflict (store_id, day) do update
    set seq = public.order_counters.seq + 1
  returning seq into v_daily;

  v_order_number := private.next_order_number(v_store.id);

  perform set_config('app.request_store_id', v_store.id::text, true);

  insert into public.orders (
    store_id, order_number, daily_number, client_sale_id, table_id, waiter_id,
    status, flow, fulfillment_type, channel,
    customer_name, customer_phone, tab_note, subtotal_cents, delivery_fee_cents, total_cents,
    payment_method, notes
  ) values (
    v_store.id, v_order_number, v_daily, v_client_sale_id, v_table.id, v_waiter.id,
    'in_preparation', 'dine_in', 'dine_in', 'dine_in',
    'Mesa ' || v_table.number || coalesce(' · ' || v_name, ''),
    v_phone, v_note,
    v_subtotal, 0, v_subtotal,
    'no_payment', left(nullif(btrim(p_payload ->> 'notes'), ''), 300)
  )
  returning id into v_order_id;

  -- (1137) A linha i do preço é o artigo i do payload: o nome da pessoa vem
  -- de lá. Texto livre e curto, como no QR; vazio = da mesa toda.
  for v_line, v_i in select value, ordinality from jsonb_array_elements(v_lines) with ordinality
  loop
    v_person := left(nullif(btrim((p_payload -> 'items' -> (v_i::integer - 1)) ->> 'person'), ''), 40);
    insert into public.order_items (
      order_id, store_id, menu_item_id, name_snapshot, qty, unit_price_cents,
      station, notes, variant_name_snapshot, addons, person_label
    ) values (
      v_order_id,
      v_store.id,
      (v_line ->> 'menu_item_id')::uuid,
      v_line ->> 'name',
      (v_line ->> 'qty')::integer,
      (v_line ->> 'unit_price_cents')::integer,
      v_line ->> 'station',
      v_line ->> 'notes',
      v_line ->> 'variant_name',
      coalesce(v_line -> 'addons', '[]'::jsonb),
      v_person
    );
  end loop;

  -- Stock do produto e matéria-prima, na mesma transacção: se faltar, o
  -- lançamento inteiro reverte (out_of_stock / out_of_ingredient).
  perform private.consume_order_stock(v_order_id);

  insert into public.event_log (order_id, store_id, type, payload)
  values (
    v_order_id, v_store.id, 'table.order_launched',
    jsonb_build_object(
      'source', 'waiter',
      'waiter_id', v_waiter.id,
      'client_sale_id', v_client_sale_id,
      'table_number', v_table.number,
      'total_cents', v_subtotal
    )
  );

  -- O papel é best-effort (Regra 1): sem impressora o pedido fica na mesa.
  begin
    perform private.enqueue_table_comanda(v_order_id);
  exception when others then
    insert into public.event_log (order_id, store_id, type, payload)
    values (v_order_id, v_store.id, 'print.table_comanda_failed',
      jsonb_build_object('error', sqlstate, 'source', 'waiter'));
  end;

  return jsonb_build_object(
    'order_id', v_order_id,
    'order_number', v_order_number,
    'daily_number', v_daily,
    'total_cents', v_subtotal,
    'table_id', v_table.id,
    'table_number', v_table.number,
    'customer_name', 'Mesa ' || v_table.number || coalesce(' · ' || v_name, ''),
    'duplicate', false
  );
end;
$$;

revoke all on function public.waiter_launch_order(text, jsonb) from public, anon, authenticated;
grant execute on function public.waiter_launch_order(text, jsonb) to service_role;
