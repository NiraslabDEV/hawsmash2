-- HAWSMASH 2.0 — F10 / 1011: configurar as lojas pelo painel (CLAUDE §5.6).
--
-- Até aqui, mudar um horário, uma taxa de entrega ou fechar uma loja obrigava a
-- SQL à mão. Isso é operação do dia a dia, não instalação. A partir daqui:
--   · o dono configura tudo pelo painel, com auditoria;
--   · o gerente fecha e reabre **a sua** loja, com motivo;
--   · slug e prefixo ficam imutáveis (o histórico de pedidos depende deles);
--   · as chaves do Paysuite deixam de ser legíveis pelo cliente autenticado.

-- ---------------------------------------------------------------------------
-- 1. Segredos fora do alcance do browser (grant por coluna).
-- ---------------------------------------------------------------------------
revoke select on public.stores from authenticated;
grant select (
  id, slug, name, short_name, order_prefix, active, accepting_orders,
  address, maps_url, phone, owner_email,
  delivery_enabled, pickup_enabled, counter_enabled,
  mpesa_number, mpesa_name, emola_number, emola_name,
  payment_provider, receipt_header, receipt_footer, sort, created_at
) on public.stores to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Leitura de configuração para o painel (nunca devolve segredos).
-- ---------------------------------------------------------------------------
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
    'receipt_header', v_store.receipt_header,
    'receipt_footer', v_store.receipt_footer,
    'sort', v_store.sort,
    'missing', to_jsonb(v_missing)
  );
end;
$$;

revoke all on function private.store_admin_json(uuid) from public, anon, authenticated;

create or replace function public.get_store_admin(p_store_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_store jsonb;
begin
  perform private.assert_staff_admin();
  v_store := private.store_admin_json(p_store_id);

  return jsonb_build_object(
    'store', v_store,
    'missing', v_store -> 'missing',
    'hours', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'dow', h.dow, 'opens', h.opens, 'closes', h.closes, 'active', h.active
      ) order by h.dow), '[]'::jsonb)
      from public.store_hours h
      where h.store_id = p_store_id
    ),
    'zones', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', z.id, 'name', z.name, 'fee_cents', z.fee_cents,
        'active', z.active, 'sort', z.sort
      ) order by z.sort, z.name), '[]'::jsonb)
      from public.delivery_zones z
      where z.store_id = p_store_id
    )
  );
end;
$$;

revoke all on function public.get_store_admin(uuid) from public, anon;
grant execute on function public.get_store_admin(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Criar / editar loja. Só o dono.
-- ---------------------------------------------------------------------------
create or replace function public.save_store(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_id uuid;
  v_existing public.stores%rowtype;
  v_slug text;
  v_prefix text;
begin
  perform private.assert_staff_admin();

  begin
    v_id := nullif(p_payload ->> 'id', '')::uuid;
  exception when invalid_text_representation then
    raise exception 'invalid_store_id' using errcode = 'P0007';
  end;

  v_slug := lower(btrim(coalesce(p_payload ->> 'slug', '')));
  v_prefix := upper(btrim(coalesce(p_payload ->> 'order_prefix', '')));

  if v_id is null then
    -- Criar: slug e prefixo são obrigatórios e ficam presos para sempre.
    if v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
      raise exception 'invalid_store_slug' using errcode = 'P0007';
    end if;
    -- O mesmo formato que a constraint da tabela impõe (1001): só letras.
    if v_prefix !~ '^[A-Z]{2,5}$' then
      raise exception 'invalid_order_prefix' using errcode = 'P0007';
    end if;
    if coalesce(btrim(p_payload ->> 'name'), '') = ''
      or coalesce(btrim(p_payload ->> 'short_name'), '') = ''
    then
      raise exception 'store_name_required' using errcode = 'P0007';
    end if;

    insert into public.stores (
      slug, name, short_name, order_prefix, active, accepting_orders,
      address, maps_url, phone, owner_email,
      delivery_enabled, pickup_enabled, counter_enabled,
      mpesa_number, mpesa_name, emola_number, emola_name,
      receipt_header, receipt_footer, sort
    ) values (
      v_slug,
      btrim(p_payload ->> 'name'),
      btrim(p_payload ->> 'short_name'),
      v_prefix,
      coalesce((p_payload ->> 'active')::boolean, true),
      -- Uma loja nova nasce fechada: só abre depois de ter horário e pagamento.
      coalesce((p_payload ->> 'accepting_orders')::boolean, false),
      nullif(btrim(coalesce(p_payload ->> 'address', '')), ''),
      nullif(btrim(coalesce(p_payload ->> 'maps_url', '')), ''),
      nullif(btrim(coalesce(p_payload ->> 'phone', '')), ''),
      nullif(btrim(coalesce(p_payload ->> 'owner_email', '')), ''),
      coalesce((p_payload ->> 'delivery_enabled')::boolean, true),
      coalesce((p_payload ->> 'pickup_enabled')::boolean, true),
      coalesce((p_payload ->> 'counter_enabled')::boolean, true),
      nullif(btrim(coalesce(p_payload ->> 'mpesa_number', '')), ''),
      nullif(btrim(coalesce(p_payload ->> 'mpesa_name', '')), ''),
      nullif(btrim(coalesce(p_payload ->> 'emola_number', '')), ''),
      nullif(btrim(coalesce(p_payload ->> 'emola_name', '')), ''),
      nullif(btrim(coalesce(p_payload ->> 'receipt_header', '')), ''),
      nullif(btrim(coalesce(p_payload ->> 'receipt_footer', '')), ''),
      coalesce((p_payload ->> 'sort')::integer, 0)
    )
    returning id into v_id;

    insert into public.event_log (store_id, actor_user_id, type, payload)
    values (
      v_id,
      v_uid,
      'store.created',
      jsonb_build_object('slug', v_slug, 'order_prefix', v_prefix)
    );

    return private.store_admin_json(v_id);
  end if;

  select s.* into v_existing from public.stores s where s.id = v_id;
  if not found then
    raise exception 'store_not_found' using errcode = 'P0404';
  end if;

  -- Mudar o slug partia cookies e URLs; mudar o prefixo partia o histórico de
  -- pedidos e o talão. Nenhum dos dois se altera depois de existir.
  if v_slug <> '' and v_slug <> v_existing.slug then
    raise exception 'store_slug_immutable' using errcode = 'P0403';
  end if;
  if v_prefix <> '' and v_prefix <> v_existing.order_prefix then
    raise exception 'store_prefix_immutable' using errcode = 'P0403';
  end if;

  update public.stores s
  set name = coalesce(nullif(btrim(coalesce(p_payload ->> 'name', '')), ''), s.name),
      short_name = coalesce(
        nullif(btrim(coalesce(p_payload ->> 'short_name', '')), ''), s.short_name
      ),
      active = coalesce((p_payload ->> 'active')::boolean, s.active),
      accepting_orders = coalesce(
        (p_payload ->> 'accepting_orders')::boolean, s.accepting_orders
      ),
      address = case when p_payload ? 'address'
        then nullif(btrim(coalesce(p_payload ->> 'address', '')), '') else s.address end,
      maps_url = case when p_payload ? 'maps_url'
        then nullif(btrim(coalesce(p_payload ->> 'maps_url', '')), '') else s.maps_url end,
      phone = case when p_payload ? 'phone'
        then nullif(btrim(coalesce(p_payload ->> 'phone', '')), '') else s.phone end,
      owner_email = case when p_payload ? 'owner_email'
        then nullif(btrim(coalesce(p_payload ->> 'owner_email', '')), '') else s.owner_email end,
      delivery_enabled = coalesce(
        (p_payload ->> 'delivery_enabled')::boolean, s.delivery_enabled
      ),
      pickup_enabled = coalesce((p_payload ->> 'pickup_enabled')::boolean, s.pickup_enabled),
      counter_enabled = coalesce((p_payload ->> 'counter_enabled')::boolean, s.counter_enabled),
      mpesa_number = case when p_payload ? 'mpesa_number'
        then nullif(btrim(coalesce(p_payload ->> 'mpesa_number', '')), '') else s.mpesa_number end,
      mpesa_name = case when p_payload ? 'mpesa_name'
        then nullif(btrim(coalesce(p_payload ->> 'mpesa_name', '')), '') else s.mpesa_name end,
      emola_number = case when p_payload ? 'emola_number'
        then nullif(btrim(coalesce(p_payload ->> 'emola_number', '')), '') else s.emola_number end,
      emola_name = case when p_payload ? 'emola_name'
        then nullif(btrim(coalesce(p_payload ->> 'emola_name', '')), '') else s.emola_name end,
      receipt_header = case when p_payload ? 'receipt_header'
        then nullif(btrim(coalesce(p_payload ->> 'receipt_header', '')), '') else s.receipt_header end,
      receipt_footer = case when p_payload ? 'receipt_footer'
        then nullif(btrim(coalesce(p_payload ->> 'receipt_footer', '')), '') else s.receipt_footer end,
      sort = coalesce((p_payload ->> 'sort')::integer, s.sort)
  where s.id = v_id;

  insert into public.event_log (store_id, actor_user_id, type, payload)
  values (
    v_id,
    v_uid,
    'store.updated',
    jsonb_build_object('fields', (select jsonb_agg(k) from jsonb_object_keys(p_payload) k))
  );

  return private.store_admin_json(v_id);
end;
$$;

revoke all on function public.save_store(jsonb) from public, anon;
grant execute on function public.save_store(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Horário da semana (substitui tudo de uma vez — é como o dono pensa).
-- ---------------------------------------------------------------------------
create or replace function public.set_store_hours(p_store_id uuid, p_hours jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_entry jsonb;
  v_dow smallint;
  v_opens time;
  v_closes time;
begin
  perform private.assert_staff_admin();

  if not exists (select 1 from public.stores s where s.id = p_store_id) then
    raise exception 'store_not_found' using errcode = 'P0404';
  end if;
  if p_hours is null or jsonb_typeof(p_hours) <> 'array' then
    raise exception 'invalid_hours' using errcode = 'P0007';
  end if;

  -- Valida tudo antes de apagar o que existe: um payload inválido não pode
  -- deixar a loja sem horário nenhum.
  for v_entry in select value from jsonb_array_elements(p_hours)
  loop
    begin
      v_dow := (v_entry ->> 'dow')::smallint;
      v_opens := (v_entry ->> 'opens')::time;
      v_closes := (v_entry ->> 'closes')::time;
    exception when others then
      raise exception 'invalid_hours_entry' using errcode = 'P0007';
    end;

    if v_dow is null or v_dow < 0 or v_dow > 6 then
      raise exception 'invalid_dow' using errcode = 'P0007';
    end if;
    if v_opens is null or v_closes is null or v_closes <= v_opens then
      raise exception 'invalid_hours_range' using errcode = 'P0007';
    end if;
  end loop;

  delete from public.store_hours h where h.store_id = p_store_id;

  insert into public.store_hours (store_id, dow, opens, closes, active)
  select
    p_store_id,
    (entry ->> 'dow')::smallint,
    (entry ->> 'opens')::time,
    (entry ->> 'closes')::time,
    coalesce((entry ->> 'active')::boolean, true)
  from jsonb_array_elements(p_hours) entry
  on conflict (store_id, dow) do update
    set opens = excluded.opens,
        closes = excluded.closes,
        active = excluded.active;

  insert into public.event_log (store_id, actor_user_id, type, payload)
  values (p_store_id, v_uid, 'store.hours_changed', jsonb_build_object('hours', p_hours));

  return jsonb_build_object(
    'store_id', p_store_id,
    'hours', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'dow', h.dow, 'opens', h.opens, 'closes', h.closes, 'active', h.active
      ) order by h.dow), '[]'::jsonb)
      from public.store_hours h
      where h.store_id = p_store_id
    )
  );
end;
$$;

revoke all on function public.set_store_hours(uuid, jsonb) from public, anon;
grant execute on function public.set_store_hours(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Zonas de entrega.
-- ---------------------------------------------------------------------------
create or replace function public.save_delivery_zone(p_store_id uuid, p_zone jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_id uuid;
  v_name text := btrim(coalesce(p_zone ->> 'name', ''));
  v_fee integer;
  v_row public.delivery_zones%rowtype;
begin
  perform private.assert_staff_admin();

  if not exists (select 1 from public.stores s where s.id = p_store_id) then
    raise exception 'store_not_found' using errcode = 'P0404';
  end if;
  if length(v_name) < 2 then
    raise exception 'zone_name_required' using errcode = 'P0007';
  end if;

  begin
    v_id := nullif(p_zone ->> 'id', '')::uuid;
    v_fee := (p_zone ->> 'fee_cents')::integer;
  exception when invalid_text_representation then
    raise exception 'invalid_zone' using errcode = 'P0007';
  end;

  if v_fee is null or v_fee < 0 then
    raise exception 'invalid_zone_fee' using errcode = 'P0007';
  end if;

  if v_id is null then
    insert into public.delivery_zones (store_id, name, fee_cents, active, sort)
    values (
      p_store_id,
      v_name,
      v_fee,
      coalesce((p_zone ->> 'active')::boolean, true),
      coalesce((p_zone ->> 'sort')::integer, 0)
    )
    returning * into v_row;
  else
    update public.delivery_zones z
    set name = v_name,
        fee_cents = v_fee,
        active = coalesce((p_zone ->> 'active')::boolean, z.active),
        sort = coalesce((p_zone ->> 'sort')::integer, z.sort)
    where z.id = v_id
      and z.store_id = p_store_id
    returning * into v_row;

    if v_row.id is null then
      raise exception 'zone_not_found' using errcode = 'P0404';
    end if;
  end if;

  insert into public.event_log (store_id, actor_user_id, type, payload)
  values (
    p_store_id,
    v_uid,
    'store.zone_saved',
    jsonb_build_object('zone_id', v_row.id, 'name', v_row.name, 'fee_cents', v_row.fee_cents)
  );

  return jsonb_build_object(
    'id', v_row.id,
    'store_id', v_row.store_id,
    'name', v_row.name,
    'fee_cents', v_row.fee_cents,
    'active', v_row.active,
    'sort', v_row.sort
  );
end;
$$;

revoke all on function public.save_delivery_zone(uuid, jsonb) from public, anon;
grant execute on function public.save_delivery_zone(uuid, jsonb) to authenticated;

create or replace function public.delete_delivery_zone(p_zone_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_zone public.delivery_zones%rowtype;
  v_in_use boolean;
begin
  perform private.assert_staff_admin();

  select z.* into v_zone from public.delivery_zones z where z.id = p_zone_id;
  if not found then
    raise exception 'zone_not_found' using errcode = 'P0404';
  end if;

  select exists (
    select 1 from public.orders o where o.delivery_zone_id = p_zone_id
  ) into v_in_use;

  if v_in_use then
    -- Zona com pedidos não se apaga: apagá-la reescreveria o histórico.
    update public.delivery_zones z set active = false where z.id = p_zone_id;
  else
    delete from public.delivery_zones z where z.id = p_zone_id;
  end if;

  insert into public.event_log (store_id, actor_user_id, type, payload)
  values (
    v_zone.store_id,
    v_uid,
    'store.zone_removed',
    jsonb_build_object('zone_id', p_zone_id, 'name', v_zone.name, 'deactivated', v_in_use)
  );

  return jsonb_build_object(
    'zone_id', p_zone_id,
    'deleted', not v_in_use,
    'deactivated', v_in_use
  );
end;
$$;

revoke all on function public.delete_delivery_zone(uuid) from public, anon;
grant execute on function public.delete_delivery_zone(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Kill switch por loja — decisão de operação, logo o gerente também a toma.
-- ---------------------------------------------------------------------------
create or replace function public.set_store_accepting_orders(
  p_store_id uuid,
  p_accepting boolean,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_role text;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_short_name text;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0020';
  end if;

  v_role := private.auth_role();
  if v_role is null or v_role not in ('owner', 'manager') then
    raise exception 'store_admin_denied' using errcode = 'P0403';
  end if;
  if not private.auth_can_store(p_store_id) then
    raise exception 'store_admin_denied' using errcode = 'P0403';
  end if;
  if p_accepting is null then
    raise exception 'accepting_orders_required' using errcode = 'P0007';
  end if;
  if length(v_reason) < 3 then
    raise exception 'store_switch_reason_required' using errcode = 'P0007';
  end if;

  update public.stores s
  set accepting_orders = p_accepting
  where s.id = p_store_id
  returning s.short_name into v_short_name;

  if v_short_name is null then
    raise exception 'store_not_found' using errcode = 'P0404';
  end if;

  insert into public.event_log (store_id, actor_user_id, type, payload)
  values (
    p_store_id,
    v_uid,
    'store.accepting_orders_changed',
    jsonb_build_object('accepting_orders', p_accepting, 'reason', v_reason)
  );

  return jsonb_build_object(
    'store_id', p_store_id,
    'short_name', v_short_name,
    'accepting_orders', p_accepting
  );
end;
$$;

revoke all on function public.set_store_accepting_orders(uuid, boolean, text) from public, anon;
grant execute on function public.set_store_accepting_orders(uuid, boolean, text) to authenticated;
