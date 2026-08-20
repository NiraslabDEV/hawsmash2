-- HAWSMASH 2.0 — 1013: repor a validação de horário por cima da numeração.
--
-- A 1012 corrigiu a numeração mas escreveu-a no sítio errado: substituiu o
-- `public.create_order`, que é a **camada de validação de horário** da loja
-- (migration 1004_store_hours_validation), e não a camada de numeração
-- (`private.create_order_store_legacy`). Resultado apanhado pelos testes: o
-- agendamento deixou de ser validado contra `store_hours` e voltou a bater no
-- horário global do motor herdado, em UTC.
--
-- Esta migration põe cada coisa no seu andar:
--   public.create_order            → valida horário da loja (Africa/Maputo)
--   private.create_order_store_legacy → numeração contínua + número do dia
--   private.create_order_legacy    → motor herdado (itens, cliente, totais)

create or replace function private.create_order_store_legacy(
  p_store_slug text,
  p_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store public.stores%rowtype;
  v_item jsonb;
  v_store_item record;
  v_zone_id uuid;
  v_order_id uuid;
  v_day date;
  v_daily integer;
  v_order_number text;
  v_subtotal integer;
begin
  select s.*
  into v_store
  from public.stores s
  where s.slug = p_store_slug
    and s.active;

  if not found then
    raise exception 'store_not_found' using errcode = 'P0404';
  end if;

  if not v_store.accepting_orders then
    raise exception 'store_not_accepting_orders' using errcode = 'P0403';
  end if;

  if p_payload ->> 'fulfillmentType' = 'delivery' then
    if not v_store.delivery_enabled then
      raise exception 'delivery_disabled' using errcode = 'P0403';
    end if;

    v_zone_id := nullif(p_payload ->> 'deliveryZoneId', '')::uuid;
    if v_zone_id is null then
      raise exception 'delivery_zone_required' using errcode = 'P0007';
    end if;
    if not exists (
      select 1
      from public.delivery_zones z
      where z.id = v_zone_id
        and z.store_id = v_store.id
        and z.active
    ) then
      raise exception 'delivery_zone_store_mismatch' using errcode = 'P0401';
    end if;
  elsif p_payload ->> 'fulfillmentType' = 'pickup' and not v_store.pickup_enabled then
    raise exception 'pickup_disabled' using errcode = 'P0403';
  end if;

  for v_item in select value from jsonb_array_elements(p_payload -> 'items')
  loop
    select
      si.available,
      si.track_stock,
      si.stock_qty,
      coalesce(si.price_cents_override, mi.price_cents) as effective_price_cents,
      mi.price_cents as catalog_price_cents,
      mi.is_gift
    into v_store_item
    from public.store_items si
    join public.menu_items mi on mi.id = si.menu_item_id
    where si.store_id = v_store.id
      and si.menu_item_id = (v_item ->> 'menuItemId')::uuid;

    if not found
      or not v_store_item.available
      or (v_store_item.track_stock and v_store_item.stock_qty < (v_item ->> 'qty')::integer)
    then
      raise exception 'item_unavailable:%', v_item ->> 'menuItemId' using errcode = 'P0014';
    end if;
  end loop;

  perform set_config('app.request_store_id', v_store.id::text, true);
  v_order_id := private.create_order_legacy(p_payload);

  -- O motor herdado calcula extras/variantes. O override altera apenas a
  -- componente do preço base, preservando esses adicionais.
  update public.order_items oi
  set unit_price_cents = case
    when mi.is_gift and oi.unit_price_cents = 0 then 0
    else oi.unit_price_cents + coalesce(si.price_cents_override, mi.price_cents) - mi.price_cents
  end
  from public.menu_items mi
  join public.store_items si
    on si.menu_item_id = mi.id
   and si.store_id = v_store.id
  where oi.order_id = v_order_id
    and oi.menu_item_id = mi.id;

  select coalesce(sum(oi.unit_price_cents * oi.qty), 0)::integer
  into v_subtotal
  from public.order_items oi
  where oi.order_id = v_order_id;

  -- Número do dia (reinicia todos os dias, por loja) — é o que sai grande no
  -- talão e o que a TV de senhas chama.
  v_day := (now() at time zone 'Africa/Maputo')::date;
  insert into public.order_counters (store_id, day, seq)
  values (v_store.id, v_day, 1)
  on conflict (store_id, day) do update
    set seq = public.order_counters.seq + 1
  returning seq into v_daily;

  -- Número do pedido (contínuo por loja, nunca reinicia).
  v_order_number := private.next_order_number(v_store.id);

  update public.orders
  set order_number = v_order_number,
      daily_number = v_daily,
      subtotal_cents = v_subtotal,
      total_cents = greatest(0, v_subtotal - coalesce(discount_cents, 0) + delivery_fee_cents)
  where id = v_order_id;

  update public.event_log
  set payload = payload || jsonb_build_object(
    'order_number', v_order_number,
    'daily_number', v_daily,
    'total_cents', (
      select o.total_cents from public.orders o where o.id = v_order_id
    )
  )
  where order_id = v_order_id
    and type = 'order.created';

  return v_order_id;
end;
$$;

revoke all on function private.create_order_store_legacy(text, jsonb)
  from public, anon, authenticated;

create or replace function public.create_order(
  p_store_slug text,
  p_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store_id uuid;
  v_scheduled_for timestamptz;
  v_local_scheduled timestamp;
  v_slot_minutes integer;
  v_order_id uuid;
begin
  select s.id
  into v_store_id
  from public.stores s
  where s.slug = p_store_slug
    and s.active;

  if not found then
    raise exception 'store_not_found' using errcode = 'P0404';
  end if;

  if nullif(p_payload ->> 'scheduledFor', '') is not null then
    v_scheduled_for := (p_payload ->> 'scheduledFor')::timestamptz;

    if v_scheduled_for <= now() then
      raise exception 'scheduled_for_must_be_future' using errcode = 'P0010';
    end if;

    v_local_scheduled := v_scheduled_for at time zone 'Africa/Maputo';

    select s.slot_minutes
    into v_slot_minutes
    from public.settings s
    where s.id = 1;

    if extract(minute from v_local_scheduled)::integer % v_slot_minutes <> 0 then
      raise exception 'scheduled_for_invalid_slot' using errcode = 'P0012';
    end if;

    if not exists (
      select 1
      from public.store_hours h
      where h.store_id = v_store_id
        and h.active
        and h.dow = extract(dow from v_local_scheduled)::integer
        and v_local_scheduled::time >= h.opens
        and v_local_scheduled::time < h.closes
    ) then
      raise exception 'scheduled_for_outside_hours' using errcode = 'P0011';
    end if;
  end if;

  -- A validação global antiga não pode voltar a contradizer o horário da loja.
  v_order_id := private.create_order_store_legacy(
    p_store_slug,
    p_payload - 'scheduledFor'
  );

  if v_scheduled_for is not null then
    update public.orders
    set scheduled_for = v_scheduled_for
    where id = v_order_id;
  end if;

  return v_order_id;
end;
$$;

revoke all on function public.create_order(text, jsonb) from public;
grant execute on function public.create_order(text, jsonb)
  to anon, authenticated, service_role;
