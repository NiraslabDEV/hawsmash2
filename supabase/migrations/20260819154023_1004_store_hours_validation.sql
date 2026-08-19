-- A implementação herdada valida open_hour/close_hour do singleton settings e
-- interpreta o timestamp no fuso da sessão. Esta camada torna store_hours a
-- única autoridade e valida explicitamente em Africa/Maputo.
alter function public.create_order(text, jsonb) set schema private;
alter function private.create_order(text, jsonb) rename to create_order_store_legacy;
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
