-- HAWSMASH 2.0 — F3: reimpressão idempotente e auditada.

drop index if exists public.print_jobs_store_request_uidx;
create unique index if not exists print_jobs_store_request_station_kind_uidx
  on public.print_jobs (store_id, request_id, station, kind)
  where request_id is not null;

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

  if p_kind = 'receipt' then
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
