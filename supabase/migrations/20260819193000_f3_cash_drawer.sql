-- HAWSMASH 2.0 — F3: gaveta idempotente, ligada à impressora do balcão.

alter table public.print_jobs
  add column if not exists request_id uuid;

create unique index if not exists print_jobs_store_request_uidx
  on public.print_jobs (store_id, request_id)
  where request_id is not null;

-- Preserva toda a validação do POS existente e acrescenta a fila da gaveta à
-- frente da mesma transacção. A falha técnica ao enfileirar é auditada, mas não
-- reverte uma venda já validada.
alter function public.create_counter_sale(jsonb)
  rename to create_counter_sale_without_drawer;

revoke all on function public.create_counter_sale_without_drawer(jsonb)
  from public, anon, authenticated;

create function public.create_counter_sale(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_order_id uuid;
  v_store_id uuid;
  v_job_id uuid;
  v_uid uuid := (select auth.uid());
begin
  v_result := public.create_counter_sale_without_drawer(p_payload);
  v_order_id := (v_result ->> 'order_id')::uuid;

  select o.store_id
  into v_store_id
  from public.orders o
  where o.id = v_order_id;

  if exists (
    select 1
    from public.payments p
    where p.order_id = v_order_id
      and p.store_id = v_store_id
      and p.method = 'cash'
      and p.status = 'confirmed'
  ) then
    begin
      insert into public.print_jobs (
        store_id, order_id, request_id, station, kind, reprint_seq, payload
      ) values (
        v_store_id,
        v_order_id,
        v_order_id,
        'counter',
        'drawer',
        0,
        jsonb_build_object(
          'source', 'counter_sale',
          'request_id', v_order_id,
          'device_id', nullif(p_payload ->> 'deviceId', '')
        )
      )
      on conflict (order_id, station, kind, reprint_seq) do nothing
      returning id into v_job_id;

      if v_job_id is not null then
        insert into public.event_log (
          order_id, store_id, actor_user_id, type, payload
        ) values (
          v_order_id,
          v_store_id,
          v_uid,
          'cash.drawer_queued_for_sale',
          jsonb_build_object(
            'job_id', v_job_id,
            'request_id', v_order_id,
            'device_id', nullif(p_payload ->> 'deviceId', '')
          )
        );
      end if;
    exception when others then
      begin
        insert into public.event_log (
          order_id, store_id, actor_user_id, type, payload
        ) values (
          v_order_id,
          v_store_id,
          v_uid,
          'cash.drawer_enqueue_failed',
          jsonb_build_object('request_id', v_order_id, 'error', sqlstate)
        );
      exception when others then
        null;
      end;
    end;
  end if;

  return v_result;
end;
$$;

revoke all on function public.create_counter_sale(jsonb) from public, anon;
grant execute on function public.create_counter_sale(jsonb) to authenticated;

create or replace function public.open_cash_drawer(
  p_device_id uuid,
  p_request_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_role text := private.auth_role();
  v_device public.devices%rowtype;
  v_existing public.print_jobs%rowtype;
  v_job_id uuid;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0020';
  end if;
  if v_role is null or v_role not in ('owner', 'manager') then
    raise exception 'drawer_access_denied' using errcode = 'P0403';
  end if;
  if p_request_id is null then
    raise exception 'drawer_request_id_required' using errcode = 'P0007';
  end if;
  if length(v_reason) < 5 or length(v_reason) > 500 then
    raise exception 'drawer_reason_required' using errcode = 'P0007';
  end if;

  select d.*
  into v_device
  from public.devices d
  where d.id = p_device_id
    and d.kind = 'pos'
    and d.active
    and d.locked_at is null
    and private.auth_can_store(d.store_id);

  if not found then
    raise exception 'invalid_or_unauthorised_device' using errcode = 'P0403';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_device.store_id::text || ':' || p_request_id::text, 0)
  );

  select pj.*
  into v_existing
  from public.print_jobs pj
  where pj.store_id = v_device.store_id
    and pj.request_id = p_request_id;

  if found then
    if v_existing.kind <> 'drawer' then
      raise exception 'drawer_request_id_conflict' using errcode = 'P0409';
    end if;
    return jsonb_build_object(
      'job_id', v_existing.id,
      'request_id', p_request_id,
      'duplicate', true
    );
  end if;

  insert into public.print_jobs (
    store_id, order_id, request_id, station, kind, reprint_seq, payload
  ) values (
    v_device.store_id,
    null,
    p_request_id,
    'counter',
    'drawer',
    0,
    jsonb_build_object(
      'source', 'manual',
      'request_id', p_request_id,
      'device_id', v_device.id,
      'reason', v_reason,
      'actor_user_id', v_uid
    )
  )
  returning id into v_job_id;

  insert into public.event_log (
    store_id, actor_user_id, type, payload
  ) values (
    v_device.store_id,
    v_uid,
    'cash.drawer_opened_outside_sale',
    jsonb_build_object(
      'job_id', v_job_id,
      'request_id', p_request_id,
      'device_id', v_device.id,
      'reason', v_reason
    )
  );

  return jsonb_build_object(
    'job_id', v_job_id,
    'request_id', p_request_id,
    'duplicate', false
  );
end;
$$;

revoke all on function public.open_cash_drawer(uuid, uuid, text) from public, anon;
grant execute on function public.open_cash_drawer(uuid, uuid, text) to authenticated;
