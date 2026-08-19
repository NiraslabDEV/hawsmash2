-- HAWSMASH 2.0 — F3: heartbeat multi-loja e recuperação de jobs presos.

alter table public.print_jobs
  add column if not exists claimed_at timestamptz;

create index if not exists print_jobs_store_claimed_at_idx
  on public.print_jobs (store_id, claimed_at)
  where status = 'printing';

create or replace function public.bridge_heartbeat(
  p_device_id uuid,
  p_store_id uuid,
  p_app_version text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device public.devices%rowtype;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception 'bridge_heartbeat_access_denied' using errcode = 'P0403';
  end if;
  if p_device_id is null or p_store_id is null then
    raise exception 'bridge_device_and_store_required' using errcode = 'P0007';
  end if;
  if not exists (
    select 1 from public.stores s where s.id = p_store_id and s.active
  ) then
    raise exception 'store_not_found_or_inactive' using errcode = 'P0404';
  end if;

  select d.* into v_device
  from public.devices d
  where d.id = p_device_id;

  if found then
    if v_device.store_id <> p_store_id or v_device.kind <> 'bridge' then
      raise exception 'bridge_device_context_conflict' using errcode = 'P0409';
    end if;
    if not v_device.active then
      raise exception 'bridge_device_inactive' using errcode = 'P0403';
    end if;

    update public.devices
    set last_seen_at = now(),
        app_version = nullif(btrim(p_app_version), '')
    where id = p_device_id
      and store_id = p_store_id
      and kind = 'bridge';
  else
    insert into public.devices (
      id, store_id, kind, label, device_key_hash, app_version,
      active, last_seen_at, created_by
    ) values (
      p_device_id,
      p_store_id,
      'bridge',
      'Print bridge',
      'bridge:' || p_device_id::text,
      nullif(btrim(p_app_version), ''),
      true,
      now(),
      null
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'device_id', p_device_id,
    'store_id', p_store_id,
    'last_seen_at', now()
  );
end;
$$;

revoke all on function public.bridge_heartbeat(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.bridge_heartbeat(uuid, uuid, text) to service_role;

create or replace function public.recover_stale_print_jobs(p_store_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job record;
  v_next_status text;
  v_requeued integer := 0;
  v_failed integer := 0;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception 'print_watchdog_access_denied' using errcode = 'P0403';
  end if;
  if p_store_id is null then
    raise exception 'store_required' using errcode = 'P0007';
  end if;

  for v_job in
    select pj.id, pj.order_id, pj.store_id, pj.attempts
    from public.print_jobs pj
    where pj.store_id = p_store_id
      and pj.status = 'printing'
      and (pj.claimed_at is null or pj.claimed_at < now() - interval '2 minutes')
    for update skip locked
  loop
    v_next_status := case when v_job.attempts >= 3 then 'failed' else 'queued' end;

    update public.print_jobs
    set status = v_next_status,
        claimed_at = null
    where id = v_job.id
      and store_id = p_store_id
      and status = 'printing';

    if v_next_status = 'failed' then
      v_failed := v_failed + 1;
    else
      v_requeued := v_requeued + 1;
    end if;

    insert into public.event_log (
      order_id, store_id, actor_user_id, type, payload
    ) values (
      v_job.order_id,
      v_job.store_id,
      null,
      case
        when v_next_status = 'failed' then 'print.watchdog_failed'
        else 'print.watchdog_requeued'
      end,
      jsonb_build_object(
        'job_id', v_job.id,
        'attempts', v_job.attempts,
        'next_status', v_next_status
      )
    );
  end loop;

  return jsonb_build_object('requeued', v_requeued, 'failed', v_failed);
end;
$$;

revoke all on function public.recover_stale_print_jobs(uuid)
  from public, anon, authenticated;
grant execute on function public.recover_stale_print_jobs(uuid) to service_role;

create or replace function public.get_device_status()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'devices', coalesce(jsonb_agg(jsonb_build_object(
      'id', d.id,
      'store_id', d.store_id,
      'kind', d.kind,
      'label', d.label,
      'app_version', d.app_version,
      'last_seen_at', d.last_seen_at,
      'online', coalesce(d.last_seen_at >= now() - interval '2 minutes', false)
    ) order by d.kind, d.label), '[]'::jsonb),
    'threshold_seconds', 120
  )
  from public.devices d
  where d.active
    and (select private.auth_can_store(d.store_id));
$$;

revoke all on function public.get_device_status() from public, anon;
grant execute on function public.get_device_status() to authenticated;
