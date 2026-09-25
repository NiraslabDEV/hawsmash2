-- 1092 — a mesa com o nome do cliente, e o papel da mesa em vias com a senha.
--
-- Pedido do dono (25 Set):
--
-- 1. "Quando uma pessoa pede na mesa, quero que saia duas cópias do pedido e
--    uma da senha pequena." Até aqui a mesa (1081) imprimia uma comanda só,
--    na cozinha. Passa a imprimir a comanda nas vias da loja — as mesmas das
--    vendas (`stores.kitchen_ticket_copies`, aba POS): com 2, uma no balcão e
--    uma na cozinha — e uma senha pequena no balcão: SENHA em grande, a mesa e
--    o nome. Vale para o que se lança ao balcão e para o que chega pelo QR.
--
-- 2. "Em Maputo vão usar as mesas a mais para pessoas individuais; quando ela
--    colocar o nome de um cliente na mesa, quero no card o nome." O nome é da
--    CONTA, não da mesa: o caixa escreve-o ao lançar, e os pedidos seguintes
--    dessa conta — do balcão ou do QR — herdam-no sem ninguém o repetir. Fica
--    no pedido como "Mesa 5 · João", o mesmo formato que o QR já usava; o
--    cartão da mesa lê-o de lá. Fechada a conta, a mesa volta a não ter nome.
--
-- O papel: a comanda continua no formato herdado (MESA em grande, artigos por
-- pessoa), com o rótulo da via no payload. A senha pequena é um formato novo
-- do @delivery/receipt; um bridge de antes dele cai no formato herdado e
-- imprime o nome e a MESA sem artigos — sai maior, mas sai.
--
-- Forward-only: substitui três funções da 1081 e junta duas.

-- ---------------------------------------------------------------------------
-- O nome da conta aberta
-- ---------------------------------------------------------------------------
-- O último nome escrito na conta de hoje: "Mesa 5 · João" → "João".
create or replace function private.table_tab_name(p_store_id uuid, p_table_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select nome
  from (
    select
      nullif(btrim(regexp_replace(o.customer_name, '^mesa\s+\d+\s*(·\s*)?', '', 'i')), '') as nome,
      o.created_at,
      o.id
    from private.table_tab_order_ids(p_store_id, p_table_id) tab(id)
    join public.orders o on o.id = tab.id
  ) nomes
  where nome is not null
  order by created_at desc, id desc
  limit 1;
$$;

revoke all on function private.table_tab_name(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- A senha pequena
-- ---------------------------------------------------------------------------
create or replace function private.build_table_senha(p_order_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'template', 'senha',
    'store_short_name', s.short_name,
    'daily_number', o.daily_number,
    'table_number', t.number,
    'customer_name', coalesce(nullif(btrim(o.customer_name), ''), 'Mesa ' || t.number),
    'order_number', o.order_number,
    'created_at', o.created_at,
    -- Formato herdado: um bridge sem a senha pequena imprime isto.
    'fulfillment_type', 'dine_in',
    'items', '[]'::jsonb,
    'payment_method', 'no_payment',
    'total_cents', o.total_cents
  )
  from public.orders o
  join public.stores s on s.id = o.store_id
  join public.tables t on t.id = o.table_id
  where o.id = p_order_id;
$$;

revoke all on function private.build_table_senha(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- O papel da mesa: a comanda nas vias da loja, e a senha no balcão
-- ---------------------------------------------------------------------------
create or replace function private.enqueue_table_comanda(p_order_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store_id uuid;
  v_copias integer;
  v_vias text[];
  v_i integer;
  v_station text;
  v_job_id uuid;
  v_primeiro uuid;
begin
  select o.store_id, s.kitchen_ticket_copies
  into v_store_id, v_copias
  from public.orders o
  join public.stores s on s.id = o.store_id
  where o.id = p_order_id and o.table_id is not null;
  if not found then
    return null;
  end if;

  -- A comanda que o motor herdado pôs na fila nesta transacção (pedido pelo
  -- QR) leva o número antigo. Ainda ninguém a viu.
  delete from public.print_jobs pj
  where pj.order_id = p_order_id
    and pj.kind = 'order'
    and pj.status = 'queued'
    and not (pj.payload ? 'template');

  -- As mesmas vias das vendas (1064): com 2, controlo no balcão e a da
  -- cozinha; com 1, só a da cozinha.
  v_vias := case greatest(coalesce(v_copias, 2), 1)
    when 1 then array[null]::text[]
    when 2 then array['controlo', 'cliente']
    else array['controlo', 'cliente', 'cozinha']
  end;

  for v_i in 1 .. array_length(v_vias, 1) loop
    v_station := private.ticket_station(v_vias[v_i]);
    v_job_id := null;
    insert into public.print_jobs (store_id, order_id, station, kind, reprint_seq, payload)
    values (
      v_store_id, p_order_id, v_station, 'order', v_i - 1,
      private.build_table_comanda(p_order_id)
        || jsonb_build_object('via', v_vias[v_i], 'station', v_station)
    )
    on conflict (order_id, station, kind, reprint_seq) do nothing
    returning id into v_job_id;

    if v_job_id is not null then
      v_primeiro := coalesce(v_primeiro, v_job_id);
      insert into public.event_log (order_id, store_id, actor_user_id, type, payload)
      values (p_order_id, v_store_id, (select auth.uid()), 'print.table_comanda_queued',
        jsonb_build_object('job_id', v_job_id, 'station', v_station, 'via', v_vias[v_i]));
    end if;
  end loop;

  -- A senha pequena, no balcão.
  v_job_id := null;
  insert into public.print_jobs (store_id, order_id, station, kind, reprint_seq, payload)
  values (v_store_id, p_order_id, 'counter', 'receipt', 0, private.build_table_senha(p_order_id))
  on conflict (order_id, station, kind, reprint_seq) do nothing
  returning id into v_job_id;

  if v_job_id is not null then
    insert into public.event_log (order_id, store_id, actor_user_id, type, payload)
    values (p_order_id, v_store_id, (select auth.uid()), 'print.table_senha_queued',
      jsonb_build_object('job_id', v_job_id));
  end if;

  return v_primeiro;
end;
$$;

revoke all on function private.enqueue_table_comanda(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- O caixa lança na mesa — agora com o nome da conta
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
    customer_name, subtotal_cents, delivery_fee_cents, total_cents,
    payment_method, notes
  ) values (
    v_store.id, v_order_number, v_daily, v_client_sale_id, v_table.id,
    'in_preparation', 'dine_in', 'dine_in', 'dine_in',
    'Mesa ' || v_table.number || coalesce(' · ' || v_name, ''),
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
-- O pedido pelo QR herda o nome da conta
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
  set customer_name = 'Mesa ' || p_table_number || coalesce(' · ' || v_name, '')
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

notify pgrst, 'reload schema';
