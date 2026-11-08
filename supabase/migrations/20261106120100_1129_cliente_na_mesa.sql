-- 1129 — telefone e característica do cliente na conta da mesa.
--
-- Pedido da loja (Nov/2026): "opção de colocar número de telefone do cliente na
-- mesa, e alguma característica também (OBS)". O campo do telefone já aparecia
-- no carrinho da mesa, mas o lançamento deitava-o fora.
--
-- Como o nome (1092), são da CONTA: escrevem-se uma vez e os pedidos seguintes,
-- do balcão, do garçom ou do QR, herdam-nos. Fechada a conta, a mesa volta limpa.
--
--   * telefone: `orders.customer_phone`, a coluna que já existe e que o trigger
--     da 1038 normaliza. Entra na ficha do cliente como qualquer compra. O aviso
--     de WhatsApp (1118) só corre em delivery/levantamento: a mesa não recebe nada.
--   * característica: `orders.tab_note`, à parte de `orders.notes`. A nota é o
--     recado do pedido à cozinha; esta é quem é a pessoa ("camisa azul"). Sai na
--     comanda, para quem leva o prato a encontrar.
--
-- O telefone não vai para o telemóvel do garçom: `waiter_state` usa o valor por
-- defeito de `table_overview_json`. Ele pode escrevê-lo, não precisa de o ler.
--
-- Forward-only: substitui seis funções (1092, 1122, 1127) e junta três.

alter table public.orders add column if not exists tab_note text;

comment on column public.orders.tab_note is
  'Característica do cliente da conta da mesa (1129), como "camisa azul". Não é orders.notes.';

-- ---------------------------------------------------------------------------
-- 1. O que a conta aberta já tem
-- ---------------------------------------------------------------------------
create or replace function private.table_tab_phone(p_store_id uuid, p_table_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select o.customer_phone
  from private.table_tab_order_ids(p_store_id, p_table_id) tab(id)
  join public.orders o on o.id = tab.id
  where o.customer_phone is not null
  order by o.created_at desc, o.id desc
  limit 1;
$$;

revoke all on function private.table_tab_phone(uuid, uuid) from public, anon, authenticated;

create or replace function private.table_tab_note(p_store_id uuid, p_table_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select o.tab_note
  from private.table_tab_order_ids(p_store_id, p_table_id) tab(id)
  join public.orders o on o.id = tab.id
  where nullif(btrim(o.tab_note), '') is not null
  order by o.created_at desc, o.id desc
  limit 1;
$$;

revoke all on function private.table_tab_note(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. O caixa lança na mesa (1092)
-- ---------------------------------------------------------------------------
create or replace function public.launch_table_order(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_client_sale_id uuid;
  v_device_id uuid;
  v_table_id uuid;
  v_store public.stores%rowtype;
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
begin
  begin
    v_client_sale_id := nullif(p_payload ->> 'clientSaleId', '')::uuid;
    v_device_id := nullif(p_payload ->> 'deviceId', '')::uuid;
    v_table_id := nullif(p_payload ->> 'tableId', '')::uuid;
  exception when invalid_text_representation then
    raise exception 'invalid_pos_payload' using errcode = 'P0007';
  end;
  if v_client_sale_id is null then
    raise exception 'client_sale_id_required' using errcode = 'P0007';
  end if;

  -- Repetir o mesmo lançamento devolve o mesmo pedido (Regra 4), mesmo com o
  -- terminal entretanto bloqueado.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_client_sale_id::text, 0)
  );
  select o.* into v_existing
  from public.orders o
  where o.client_sale_id = v_client_sale_id;
  if found then
    if v_uid is null or not private.auth_can_store(v_existing.store_id) then
      raise exception 'client_sale_id_store_conflict' using errcode = 'P0409';
    end if;
    return jsonb_build_object(
      'order_id', v_existing.id,
      'order_number', v_existing.order_number,
      'daily_number', v_existing.daily_number,
      'total_cents', v_existing.total_cents,
      'table_id', v_existing.table_id,
      'customer_name', v_existing.customer_name,
      'duplicate', true
    );
  end if;

  v_store := private.pos_device_store(v_device_id);

  select t.* into v_table
  from public.tables t
  where t.id = v_table_id
    and t.store_id = v_store.id
    and t.active;
  if not found then
    raise exception 'invalid_table' using errcode = 'P0060';
  end if;

  -- (1092) O nome da conta: o que o caixa escreveu agora, ou o que a conta
  -- já tem — o segundo pedido do João não pede o nome outra vez.
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
    store_id, order_number, daily_number, client_sale_id, table_id,
    status, flow, fulfillment_type, channel,
    customer_name, customer_phone, tab_note, subtotal_cents, delivery_fee_cents, total_cents,
    payment_method, notes
  ) values (
    v_store.id, v_order_number, v_daily, v_client_sale_id, v_table.id,
    'in_preparation', 'dine_in', 'dine_in', 'dine_in',
    'Mesa ' || v_table.number || coalesce(' · ' || v_name, ''),
    v_phone, v_note,
    v_subtotal, 0, v_subtotal,
    'no_payment', nullif(btrim(p_payload ->> 'notes'), '')
  )
  returning id into v_order_id;

  for v_line in select value from jsonb_array_elements(v_lines)
  loop
    insert into public.order_items (
      order_id, store_id, menu_item_id, name_snapshot, qty, unit_price_cents,
      station, notes, variant_name_snapshot, addons
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
      coalesce(v_line -> 'addons', '[]'::jsonb)
    );
  end loop;

  -- Stock do produto e matéria-prima, na mesma transacção: se faltar, o
  -- lançamento inteiro reverte (out_of_stock / out_of_ingredient).
  perform private.consume_order_stock(v_order_id);

  insert into public.event_log (order_id, store_id, actor_user_id, type, payload)
  values (
    v_order_id, v_store.id, v_uid, 'table.order_launched',
    jsonb_build_object(
      'client_sale_id', v_client_sale_id,
      'device_id', v_device_id,
      'table_number', v_table.number,
      'total_cents', v_subtotal
    )
  );

  -- O papel e a atribuição do upsell são best-effort (Regra 1).
  begin
    perform private.enqueue_table_comanda(v_order_id);
  exception when others then
    insert into public.event_log (order_id, store_id, actor_user_id, type, payload)
    values (v_order_id, v_store.id, v_uid, 'print.table_comanda_failed',
      jsonb_build_object('error', sqlstate));
  end;
  begin
    perform private.record_order_upsells(v_order_id, p_payload);
  exception when others then
    raise warning 'upsell_tracking_failed: %', sqlstate;
  end;

  update public.devices set last_seen_at = now() where id = v_device_id;

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

revoke all on function public.launch_table_order(jsonb) from public, anon;
grant execute on function public.launch_table_order(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. O garçom lança na mesa (1122)
-- ---------------------------------------------------------------------------
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

  for v_line in select value from jsonb_array_elements(v_lines)
  loop
    insert into public.order_items (
      order_id, store_id, menu_item_id, name_snapshot, qty, unit_price_cents,
      station, notes, variant_name_snapshot, addons
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
      coalesce(v_line -> 'addons', '[]'::jsonb)
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

-- ---------------------------------------------------------------------------
-- 4. O pedido pelo QR herda (1092)
-- ---------------------------------------------------------------------------
create or replace function private.after_qr_table_order(p_order_id uuid, p_table_number integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_store_id uuid;
  v_table_id uuid;
begin
  select
    nullif(btrim(regexp_replace(o.customer_name, '^mesa\s+\d+\s*(·\s*)?', '', 'i')), ''),
    o.store_id,
    o.table_id
  into v_name, v_store_id, v_table_id
  from public.orders o
  where o.id = p_order_id;

  -- Sem nome no QR, fica o da conta: o pedido do João pelo telemóvel vai para
  -- o cartão do João.
  if v_name is null then
    v_name := private.table_tab_name(v_store_id, v_table_id);
  end if;

  -- Um checkout repetido devolve o mesmo pedido: o nome não se duplica,
  -- porque se escreve sempre a partir do nome limpo.
  update public.orders
  set customer_name = 'Mesa ' || p_table_number || coalesce(' · ' || v_name, ''),
      -- (1129) O telefone do QR, se o trouxe; senão, o da conta. Tal como a OBS.
      customer_phone = coalesce(customer_phone, private.table_tab_phone(v_store_id, v_table_id)),
      tab_note = coalesce(tab_note, private.table_tab_note(v_store_id, v_table_id))
  where id = p_order_id;

  -- Até à 1081 um pedido de mesa não baixava stock nem ficha técnica.
  perform private.consume_order_stock(p_order_id);

  begin
    perform private.enqueue_table_comanda(p_order_id);
  exception when others then
    insert into public.event_log (order_id, type, payload)
    values (p_order_id, 'print.table_comanda_failed', jsonb_build_object('error', sqlstate));
  end;
end;
$$;

revoke all on function private.after_qr_table_order(uuid, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. A comanda leva a característica (1122)
-- ---------------------------------------------------------------------------
create or replace function private.build_table_comanda(p_order_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'order_number', o.order_number,
    'daily_number', o.daily_number,
    'customer_name', coalesce(nullif(btrim(o.customer_name), ''), 'Mesa ' || t.number),
    'fulfillment_type', 'dine_in',
    'table_number', t.number,
    'items', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'name', oi.name_snapshot,
          'quantity', oi.qty,
          'variant', oi.variant_name_snapshot,
          'notes', oi.notes,
          'person', oi.person_label,
          'modifiers',
            case when jsonb_typeof(oi.modifiers) = 'array' then oi.modifiers else '[]'::jsonb end
            || case
              when jsonb_typeof(oi.addons) = 'array' and jsonb_array_length(oi.addons) > 0 then
                jsonb_build_array(jsonb_build_object(
                  'group_name', 'Extras',
                  'options', (
                    select coalesce(jsonb_agg(jsonb_build_object('name', a.value ->> 'name')), '[]'::jsonb)
                    from jsonb_array_elements(oi.addons) a
                  )
                ))
              else '[]'::jsonb
            end
        ) order by oi.person_label nulls first, oi.id
      ), '[]'::jsonb)
      from public.order_items oi
      where oi.order_id = o.id
    ),
    'payment_method', 'no_payment',
    'total_cents', o.total_cents,
    'notes', nullif(concat_ws(
      ' · ',
      'Garçom: ' || w.full_name,
      'Cliente: ' || nullif(btrim(o.tab_note), ''),
      nullif(btrim(o.notes), '')
    ), ''),
    'created_at', o.created_at
  )
  from public.orders o
  join public.tables t on t.id = o.table_id
  left join public.waiters w on w.id = o.waiter_id
  where o.id = p_order_id;
$$;

revoke all on function private.build_table_comanda(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. As mesas no POS e no telemóvel (1127); o telefone só no POS
-- ---------------------------------------------------------------------------
drop function if exists private.table_overview_json(uuid);

create or replace function private.table_overview_json(
  p_store_id uuid,
  p_with_phone boolean default false
)
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
            'tab_note', o.tab_note,
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
          ) || case when p_with_phone then jsonb_build_object('customer_phone', o.customer_phone)
                    else '{}'::jsonb end
          order by o.created_at, o.id
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

revoke all on function private.table_overview_json(uuid, boolean) from public, anon, authenticated;

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
    'tables', private.table_overview_json(v_store.id, true)
  );
end;
$$;

revoke all on function public.pos_table_overview(uuid) from public, anon;
grant execute on function public.pos_table_overview(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Corrigir os dados da conta depois de lançar
-- ---------------------------------------------------------------------------
-- O que não vier no payload fica como está; vazio apaga. Repetir é inofensivo:
-- escreve os mesmos valores.
create or replace function public.update_table_tab_customer(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_device_id uuid;
  v_table_id uuid;
  v_store public.stores%rowtype;
  v_table public.tables%rowtype;
  v_order_ids uuid[];
  v_name text;
  v_phone text;
  v_note text;
begin
  begin
    v_device_id := nullif(p_payload ->> 'deviceId', '')::uuid;
    v_table_id := nullif(p_payload ->> 'tableId', '')::uuid;
  exception when invalid_text_representation then
    raise exception 'invalid_pos_payload' using errcode = 'P0007';
  end;

  v_store := private.pos_device_store(v_device_id);

  select t.* into v_table
  from public.tables t
  where t.id = v_table_id and t.store_id = v_store.id;
  if not found then
    raise exception 'invalid_table' using errcode = 'P0060';
  end if;

  -- O mesmo cadeado do fecho da conta: não se reescreve uma conta a ser fechada.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('table_tab:' || v_table.id::text, 0)
  );

  select array_agg(tab.id) into v_order_ids
  from private.table_tab_order_ids(v_store.id, v_table.id) tab(id);
  if v_order_ids is null then
    raise exception 'table_has_no_open_orders' using errcode = 'P0409';
  end if;

  v_name := case when p_payload ? 'customerName'
    then left(nullif(btrim(p_payload ->> 'customerName'), ''), 60)
    else private.table_tab_name(v_store.id, v_table.id) end;
  v_phone := case when p_payload ? 'customerPhone'
    then private.normalize_phone(left(p_payload ->> 'customerPhone', 30))
    else private.table_tab_phone(v_store.id, v_table.id) end;
  v_note := case when p_payload ? 'tabNote'
    then left(nullif(btrim(p_payload ->> 'tabNote'), ''), 120)
    else private.table_tab_note(v_store.id, v_table.id) end;

  update public.orders
  set customer_name = 'Mesa ' || v_table.number || coalesce(' · ' || v_name, ''),
      customer_phone = v_phone,
      tab_note = v_note
  where id = any(v_order_ids);

  -- Regista-se o que mudou, não o número: o registo não precisa do telefone.
  insert into public.event_log (store_id, actor_user_id, type, payload)
  values (
    v_store.id, v_uid, 'table.tab_customer_updated',
    jsonb_build_object(
      'table_number', v_table.number,
      'device_id', v_device_id,
      'order_count', array_length(v_order_ids, 1),
      'has_name', v_name is not null,
      'has_phone', v_phone is not null,
      'has_note', v_note is not null
    )
  );

  return jsonb_build_object(
    'table_id', v_table.id,
    'table_number', v_table.number,
    'customer_name', v_name,
    'customer_phone', v_phone,
    'tab_note', v_note,
    'order_count', array_length(v_order_ids, 1)
  );
end;
$$;

revoke all on function public.update_table_tab_customer(jsonb) from public, anon;
grant execute on function public.update_table_tab_customer(jsonb) to authenticated;

notify pgrst, 'reload schema';
