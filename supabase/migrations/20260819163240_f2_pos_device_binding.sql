-- HAWSMASH 2.0 — F2: vinculação do terminal e bloqueio local por PIN.

create or replace function public.bind_pos_device(
  p_store_id uuid,
  p_label text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_label text := btrim(coalesce(p_label, ''));
  v_device_id uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0020';
  end if;
  if private.auth_role() not in ('owner', 'manager') then
    raise exception 'device_binding_access_denied' using errcode = 'P0403';
  end if;
  if not private.auth_can_store(p_store_id) then
    raise exception 'device_binding_store_denied' using errcode = 'P0403';
  end if;
  if length(v_label) < 3 or length(v_label) > 80 then
    raise exception 'invalid_device_label' using errcode = 'P0007';
  end if;

  insert into public.devices (
    store_id, kind, label, device_key_hash, locked_at, created_by
  ) values (
    p_store_id,
    'pos',
    v_label,
    encode(
      extensions.digest(
        gen_random_uuid()::text || ':' || clock_timestamp()::text,
        'sha256'
      ),
      'hex'
    ),
    now(),
    v_uid
  )
  returning id into v_device_id;

  insert into public.event_log (store_id, actor_user_id, type, payload)
  values (
    p_store_id,
    v_uid,
    'pos.device_bound',
    jsonb_build_object('device_id', v_device_id, 'label', v_label)
  );

  return jsonb_build_object('device_id', v_device_id, 'locked', true);
end;
$$;

create or replace function public.set_own_pos_pin(
  p_device_id uuid,
  p_pin text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_store_id uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0020';
  end if;
  if coalesce(p_pin, '') !~ '^[0-9]{4,6}$' then
    raise exception 'invalid_pin_format' using errcode = 'P0007';
  end if;

  select d.store_id
  into v_store_id
  from public.devices d
  where d.id = p_device_id
    and d.kind = 'pos'
    and d.active
    and private.auth_can_store(d.store_id);

  if not found then
    raise exception 'invalid_or_unauthorised_device' using errcode = 'P0403';
  end if;

  update public.staff_profiles sp
  set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf', 10))
  where sp.user_id = v_uid
    and sp.active;

  if not found then
    raise exception 'inactive_staff_profile' using errcode = 'P0403';
  end if;

  update public.devices
  set locked_at = null,
      last_seen_at = now()
  where id = p_device_id;

  insert into public.event_log (store_id, actor_user_id, type, payload)
  values (
    v_store_id,
    v_uid,
    'pos.pin_set',
    jsonb_build_object('device_id', p_device_id)
  );

  return jsonb_build_object('configured', true, 'unlocked', true);
end;
$$;

create or replace function public.lock_pos_device(p_device_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_store_id uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0020';
  end if;

  update public.devices d
  set locked_at = coalesce(d.locked_at, now()),
      last_seen_at = now()
  where d.id = p_device_id
    and d.kind = 'pos'
    and d.active
    and private.auth_can_store(d.store_id)
  returning d.store_id into v_store_id;

  if not found then
    raise exception 'invalid_or_unauthorised_device' using errcode = 'P0403';
  end if;

  insert into public.event_log (store_id, actor_user_id, type, payload)
  values (
    v_store_id,
    v_uid,
    'pos.device_locked',
    jsonb_build_object('device_id', p_device_id)
  );

  return jsonb_build_object('locked', true);
end;
$$;

create or replace function public.unlock_pos_device(
  p_device_id uuid,
  p_pin text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_store_id uuid;
  v_pin_hash text;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0020';
  end if;

  select d.store_id, sp.pin_hash
  into v_store_id, v_pin_hash
  from public.devices d
  join public.staff_profiles sp on sp.user_id = v_uid and sp.active
  where d.id = p_device_id
    and d.kind = 'pos'
    and d.active
    and private.auth_can_store(d.store_id);

  if not found then
    raise exception 'invalid_or_unauthorised_device' using errcode = 'P0403';
  end if;
  if v_pin_hash is null then
    raise exception 'pin_not_configured' using errcode = 'P0007';
  end if;
  if extensions.crypt(coalesce(p_pin, ''), v_pin_hash) <> v_pin_hash then
    raise exception 'invalid_pin' using errcode = 'P0403';
  end if;

  update public.devices
  set locked_at = null,
      last_seen_at = now()
  where id = p_device_id;

  insert into public.event_log (store_id, actor_user_id, type, payload)
  values (
    v_store_id,
    v_uid,
    'pos.device_unlocked',
    jsonb_build_object('device_id', p_device_id)
  );

  return jsonb_build_object('unlocked', true);
end;
$$;

create or replace function public.pos_pin_status(p_device_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'configured', sp.pin_hash is not null,
    'locked', d.locked_at is not null
  )
  from public.devices d
  join public.staff_profiles sp
    on sp.user_id = (select auth.uid())
   and sp.active
  where d.id = p_device_id
    and d.kind = 'pos'
    and d.active
    and private.auth_can_store(d.store_id);
$$;

-- Mantém a venda original isolada e põe o bloqueio à frente dela. Um retry de
-- uma venda já gravada continua idempotente mesmo que o ecrã tenha bloqueado.
alter function public.create_counter_sale(jsonb)
  rename to create_counter_sale_unlocked;

revoke all on function public.create_counter_sale_unlocked(jsonb)
  from public, anon, authenticated;

create function public.create_counter_sale(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client_sale_id uuid;
  v_device_id uuid;
  v_locked_at timestamptz;
begin
  begin
    v_client_sale_id := nullif(p_payload ->> 'clientSaleId', '')::uuid;
    v_device_id := nullif(p_payload ->> 'deviceId', '')::uuid;
  exception when invalid_text_representation then
    raise exception 'invalid_pos_payload' using errcode = 'P0007';
  end;

  if v_client_sale_id is not null and exists (
    select 1
    from public.orders o
    where o.client_sale_id = v_client_sale_id
  ) then
    return public.create_counter_sale_unlocked(p_payload);
  end if;

  select d.locked_at
  into v_locked_at
  from public.devices d
  where d.id = v_device_id
    and d.kind = 'pos'
    and d.active
    and private.auth_can_store(d.store_id);

  if not found then
    raise exception 'invalid_or_unauthorised_device' using errcode = 'P0403';
  end if;
  if v_locked_at is not null then
    raise exception 'device_locked' using errcode = 'P0403';
  end if;

  return public.create_counter_sale_unlocked(p_payload);
end;
$$;

revoke all on function public.bind_pos_device(uuid, text) from public, anon;
revoke all on function public.set_own_pos_pin(uuid, text) from public, anon;
revoke all on function public.lock_pos_device(uuid) from public, anon;
revoke all on function public.unlock_pos_device(uuid, text) from public, anon;
revoke all on function public.pos_pin_status(uuid) from public, anon;
revoke all on function public.create_counter_sale(jsonb) from public, anon;

grant execute on function public.bind_pos_device(uuid, text) to authenticated;
grant execute on function public.set_own_pos_pin(uuid, text) to authenticated;
grant execute on function public.lock_pos_device(uuid) to authenticated;
grant execute on function public.unlock_pos_device(uuid, text) to authenticated;
grant execute on function public.pos_pin_status(uuid) to authenticated;
grant execute on function public.create_counter_sale(jsonb) to authenticated;
