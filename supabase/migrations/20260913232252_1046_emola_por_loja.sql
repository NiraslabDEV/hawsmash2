-- 1046: e-Mola online por loja, independente do M-Pesa directo.
-- DECISÃO: NULL preserva o gateway redirect existente; em M-Pesa directo significa manual.
-- Nenhuma instalação passa a cobrar por aplicar esta migration. Activação explícita pelo dono.
alter table public.stores add column if not exists emola_provider text;
alter table public.stores drop constraint if exists stores_emola_provider_check;
alter table public.stores add constraint stores_emola_provider_check
  check (emola_provider is null or emola_provider in ('manual', 'mock', 'paysuite'));
grant select (emola_provider) on public.stores to authenticated;
-- Escritas de loja passam pelas RPCs auditadas. O grant antigo de tabela
-- deixava o dono contornar a protecção de pagamentos pendentes por REST.
revoke insert, update on public.stores from public, anon, authenticated;

create or replace function private.payment_mode(p_provider text, p_emola_provider text, p_method text)
returns text language sql immutable security invoker set search_path = '' as $$
  select case
    when p_method = 'emola' then case when coalesce(p_emola_provider, p_provider) in ('paysuite', 'mock')
      then coalesce(p_emola_provider, p_provider) else 'manual' end
    when p_method = 'mpesa' and p_provider in ('mpesa', 'mpesa_sim') then p_provider
    when p_method in ('mpesa', 'credit_card') and p_provider in ('paysuite', 'mock') then p_provider
    else 'manual' end;
$$;
revoke all on function private.payment_mode(text,text,text) from public, anon, authenticated;

create or replace function public.get_menu(
  p_store_slug text,
  p_channel text default null,
  p_include_unavailable boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_store public.stores%rowtype;
  v_legacy jsonb;
  v_categories jsonb := '[]'::jsonb;
  v_items jsonb;
  v_category jsonb;
  v_item jsonb;
  v_store_item record;
  v_available boolean;
begin
  -- O cardápio alargado (com esgotados) é ferramenta de operação, não de loja.
  if p_include_unavailable and (select auth.uid()) is null then
    raise exception 'menu_scope_requires_auth' using errcode = 'P0403';
  end if;

  select s.*
  into v_store
  from public.stores s
  where s.slug = p_store_slug
    and s.active;

  if not found then
    raise exception 'store_not_found' using errcode = 'P0404';
  end if;

  v_legacy := private.get_menu_legacy(p_channel);

  for v_category in
    select value from jsonb_array_elements(v_legacy -> 'categories')
  loop
    v_items := '[]'::jsonb;

    for v_item in
      select value from jsonb_array_elements(v_category -> 'items')
    loop
      select
        si.available,
        si.track_stock,
        si.stock_qty,
        coalesce(si.price_cents_override, mi.price_cents) as effective_price_cents
      into v_store_item
      from public.store_items si
      join public.menu_items mi on mi.id = si.menu_item_id
      where si.store_id = v_store.id
        and si.menu_item_id = (v_item ->> 'id')::uuid;

      if found then
        v_available := v_store_item.available
          and (not v_store_item.track_stock or v_store_item.stock_qty > 0);

        if v_available or p_include_unavailable then
          v_items := v_items || jsonb_build_array(
            v_item || jsonb_build_object(
              'price_cents', v_store_item.effective_price_cents,
              'available', v_available
            ) || case
              when p_include_unavailable then jsonb_build_object(
                'track_stock', v_store_item.track_stock,
                'stock_qty', case when v_store_item.track_stock then v_store_item.stock_qty end
              )
              else '{}'::jsonb
            end
          );
        end if;
      end if;
    end loop;

    if jsonb_array_length(v_items) > 0 then
      v_categories := v_categories || jsonb_build_array(
        (v_category - 'items') || jsonb_build_object('items', v_items)
      );
    end if;
  end loop;

  return (v_legacy - array[
    'accepting_orders', 'payment_provider',
    'mpesa_number', 'mpesa_name', 'emola_number', 'emola_name',
    'categories', 'zones'
  ]) || jsonb_build_object(
    'store', jsonb_build_object(
      'id', v_store.id,
      'slug', v_store.slug,
      'name', v_store.name,
      'short_name', v_store.short_name,
      'address', v_store.address,
      'maps_url', v_store.maps_url,
      'phone', v_store.phone,
      'delivery_enabled', v_store.delivery_enabled,
      'pickup_enabled', v_store.pickup_enabled,
      'counter_enabled', v_store.counter_enabled
    ),
    'accepting_orders', v_store.accepting_orders,
    'payment_provider', v_store.payment_provider,
    'emola_provider', v_store.emola_provider,
    'mpesa_number', v_store.mpesa_number,
    'mpesa_name', v_store.mpesa_name,
    'emola_number', v_store.emola_number,
    'emola_name', v_store.emola_name,
    'categories', v_categories,
    'zones', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', z.id,
        'name', z.name,
        'fee_cents', z.fee_cents,
        'sort', z.sort
      ) order by z.sort), '[]'::jsonb)
      from public.delivery_zones z
      where z.store_id = v_store.id and z.active
    ),
    'hours', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'dow', h.dow,
        'opens', h.opens,
        'closes', h.closes,
        'active', h.active
      ) order by h.dow), '[]'::jsonb)
      from public.store_hours h
      where h.store_id = v_store.id
    )
  );
end;
$$;

create or replace function private.store_admin_json(p_store_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_store public.stores%rowtype;
  v_missing text[] := array[]::text[];
begin
  select s.* into v_store from public.stores s where s.id = p_store_id;
  if not found then
    raise exception 'store_not_found' using errcode = 'P0404';
  end if;

  -- O que ainda falta para a loja poder aceitar pedidos com segurança.
  if not exists (
    select 1 from public.store_hours h where h.store_id = v_store.id and h.active
  ) then
    v_missing := array_append(v_missing, 'hours');
  end if;
  if v_store.delivery_enabled and not exists (
    select 1 from public.delivery_zones z where z.store_id = v_store.id and z.active
  ) then
    v_missing := array_append(v_missing, 'zones');
  end if;
  if coalesce(btrim(v_store.mpesa_number), '') = ''
    and coalesce(btrim(v_store.emola_number), '') = ''
  then
    v_missing := array_append(v_missing, 'payment');
  end if;
  if coalesce(btrim(v_store.receipt_footer), '') = '' then
    v_missing := array_append(v_missing, 'receipt_footer');
  end if;

  return jsonb_build_object(
    'id', v_store.id,
    'slug', v_store.slug,
    'name', v_store.name,
    'short_name', v_store.short_name,
    'order_prefix', v_store.order_prefix,
    'active', v_store.active,
    'accepting_orders', v_store.accepting_orders,
    'address', v_store.address,
    'maps_url', v_store.maps_url,
    'phone', v_store.phone,
    'owner_email', v_store.owner_email,
    'delivery_enabled', v_store.delivery_enabled,
    'pickup_enabled', v_store.pickup_enabled,
    'counter_enabled', v_store.counter_enabled,
    'mpesa_number', v_store.mpesa_number,
    'mpesa_name', v_store.mpesa_name,
    'emola_number', v_store.emola_number,
    'emola_name', v_store.emola_name,
    'payment_provider', v_store.payment_provider,
    'emola_provider', v_store.emola_provider,
    'receipt_header', v_store.receipt_header,
    'receipt_footer', v_store.receipt_footer,
    'sort', v_store.sort,
    'missing', to_jsonb(v_missing)
  );
end;
$$;

create or replace function public.get_store_payment_status(p_store_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  if not coalesce((select private.auth_is_owner()), false) then
    raise exception 'forbidden' using errcode = 'P0403';
  end if;

  select jsonb_build_object(
    'store_id', s.id,
    'payment_provider', s.payment_provider,
    'emola_provider', s.emola_provider,
    -- Booleanos, não valores. É tudo o que o painel precisa de saber para
    -- dizer "falta preencher" sem nunca pôr um segredo no browser.
    'paysuite', jsonb_build_object(
      'api_key', coalesce(btrim(s.paysuite_api_key), '') <> '',
      'webhook_secret', coalesce(btrim(s.paysuite_webhook_secret), '') <> ''
    ),
    'mpesa', jsonb_build_object(
      'api_key', coalesce(btrim(s.mpesa_api_key), '') <> '',
      'public_key', coalesce(btrim(s.mpesa_public_key), '') <> '',
      'service_provider_code', coalesce(btrim(s.mpesa_service_provider_code), '') <> '',
      'session_base_url', coalesce(btrim(s.mpesa_session_base_url), '') <> '',
      'charge_base_url', coalesce(btrim(s.mpesa_charge_base_url), '') <> '',
      'query_base_url', coalesce(btrim(s.mpesa_query_base_url), '') <> ''
    ),
    -- Número mostrado ao cliente no fluxo manual (não é credencial).
    'mpesa_number', s.mpesa_number,
    'emola_number', s.emola_number
  )
  into v
  from public.stores s
  where s.id = p_store_id;

  if v is null then
    raise exception 'store_not_found' using errcode = 'P0002';
  end if;

  return v;
end;
$$;

create or replace function public.save_store_payment(p_store_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_provider text;
  v_emola_provider text;
  v_existing public.stores%rowtype;
  v_mudou text[] := '{}';
  v_chave text;
begin
  if not coalesce((select private.auth_is_owner()), false) then
    raise exception 'forbidden' using errcode = 'P0403';
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'invalid_payload' using errcode = 'P0400';
  end if;

  if jsonb_exists(p_payload, 'payment_provider') then
    v_provider := btrim(coalesce(p_payload ->> 'payment_provider', ''));
    if v_provider not in ('manual', 'mock', 'paysuite', 'mpesa', 'mpesa_sim') then
      raise exception 'invalid_payment_provider' using errcode = 'P0400';
    end if;
  end if;

  select s.* into v_existing from public.stores s where s.id = p_store_id for update;
  if not found then raise exception 'store_not_found' using errcode = 'P0002'; end if;

  if jsonb_exists(p_payload, 'emola_provider') then
    v_emola_provider := nullif(btrim(p_payload ->> 'emola_provider'), '');
    if v_emola_provider is not null and v_emola_provider not in ('manual', 'mock', 'paysuite') then
      raise exception 'invalid_emola_provider' using errcode = 'P0400';
    end if;
  else
    v_emola_provider := v_existing.emola_provider;
  end if;

  -- Uma tentativa iniciada continua a ser consultada na mesma conta/provider.
  -- Corrigir credenciais é permitido; trocar gateways espera pelo fecho da fila.
  if (coalesce(v_provider, v_existing.payment_provider) is distinct from v_existing.payment_provider
      or v_emola_provider is distinct from v_existing.emola_provider)
    and exists (select 1 from public.orders o where o.store_id = p_store_id
      and o.flow = 'digital' and o.status in ('awaiting_payment', 'payment_failed')) then
    raise exception 'pending_payments_provider_change' using errcode = 'P0409';
  end if;

  update public.stores s
  set
    payment_provider = coalesce(v_provider, s.payment_provider),
    emola_provider = v_emola_provider,
    paysuite_api_key = case when jsonb_exists(p_payload, 'paysuite_api_key')
      then nullif(btrim(p_payload ->> 'paysuite_api_key'), '') else s.paysuite_api_key end,
    paysuite_webhook_secret = case when jsonb_exists(p_payload, 'paysuite_webhook_secret')
      then nullif(btrim(p_payload ->> 'paysuite_webhook_secret'), '') else s.paysuite_webhook_secret end,
    mpesa_api_key = case when jsonb_exists(p_payload, 'mpesa_api_key')
      then nullif(btrim(p_payload ->> 'mpesa_api_key'), '') else s.mpesa_api_key end,
    mpesa_public_key = case when jsonb_exists(p_payload, 'mpesa_public_key')
      then nullif(btrim(p_payload ->> 'mpesa_public_key'), '') else s.mpesa_public_key end,
    mpesa_service_provider_code = case when jsonb_exists(p_payload, 'mpesa_service_provider_code')
      then nullif(btrim(p_payload ->> 'mpesa_service_provider_code'), '') else s.mpesa_service_provider_code end,
    mpesa_session_base_url = case when jsonb_exists(p_payload, 'mpesa_session_base_url')
      then nullif(btrim(p_payload ->> 'mpesa_session_base_url'), '') else s.mpesa_session_base_url end,
    mpesa_charge_base_url = case when jsonb_exists(p_payload, 'mpesa_charge_base_url')
      then nullif(btrim(p_payload ->> 'mpesa_charge_base_url'), '') else s.mpesa_charge_base_url end,
    mpesa_query_base_url = case when jsonb_exists(p_payload, 'mpesa_query_base_url')
      then nullif(btrim(p_payload ->> 'mpesa_query_base_url'), '') else s.mpesa_query_base_url end,
    mpesa_number = case when jsonb_exists(p_payload, 'mpesa_number')
      then nullif(btrim(p_payload ->> 'mpesa_number'), '') else s.mpesa_number end,
    emola_number = case when jsonb_exists(p_payload, 'emola_number')
      then nullif(btrim(p_payload ->> 'emola_number'), '') else s.emola_number end
  where s.id = p_store_id;

  if not found then
    raise exception 'store_not_found' using errcode = 'P0002';
  end if;

  -- O registo diz **que campos** mudaram. Nunca o que lá foi escrito: um
  -- event_log com uma chave de API dentro é a mesma fuga, noutro sítio.
  for v_chave in select jsonb_object_keys(p_payload) loop
    v_mudou := array_append(v_mudou, v_chave);
  end loop;

  insert into public.event_log (store_id, actor_user_id, type, payload)
  values (
    p_store_id,
    (select auth.uid()),
    'store.payment_changed',
    jsonb_build_object('campos', to_jsonb(v_mudou))
  );

  return public.get_store_payment_status(p_store_id);
end;
$$;

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
  v_provider text;
  v_emola_provider text;
  v_scheduled_for timestamptz;
  v_local_scheduled timestamp;
  v_slot_minutes integer;
  v_order_id uuid;
begin
  select s.id, s.payment_provider, s.emola_provider
  into v_store_id, v_provider, v_emola_provider
  from public.stores s
  where s.slug = p_store_slug
    and s.active
  for update;

  if not found then
    raise exception 'store_not_found' using errcode = 'P0404';
  end if;

  -- A API e a RPC pública usam a mesma matriz por método. Um payload não activa gateways.
  if p_payload ->> 'flow' = 'digital' and
    private.payment_mode(v_provider, v_emola_provider, p_payload ->> 'paymentMethod') = 'manual' then
    raise exception 'digital_payment_method_unavailable' using errcode = 'P0400';
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
revoke all on function public.get_menu(text,text,boolean) from public;
grant execute on function public.get_menu(text,text,boolean) to anon, authenticated, service_role;
revoke all on function private.store_admin_json(uuid) from public, anon, authenticated;
revoke all on function public.get_store_payment_status(uuid) from public, anon;
grant execute on function public.get_store_payment_status(uuid) to authenticated, service_role;
revoke all on function public.save_store_payment(uuid,jsonb) from public, anon;
grant execute on function public.save_store_payment(uuid,jsonb) to authenticated, service_role;
revoke all on function public.create_order(text,jsonb) from public;
grant execute on function public.create_order(text,jsonb) to anon, authenticated, service_role;

-- A falha definitiva do fornecedor é uma transição de domínio idempotente.
-- Os eventos anteriores continuam no mesmo motor de estado/stock/impressão.
create or replace function public.advance_order(
  p_order_id uuid,
  p_event text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store_id uuid;
  v_status text;
  v_flow text;
begin
  if p_event = 'PAYMENT_FAILED' then
    if not coalesce((select auth.jwt() ->> 'role') = 'service_role', false) then
      raise exception 'payment_transition_denied' using errcode = 'P0403';
    end if;

    select o.store_id, o.status, o.flow into v_store_id, v_status, v_flow
    from public.orders o where o.id = p_order_id for update;
    if not found then raise exception 'order_not_found' using errcode = 'P0404'; end if;

    if v_flow is distinct from 'digital' or v_status is distinct from 'awaiting_payment' then
      return jsonb_build_object('success', true, 'order_id', p_order_id,
        'status', v_status, 'new_status', v_status, 'unchanged', true);
    end if;

    update public.orders set status = 'payment_failed', updated_at = now()
    where id = p_order_id and store_id = v_store_id and status = 'awaiting_payment';
    insert into public.event_log (store_id, order_id, actor_user_id, type, payload)
    values (v_store_id, p_order_id, (select auth.uid()), 'payment.failed',
      jsonb_build_object('source', 'advance_order', 'reason', left(p_reason, 500),
        'previous_status', v_status, 'new_status', 'payment_failed'));
    return jsonb_build_object('success', true, 'order_id', p_order_id,
      'status', 'payment_failed', 'new_status', 'payment_failed');
  end if;

  if not private.can_access_order(p_order_id) then
    raise exception 'store_access_denied' using errcode = 'P0403';
  end if;

  select o.store_id into v_store_id from public.orders o where o.id = p_order_id;
  perform set_config('app.request_store_id', v_store_id::text, true);
  return private.advance_order_legacy(p_order_id, p_event, p_reason);
end;
$$;
revoke all on function public.advance_order(uuid,text,text) from public, anon;
grant execute on function public.advance_order(uuid,text,text) to authenticated, service_role;
