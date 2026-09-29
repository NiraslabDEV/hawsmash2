-- 1077 — extras no balcão, e o que a cozinha tem de ler no talão.
--
-- Pedido do dono (24 Set): o primeiro passo do upsell do balcão pergunta se o
-- cliente quer um extra num dos lanches — queijo, bacon, mais uma carne,
-- jalapeño, picles — e o extra entra NESSE lanche. No talão, EXTRAS e
-- observações saem grandes.
--
-- Não há tabela nova. Os extras são os `menu_addons` de cada produto, que o
-- motor já tem (F8.0), que o painel do Cardápio já edita e que a loja online
-- já vende. Um só sítio para os configurar; o balcão passa a usá-los.
--
-- O que muda:
--
-- 1. create_counter_sale_unlocked aceita `addonIds` por linha. Cada id tem de
--    ser um adicional ACTIVO DESTE produto, sem repetidos; o preço de cada um
--    soma ao da linha, calculado aqui (Regra 2). Nome e preço ficam em
--    order_items.addons — a mesma fotografia que o online grava.
--
-- 2. Acaba o `duplicate_item`. O balcão recusava o mesmo produto em duas
--    linhas — e o carrinho do POS sempre as fez: um Classic HAW e um Classic
--    WAGYU, ou um "sem cebola" e um normal, faziam falhar a venda inteira. Com
--    extras passa a ser o caso de todos os dias: dois Classic, um com queijo.
--    O stock continua certo: cada linha relê e trava a sua linha de
--    store_items na mesma transacção, e o livro de movimentos soma por linha.
--
-- 3. O talão completo (1064) passa a levar, por artigo, a `variant` e os
--    `extras`. A variante nunca lá chegou: desde a 1064 um WAGYU saía no papel
--    como "1x Classic Smash", no balcão e online — a cozinha não o distinguia
--    do HAW. Os adicionais do online também nunca lá chegaram.
--    Uma bridge antiga ignora os dois campos e imprime como antes.
--
-- Fica de fora, de propósito: o extra não baixa matéria-prima (ficha técnica,
-- §10.1). Um queijo extra é custo que o CMV ainda não vê.
--
-- Forward-only: substitui duas funções, sem tocar em dados.

create or replace function public.create_counter_sale_unlocked(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_role text;
  v_device public.devices%rowtype;
  v_store public.stores%rowtype;
  v_existing public.orders%rowtype;
  v_client_sale_id uuid;
  v_item jsonb;
  v_payment jsonb;
  v_resolved_item jsonb;
  v_resolved_items jsonb := '[]'::jsonb;
  v_menu_item_id uuid;
  v_qty integer;
  v_item_row record;
  v_variant record;
  v_variant_name text;
  v_addon record;
  v_addon_id uuid;
  v_addon_text text;
  v_addon_ids uuid[];
  v_addons_snap jsonb;
  v_unit_price integer;
  v_stock_after integer;
  v_subtotal integer := 0;
  v_fulfillment text;
  v_zone_id uuid;
  v_delivery_fee integer := 0;
  v_address text;
  v_scheduled_for timestamptz;
  v_total integer := 0;
  v_payment_total integer := 0;
  v_cash_payment integer := 0;
  v_cash_received integer;
  v_change integer;
  v_payment_method text;
  v_payment_index integer := 0;
  v_day date;
  v_daily integer;
  v_order_number text;
  v_order_id uuid;
  v_expected_total integer;
  v_needs_review boolean := false;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0020';
  end if;

  v_role := private.auth_role();
  if v_role is null or v_role not in ('owner', 'manager', 'cashier') then
    raise exception 'pos_access_denied' using errcode = 'P0403';
  end if;

  begin
    v_client_sale_id := nullif(p_payload ->> 'clientSaleId', '')::uuid;
  exception when invalid_text_representation then
    raise exception 'invalid_client_sale_id' using errcode = 'P0007';
  end;
  if v_client_sale_id is null then
    raise exception 'client_sale_id_required' using errcode = 'P0007';
  end if;

  select d.*
  into v_device
  from public.devices d
  where d.id = nullif(p_payload ->> 'deviceId', '')::uuid
    and d.kind = 'pos'
    and d.active
    and private.auth_can_store(d.store_id);

  if not found then
    raise exception 'invalid_or_unauthorised_device' using errcode = 'P0403';
  end if;

  select s.*
  into v_store
  from public.stores s
  where s.id = v_device.store_id
    and s.active
    and s.counter_enabled;

  if not found then
    raise exception 'counter_disabled' using errcode = 'P0403';
  end if;

  -- Serializa retries concorrentes da mesma venda antes de consultar a chave única.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_client_sale_id::text, 0)
  );

  select o.*
  into v_existing
  from public.orders o
  where o.client_sale_id = v_client_sale_id;

  if found then
    if v_existing.store_id <> v_store.id then
      raise exception 'client_sale_id_store_conflict' using errcode = 'P0409';
    end if;

    return jsonb_build_object(
      'order_id', v_existing.id,
      'order_number', v_existing.order_number,
      'daily_number', v_existing.daily_number,
      'total_cents', v_existing.total_cents,
      'cash_received_cents', v_existing.cash_received_cents,
      'change_cents', v_existing.change_cents,
      'needs_review', v_existing.needs_review,
      'duplicate', true
    );
  end if;

  -- Tipo de pedido. O POS manda counter | pickup | delivery; a coluna so
  -- aceita pickup | delivery, e o balcao e, para efeitos de operacao, um
  -- levantamento imediato. A entrega e que muda o dinheiro.
  v_fulfillment := coalesce(nullif(btrim(p_payload ->> 'fulfillmentType'), ''), 'counter');
  if v_fulfillment not in ('counter', 'pickup', 'delivery') then
    raise exception 'invalid_fulfillment_type' using errcode = 'P0007';
  end if;

  if v_fulfillment = 'delivery' then
    if not v_store.delivery_enabled then
      raise exception 'delivery_disabled' using errcode = 'P0403';
    end if;
    v_zone_id := nullif(btrim(p_payload ->> 'deliveryZoneId'), '')::uuid;
    if v_zone_id is null then
      raise exception 'delivery_zone_required' using errcode = 'P0007';
    end if;
    -- Regra 3: a zona tem de ser DESTA loja. Sem isto, um terminal com a
    -- loja errada no ecra cobrava a taxa da outra unidade.
    select z.fee_cents into v_delivery_fee
    from public.delivery_zones z
    where z.id = v_zone_id and z.store_id = v_store.id and z.active;
    if not found then
      raise exception 'delivery_zone_store_mismatch' using errcode = 'P0401';
    end if;

    -- A morada nao e obrigatoria: ao balcao ha entregas combinadas a voz e o
    -- Regra 1 manda que a venda nunca pare por causa de um campo. Mas quando
    -- vem, vem inteira -- e uma morada de duas letras nao e uma morada.
    v_address := nullif(btrim(p_payload ->> 'address'), '');
    if v_address is not null and length(v_address) > 300 then
      raise exception 'address_too_long' using errcode = 'P0007';
    end if;
  end if;

  if p_payload -> 'items' is null
    or jsonb_typeof(p_payload -> 'items') <> 'array'
    or jsonb_array_length(p_payload -> 'items') = 0
    or jsonb_array_length(p_payload -> 'items') > 100
  then
    raise exception 'invalid_items' using errcode = 'P0007';
  end if;

  for v_item in select value from jsonb_array_elements(p_payload -> 'items')
  loop
    begin
      v_menu_item_id := nullif(v_item ->> 'menuItemId', '')::uuid;
      v_qty := (v_item ->> 'qty')::integer;
    exception when invalid_text_representation then
      raise exception 'invalid_item' using errcode = 'P0007';
    end;

    if v_menu_item_id is null or v_qty is null or v_qty < 1 or v_qty > 99 then
      raise exception 'invalid_item' using errcode = 'P0007';
    end if;
    -- (1077) O mesmo produto pode vir em várias linhas: HAW e WAGYU, com e sem
    -- extra, com e sem nota. Cada linha relê a sua linha de store_items abaixo,
    -- já travada, e por isso vê o stock que a linha anterior deixou.

    select
      mi.name,
      mc.station,
      si.available,
      si.track_stock,
      si.stock_qty,
      coalesce(si.price_cents_override, mi.price_cents) as price_cents
    into v_item_row
    from public.store_items si
    join public.menu_items mi on mi.id = si.menu_item_id
    join public.menu_categories mc on mc.id = mi.category_id
    where si.store_id = v_store.id
      and si.menu_item_id = v_menu_item_id
    for update of si;

    if not found or not v_item_row.available then
      raise exception 'item_unavailable:%', v_menu_item_id using errcode = 'P0014';
    end if;
    if v_item_row.track_stock and v_item_row.stock_qty < v_qty then
      raise exception 'out_of_stock:%', v_menu_item_id using errcode = 'P0014';
    end if;

    -- Variante (HAW/WAGYU): o preço da variante SUBSTITUI o do item base, tal
    -- como o motor da loja online faz (1018). Tem de pertencer a ESTE item.
    v_variant_name := null;
    v_unit_price := v_item_row.price_cents;

    if nullif(btrim(v_item ->> 'variantId'), '') is not null then
      select mv.name, mv.price_cents
      into v_variant
      from public.menu_item_variants mv
      where mv.id = (v_item ->> 'variantId')::uuid
        and mv.menu_item_id = v_menu_item_id
        and mv.active;

      if not found then
        raise exception 'invalid_variant:%', v_item ->> 'variantId'
          using errcode = 'P0015';
      end if;

      v_unit_price := v_variant.price_cents;
      v_variant_name := v_variant.name;
    end if;

    -- Extras (1077): cada um tem de ser um adicional activo DESTE produto.
    -- Sem essa verificação, colar o extra barato de outro produto seria um
    -- desconto que ninguém pediu. O preço vem da tabela, nunca do POS.
    v_addons_snap := '[]'::jsonb;
    v_addon_ids := array[]::uuid[];
    if jsonb_typeof(v_item -> 'addonIds') is not null
      and jsonb_typeof(v_item -> 'addonIds') <> 'null'
    then
      if jsonb_typeof(v_item -> 'addonIds') <> 'array'
        or jsonb_array_length(v_item -> 'addonIds') > 20
      then
        raise exception 'invalid_addons' using errcode = 'P0007';
      end if;

      for v_addon_text in select value from jsonb_array_elements_text(v_item -> 'addonIds')
      loop
        begin
          v_addon_id := nullif(btrim(v_addon_text), '')::uuid;
        exception when invalid_text_representation then
          raise exception 'invalid_addon:%', v_addon_text using errcode = 'P0016';
        end;
        if v_addon_id is null then
          raise exception 'invalid_addon:%', v_addon_text using errcode = 'P0016';
        end if;
        if v_addon_id = any(v_addon_ids) then
          raise exception 'duplicate_addon:%', v_addon_id using errcode = 'P0016';
        end if;
        v_addon_ids := array_append(v_addon_ids, v_addon_id);

        select a.name, a.price_cents
        into v_addon
        from public.menu_addons a
        where a.id = v_addon_id
          and a.menu_item_id = v_menu_item_id
          and a.active;

        if not found then
          raise exception 'invalid_addon:%', v_addon_id using errcode = 'P0016';
        end if;

        v_unit_price := v_unit_price + v_addon.price_cents;
        v_addons_snap := v_addons_snap || jsonb_build_array(
          jsonb_build_object('name', v_addon.name, 'price_cents', v_addon.price_cents)
        );
      end loop;
    end if;

    v_stock_after := null;
    if v_item_row.track_stock then
      update public.store_items si
      set stock_qty = si.stock_qty - v_qty
      where si.store_id = v_store.id
        and si.menu_item_id = v_menu_item_id
        and si.stock_qty >= v_qty
      returning si.stock_qty into v_stock_after;

      if v_stock_after is null then
        raise exception 'out_of_stock:%', v_menu_item_id using errcode = 'P0014';
      end if;
    end if;

    v_subtotal := v_subtotal + (v_unit_price * v_qty);
    v_resolved_items := v_resolved_items || jsonb_build_array(jsonb_build_object(
      'menu_item_id', v_menu_item_id,
      'name', v_item_row.name,
      'station', v_item_row.station,
      'qty', v_qty,
      'unit_price_cents', v_unit_price,
      'variant_name', v_variant_name,
      'addons', v_addons_snap,
      'notes', nullif(btrim(v_item ->> 'notes'), ''),
      'stock_after', v_stock_after
    ));
  end loop;

  if p_payload -> 'payments' is null
    or jsonb_typeof(p_payload -> 'payments') <> 'array'
    or jsonb_array_length(p_payload -> 'payments') = 0
    or jsonb_array_length(p_payload -> 'payments') > 4
  then
    raise exception 'invalid_payments' using errcode = 'P0007';
  end if;

  for v_payment in select value from jsonb_array_elements(p_payload -> 'payments')
  loop
    if v_payment ->> 'method' not in ('cash', 'mpesa', 'emola', 'credit_card') then
      raise exception 'invalid_payment_method' using errcode = 'P0007';
    end if;

    begin
      v_qty := (v_payment ->> 'amountCents')::integer;
    exception when invalid_text_representation then
      raise exception 'invalid_payment_amount' using errcode = 'P0007';
    end;
    if v_qty is null or v_qty <= 0 then
      raise exception 'invalid_payment_amount' using errcode = 'P0007';
    end if;

    if v_payment_method is null then
      v_payment_method := v_payment ->> 'method';
    end if;
    v_payment_total := v_payment_total + v_qty;
    if v_payment ->> 'method' = 'cash' then
      v_cash_payment := v_cash_payment + v_qty;
    end if;
  end loop;

  v_total := v_subtotal + v_delivery_fee;

  if v_payment_total <> v_total then
    raise exception 'payment_total_mismatch' using errcode = 'P0007';
  end if;

  if v_cash_payment > 0 then
    begin
      v_cash_received := (p_payload ->> 'cashReceivedCents')::integer;
    exception when invalid_text_representation then
      raise exception 'invalid_cash_received' using errcode = 'P0007';
    end;
    if v_cash_received is null or v_cash_received < v_cash_payment then
      raise exception 'insufficient_cash_received' using errcode = 'P0007';
    end if;
    v_change := v_cash_received - v_cash_payment;
  else
    v_cash_received := null;
    v_change := null;
  end if;

  if p_payload ? 'expectedTotalCents' then
    begin
      v_expected_total := (p_payload ->> 'expectedTotalCents')::integer;
    exception when invalid_text_representation then
      raise exception 'invalid_expected_total' using errcode = 'P0007';
    end;
    v_needs_review := v_expected_total <> v_total;
  end if;

  -- Hora marcada. O POS manda ISO com o fuso explicito; aqui so se valida
  -- que nao e passado nem daqui a uma semana.
  if nullif(btrim(p_payload ->> 'scheduledFor'), '') is not null then
    begin
      v_scheduled_for := (p_payload ->> 'scheduledFor')::timestamptz;
    exception when others then
      raise exception 'invalid_scheduled_for' using errcode = 'P0007';
    end;
    if v_scheduled_for < now() - interval '5 minutes' then
      raise exception 'scheduled_for_in_past' using errcode = 'P0007';
    end if;
    if v_scheduled_for > now() + interval '7 days' then
      raise exception 'scheduled_for_too_far' using errcode = 'P0007';
    end if;
  end if;

  v_day := (now() at time zone 'Africa/Maputo')::date;
  insert into public.order_counters (store_id, day, seq)
  values (v_store.id, v_day, 1)
  on conflict (store_id, day) do update
    set seq = public.order_counters.seq + 1
  returning seq into v_daily;

  v_order_number := private.next_order_number(v_store.id);

  perform set_config('app.request_store_id', v_store.id::text, true);

  insert into public.orders (
    store_id, order_number, daily_number, client_sale_id, delivery_zone_id,
    status, flow, fulfillment_type, channel,
    customer_name, customer_phone, customer_email,
    subtotal_cents, delivery_fee_cents, total_cents,
    payment_method, cash_received_cents, change_cents,
    needs_review, notes, scheduled_for, address
  ) values (
    v_store.id, v_order_number, v_daily, v_client_sale_id, v_zone_id,
    'paid', 'manual',
    case when v_fulfillment = 'delivery' then 'delivery' else 'pickup' end,
    'counter',
    coalesce(nullif(btrim(p_payload ->> 'customerName'), ''), 'Balcão'),
    nullif(btrim(p_payload ->> 'customerPhone'), ''),
    nullif(btrim(p_payload ->> 'customerEmail'), ''),
    v_subtotal, v_delivery_fee, v_total,
    v_payment_method, v_cash_received, v_change,
    v_needs_review, nullif(btrim(p_payload ->> 'notes'), ''), v_scheduled_for,
    v_address
  )
  returning id into v_order_id;

  for v_resolved_item in select value from jsonb_array_elements(v_resolved_items)
  loop
    insert into public.order_items (
      order_id, store_id, menu_item_id, name_snapshot,
      qty, unit_price_cents, station, notes, variant_name_snapshot, addons
    ) values (
      v_order_id,
      v_store.id,
      (v_resolved_item ->> 'menu_item_id')::uuid,
      v_resolved_item ->> 'name',
      (v_resolved_item ->> 'qty')::integer,
      (v_resolved_item ->> 'unit_price_cents')::integer,
      v_resolved_item ->> 'station',
      v_resolved_item ->> 'notes',
      v_resolved_item ->> 'variant_name',
      coalesce(v_resolved_item -> 'addons', '[]'::jsonb)
    );

    -- O movimento fica ligado ao pedido; sem pedido não haveria a que o ligar.
    if v_resolved_item ->> 'stock_after' is not null then
      perform private.record_stock_movement(
        v_store.id,
        (v_resolved_item ->> 'menu_item_id')::uuid,
        -(v_resolved_item ->> 'qty')::integer,
        'sale',
        v_order_id,
        null,
        (v_resolved_item ->> 'stock_after')::integer
      );
    end if;
  end loop;

  for v_payment in select value from jsonb_array_elements(p_payload -> 'payments')
  loop
    v_payment_index := v_payment_index + 1;
    insert into public.payments (
      order_id, store_id, provider, method, amount_cents,
      status, idempotency_key
    ) values (
      v_order_id,
      v_store.id,
      'counter',
      v_payment ->> 'method',
      (v_payment ->> 'amountCents')::integer,
      'confirmed',
      'counter:' || v_client_sale_id::text || ':' || v_payment_index::text
    );
  end loop;

  if not exists (
    select 1 from public.cash_sessions cs
    where cs.store_id = v_store.id and cs.closed_at is null
  ) then
    insert into public.cash_sessions (store_id, opened_by)
    values (v_store.id, v_uid);

    insert into public.event_log (store_id, actor_user_id, type, payload)
    values (
      v_store.id,
      v_uid,
      'cash.session_auto_opened',
      jsonb_build_object('source', 'counter_sale')
    );
  end if;

  insert into public.event_log (
    order_id, store_id, actor_user_id, type, payload
  ) values (
    v_order_id,
    v_store.id,
    v_uid,
    'counter.sale_created',
    jsonb_build_object(
      'client_sale_id', v_client_sale_id,
      'device_id', v_device.id,
      'total_cents', v_total,
      'needs_review', v_needs_review
    )
  );

  update public.devices
  set last_seen_at = now()
  where id = v_device.id;

  return jsonb_build_object(
    'order_id', v_order_id,
    'order_number', v_order_number,
    'daily_number', v_daily,
    'total_cents', v_total,
    'cash_received_cents', v_cash_received,
    'change_cents', v_change,
    'needs_review', v_needs_review,
    'duplicate', false
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- O talão completo: igual à 1064, mais a variante e os extras de cada artigo
-- ---------------------------------------------------------------------------
create or replace function private.build_full_ticket_payload(p_order_id uuid, p_via text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'template', 'kitchen',
    'formato', 'talao_completo',
    'via', p_via,
    'station', 'kitchen',
    'store_short_name', s.short_name,
    'store_address', s.address,
    'store_phone', s.phone,
    'receipt_footer', s.receipt_footer,
    'order_number', o.order_number,
    'daily_number', o.daily_number,
    'channel', o.channel,
    'fulfillment_type', o.fulfillment_type,
    'customer_name', case
      when o.channel = 'counter' and o.customer_name = 'Balcão' then null
      else o.customer_name
    end,
    'customer_phone', o.customer_phone,
    'address', o.address,
    'delivery_zone', (
      select z.name from public.delivery_zones z where z.id = o.delivery_zone_id
    ),
    'scheduled_for', o.scheduled_for,
    'items', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'name', oi.name_snapshot,
          'variant', oi.variant_name_snapshot,
          'extras', (
            select coalesce(jsonb_agg(a.value ->> 'name' order by a.ordinality), '[]'::jsonb)
            from jsonb_array_elements(
              case when jsonb_typeof(oi.addons) = 'array' then oi.addons else '[]'::jsonb end
            ) with ordinality as a(value, ordinality)
            where nullif(btrim(a.value ->> 'name'), '') is not null
          ),
          'quantity', oi.qty,
          'notes', oi.notes,
          'line_total_cents', oi.unit_price_cents * oi.qty
        ) order by oi.id
      ), '[]'::jsonb)
      from public.order_items oi
      where oi.order_id = o.id
        and oi.store_id = o.store_id
    ),
    'notes', o.notes,
    'subtotal_cents', o.subtotal_cents,
    'delivery_fee_cents', o.delivery_fee_cents,
    'discount_cents', o.discount_cents,
    'total_cents', o.total_cents,
    'payment_method', o.payment_method,
    'payments', (
      select coalesce(jsonb_agg(
        jsonb_build_object('method', p.method, 'amount_cents', p.amount_cents)
        order by p.created_at, p.id
      ), '[]'::jsonb)
      from public.payments p
      where p.order_id = o.id
        and p.store_id = o.store_id
        and p.status = 'confirmed'
    ),
    'cash_received_cents', o.cash_received_cents,
    'change_cents', o.change_cents,
    'review_url', nullif(btrim(coalesce(b.social ->> 'google_review', '')), ''),
    'instagram', nullif(btrim(coalesce(b.contact ->> 'instagram', '')), ''),
    'instagram_url', nullif(btrim(coalesce(b.social ->> 'instagram', '')), ''),
    'created_at', o.created_at
  )
  from public.orders o
  join public.stores s on s.id = o.store_id
  left join public.brand_settings b on b.id = 1
  where o.id = p_order_id;
$$;

revoke all on function private.build_full_ticket_payload(uuid, text)
  from public, anon, authenticated;

notify pgrst, 'reload schema';
