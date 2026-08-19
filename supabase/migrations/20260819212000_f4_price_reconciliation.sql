-- HAWSMASH 2.0 — F4: diferença entre preço offline e preço actual do servidor.

alter table public.orders
  add column if not exists offline_total_cents integer
    check (offline_total_cents is null or offline_total_cents >= 0);

create index if not exists orders_store_needs_review_idx
  on public.orders (store_id, created_at desc)
  where needs_review;

create or replace function public.sync_counter_sale(
  p_payload jsonb,
  p_local_print jsonb default '{}'::jsonb
)
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
  v_offline_total integer;
  v_server_total integer;
  v_needs_review boolean := false;
begin
  if jsonb_typeof(coalesce(p_local_print, '{}'::jsonb)) <> 'object'
    or (p_local_print ? 'receipt' and jsonb_typeof(p_local_print -> 'receipt') <> 'boolean')
    or (p_local_print ? 'drawer' and jsonb_typeof(p_local_print -> 'drawer') <> 'boolean')
    or (p_local_print ? 'stations' and jsonb_typeof(p_local_print -> 'stations') <> 'array')
  then
    raise exception 'invalid_local_print' using errcode = 'P0007';
  end if;

  if not (coalesce(p_payload ->> 'offlineTotalCents', '') ~ '^\d{1,10}$')
    or (p_payload ->> 'offlineTotalCents')::bigint > 2147483647
  then
    raise exception 'invalid_offline_total' using errcode = 'P0007';
  end if;
  v_offline_total := (p_payload ->> 'offlineTotalCents')::integer;

  v_result := public.create_counter_sale(p_payload);
  v_order_id := (v_result ->> 'order_id')::uuid;

  select o.store_id, o.total_cents
  into v_store_id, v_server_total
  from public.orders o
  where o.id = v_order_id;

  v_needs_review := v_offline_total <> v_server_total;
  update public.orders
  set offline_total_cents = v_offline_total,
      needs_review = v_needs_review
  where id = v_order_id;

  if v_needs_review and not exists (
    select 1 from public.event_log e
    where e.order_id = v_order_id and e.type = 'order.price_reconciliation_needed'
  ) then
    insert into public.event_log (order_id, store_id, actor_user_id, type, payload)
    values (
      v_order_id, v_store_id, v_uid, 'order.price_reconciliation_needed',
      jsonb_build_object('offline_total_cents', v_offline_total, 'server_total_cents', v_server_total)
    );
  end if;

  with acknowledged as (
    update public.print_jobs pj
    set status = 'printed', printed_at = coalesce(pj.printed_at, now())
    where pj.order_id = v_order_id and pj.store_id = v_store_id and pj.status = 'queued'
      and (
        (pj.kind = 'receipt' and coalesce((p_local_print ->> 'receipt')::boolean, false))
        or (pj.kind = 'drawer' and coalesce((p_local_print ->> 'drawer')::boolean, false))
        or (pj.kind = 'order' and pj.station in (
          select jsonb_array_elements_text(coalesce(p_local_print -> 'stations', '[]'::jsonb))
        ))
      )
    returning pj.id, pj.kind, pj.station
  )
  insert into public.event_log (order_id, store_id, actor_user_id, type, payload)
  select v_order_id, v_store_id, v_uid, 'print.local_acknowledged',
    jsonb_build_object('job_id', a.id, 'kind', a.kind, 'station', a.station)
  from acknowledged a;

  return v_result || jsonb_build_object(
    'offline_sync', true,
    'offline_total_cents', v_offline_total,
    'needs_review', v_needs_review
  );
end;
$$;

revoke all on function public.sync_counter_sale(jsonb, jsonb) from public, anon;
grant execute on function public.sync_counter_sale(jsonb, jsonb) to authenticated;
