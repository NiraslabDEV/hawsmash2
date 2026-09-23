-- HAWSMASH 2.0 — 1064: um só papel para todos os pedidos — o talão completo, em vias.
--
-- Decisão do dono (23 Set), depois de ver o talão do pedido online em papel:
-- é esse o papel da casa, para tudo. Balcão, levantamento ou entrega saem
-- sempre só em dois talões completos — a VIA DE CONTROLO fica na loja, a VIA
-- DO CLIENTE vai para a cozinha e depois cola-se no saco. Acabam o talão curto
-- do cliente e a comanda curta da cozinha.
--
-- O que muda em relação à 1063:
--   · o balcão passa a sair como o online. O talão completo aprende o que só
--     o balcão tem: pagamento misto, dinheiro recebido e troco (§7.3). Uma
--     venda sem nome grava 'Balcão' em customer_name (create_counter_sale
--     _unlocked); isso não é o nome de ninguém e não vai para o papel;
--   · a via de controlo vai para a impressora do balcão e a via do cliente
--     para a da cozinha. Numa loja com uma só impressora (o HAWSMASH hoje),
--     as duas saem no mesmo sítio; numa com duas, cada via sai onde é precisa;
--   · reimprimir sai UM talão completo, marcado REIMPRESSÃO. É o que impede
--     uma reimpressão de passar por original (§7.4).
--
-- A gaveta não muda: continua a abrir pelo trabalho `drawer` que a venda em
-- dinheiro já cria.
--
-- Compatibilidade como na 1063: o payload continua `template: 'kitchen'`. Uma
-- bridge antiga imprime a comanda curta em cada via; a nova imprime o talão.

comment on column public.stores.kitchen_ticket_copies is
  'Vias do talão completo de cada pedido, de balcão ou online: 1 = uma via sem rótulo; 2 = controlo + cliente; 3 = controlo + cliente + cozinha. Uma reimpressão sai sempre como um talão só, marcado.';

-- ---------------------------------------------------------------------------
-- O talão completo — o único papel da casa
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

-- Onde sai cada via: a de controlo fica ao balcão, as outras vão à cozinha.
create or replace function private.ticket_station(p_via text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_via = 'controlo' then 'counter' else 'kitchen' end;
$$;

revoke all on function private.ticket_station(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- A peça que põe papel na fila — agora igual para todos os canais
-- ---------------------------------------------------------------------------
create or replace function private.enqueue_kitchen_tickets(p_order_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store_id uuid;
  v_channel text;
  v_copias integer;
  v_vias text[];
  v_i integer;
  v_station text;
  v_job_id uuid;
  v_criados integer := 0;
begin
  select o.store_id, o.channel, s.kitchen_ticket_copies
  into v_store_id, v_channel, v_copias
  from public.orders o
  join public.stores s on s.id = o.store_id
  where o.id = p_order_id;

  if not found or v_channel = 'dine_in' then
    return 0;
  end if;

  -- A comanda no formato antigo que o motor herdado acabou de pôr na fila,
  -- nesta mesma transacção. Ainda ninguém a viu.
  delete from public.print_jobs pj
  where pj.order_id = p_order_id
    and pj.kind = 'order'
    and pj.status = 'queued'
    and not (pj.payload ? 'template');

  v_vias := case greatest(coalesce(v_copias, 2), 1)
    when 1 then array[null]::text[]
    when 2 then array['controlo', 'cliente']
    else array['controlo', 'cliente', 'cozinha']
  end;

  for v_i in 1 .. array_length(v_vias, 1) loop
    v_station := private.ticket_station(v_vias[v_i]);
    v_job_id := null;
    insert into public.print_jobs (
      store_id, order_id, station, kind, reprint_seq, payload
    ) values (
      v_store_id,
      p_order_id,
      v_station,
      'order',
      v_i - 1,
      private.build_full_ticket_payload(p_order_id, v_vias[v_i])
        || jsonb_build_object('station', v_station)
    )
    on conflict (order_id, station, kind, reprint_seq) do nothing
    returning id into v_job_id;

    if v_job_id is not null then
      v_criados := v_criados + 1;
      insert into public.event_log (order_id, store_id, actor_user_id, type, payload)
      values (p_order_id, v_store_id, (select auth.uid()), 'print.sale_job_queued',
        jsonb_build_object('job_id', v_job_id, 'kind', 'order', 'station', v_station,
          'via', v_vias[v_i]));
    end if;
  end loop;

  return v_criados;
end;
$$;

revoke all on function private.enqueue_kitchen_tickets(uuid)
  from public, anon, authenticated;

-- O talão do online da 1063 foi absorvido pelo talão completo.
drop function if exists private.build_online_ticket_payload(uuid, text);

-- ---------------------------------------------------------------------------
-- Venda de balcão: a partir da 1062, sem o talão curto do cliente
-- ---------------------------------------------------------------------------
create or replace function public.create_counter_sale(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_order_id uuid;
  v_store_id uuid;
  v_uid uuid := (select auth.uid());
  v_customer_phone text;
  v_customer_name text;
begin
  v_result := public.create_counter_sale_without_tickets(p_payload);
  v_order_id := (v_result ->> 'order_id')::uuid;

  select o.store_id, o.customer_phone
  into v_store_id, v_customer_phone
  from public.orders o
  where o.id = v_order_id;

  -- Do payload, não de orders.customer_name: essa coluna já caiu para
  -- 'Balcão' quando ninguém escreveu nome nenhum (create_counter_sale
  -- _unlocked), e 'Balcão' não é o nome de ninguém — gravá-lo em `customers`
  -- apagaria o nome real de quem só desta vez não o repetiu.
  v_customer_name := nullif(btrim(p_payload ->> 'customerName'), '');

  if v_customer_phone is not null then
    begin
      perform public.identify_customer(v_customer_phone, v_customer_name);
    exception when others then
      insert into public.event_log (
        order_id, store_id, actor_user_id, type, payload
      ) values (
        v_order_id,
        v_store_id,
        v_uid,
        'customer.identify_failed',
        jsonb_build_object('error', sqlstate)
      );
    end;
  end if;

  -- O papel é best-effort (regra 1): se falhar, a venda fica e o motivo
  -- fica no registo.
  begin
    perform private.enqueue_kitchen_tickets(v_order_id);
  exception when others then
    begin
      insert into public.event_log (
        order_id, store_id, actor_user_id, type, payload
      ) values (
        v_order_id,
        v_store_id,
        v_uid,
        'print.sale_enqueue_failed',
        jsonb_build_object('error', sqlstate)
      );
    exception when others then
      null;
    end;
  end;

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reimpressão: a partir da f3_reprint, sempre um talão completo marcado
-- ---------------------------------------------------------------------------
create or replace function public.reprint(
  p_order_id uuid,
  p_kind text,
  p_request_id uuid default gen_random_uuid()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_role text := private.auth_role();
  v_order public.orders%rowtype;
  v_station text;
  v_seq integer;
  v_job_id uuid;
  v_job_ids jsonb := '[]'::jsonb;
  v_existing_ids jsonb;
  v_existing_seq integer;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0020';
  end if;
  if v_role is null or v_role not in ('owner', 'manager', 'cashier') then
    raise exception 'reprint_access_denied' using errcode = 'P0403';
  end if;
  if p_kind not in ('order', 'receipt') then
    raise exception 'invalid_reprint_kind' using errcode = 'P0007';
  end if;
  if p_request_id is null then
    raise exception 'reprint_request_id_required' using errcode = 'P0007';
  end if;

  select o.*
  into v_order
  from public.orders o
  where o.id = p_order_id
    and private.auth_can_store(o.store_id);

  if not found then
    raise exception 'order_not_found_or_unauthorised' using errcode = 'P0404';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_order.store_id::text || ':' || p_order_id::text || ':' || p_kind || ':' || p_request_id::text,
      0
    )
  );

  select jsonb_agg(pj.id order by pj.station), min(pj.reprint_seq)
  into v_existing_ids, v_existing_seq
  from public.print_jobs pj
  where pj.store_id = v_order.store_id
    and pj.order_id = p_order_id
    and pj.kind = p_kind
    and pj.request_id = p_request_id;

  if v_existing_ids is not null then
    return jsonb_build_object(
      'job_ids', v_existing_ids,
      'request_id', p_request_id,
      'reprint_seq', v_existing_seq,
      'duplicate', true
    );
  end if;

  select coalesce(max(pj.reprint_seq), 0) + 1
  into v_seq
  from public.print_jobs pj
  where pj.store_id = v_order.store_id
    and pj.order_id = p_order_id
    and pj.kind = p_kind;

  if v_order.channel <> 'dine_in' then
    -- Um talão completo, com o rótulo REIMPRESSÃO: sai onde o botão pediu —
    -- "2.ª via cliente" ao balcão, "reimprimir cozinha" na cozinha.
    v_station := case when p_kind = 'receipt' then 'counter' else 'kitchen' end;
    insert into public.print_jobs (
      store_id, order_id, request_id, station, kind, reprint_seq, payload
    ) values (
      v_order.store_id,
      p_order_id,
      p_request_id,
      v_station,
      p_kind,
      v_seq,
      private.build_full_ticket_payload(p_order_id, 'reimpressao')
        || jsonb_build_object('station', v_station)
    )
    returning id into v_job_id;
    v_job_ids := v_job_ids || jsonb_build_array(v_job_id);
  elsif p_kind = 'receipt' then
    insert into public.print_jobs (
      store_id, order_id, request_id, station, kind, reprint_seq, payload
    ) values (
      v_order.store_id,
      p_order_id,
      p_request_id,
      'counter',
      'receipt',
      v_seq,
      private.build_sale_print_payload(p_order_id, 'receipt', null)
    )
    returning id into v_job_id;
    v_job_ids := v_job_ids || jsonb_build_array(v_job_id);
  else
    for v_station in
      select distinct case
        when oi.station = 'cold_kitchen' then 'kitchen'
        else oi.station
      end
      from public.order_items oi
      where oi.order_id = p_order_id
        and oi.store_id = v_order.store_id
    loop
      insert into public.print_jobs (
        store_id, order_id, request_id, station, kind, reprint_seq, payload
      ) values (
        v_order.store_id,
        p_order_id,
        p_request_id,
        v_station,
        'order',
        v_seq,
        private.build_sale_print_payload(p_order_id, 'order', v_station)
      )
      returning id into v_job_id;
      v_job_ids := v_job_ids || jsonb_build_array(v_job_id);
    end loop;

    if jsonb_array_length(v_job_ids) = 0 then
      raise exception 'order_has_no_printable_items' using errcode = 'P0007';
    end if;
  end if;

  insert into public.event_log (
    order_id, store_id, actor_user_id, type, payload
  ) values (
    p_order_id,
    v_order.store_id,
    v_uid,
    'print.reprinted',
    jsonb_build_object(
      'kind', p_kind,
      'request_id', p_request_id,
      'reprint_seq', v_seq,
      'job_ids', v_job_ids
    )
  );

  return jsonb_build_object(
    'job_ids', v_job_ids,
    'request_id', p_request_id,
    'reprint_seq', v_seq,
    'duplicate', false
  );
end;
$$;

revoke all on function public.reprint(uuid, text, uuid) from public, anon;
grant execute on function public.reprint(uuid, text, uuid) to authenticated;
