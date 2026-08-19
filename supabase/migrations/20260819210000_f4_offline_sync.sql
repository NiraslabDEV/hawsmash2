-- HAWSMASH 2.0 — F4: sincronização idempotente das vendas guardadas no POS.

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
begin
  if jsonb_typeof(coalesce(p_local_print, '{}'::jsonb)) <> 'object'
    or (p_local_print ? 'receipt' and jsonb_typeof(p_local_print -> 'receipt') <> 'boolean')
    or (p_local_print ? 'drawer' and jsonb_typeof(p_local_print -> 'drawer') <> 'boolean')
    or (p_local_print ? 'stations' and jsonb_typeof(p_local_print -> 'stations') <> 'array')
  then
    raise exception 'invalid_local_print' using errcode = 'P0007';
  end if;

  v_result := public.create_counter_sale(p_payload);
  v_order_id := (v_result ->> 'order_id')::uuid;

  select o.store_id into v_store_id
  from public.orders o
  where o.id = v_order_id;

  with acknowledged as (
    update public.print_jobs pj
    set status = 'printed',
        printed_at = coalesce(pj.printed_at, now()),
        error = null
    where pj.order_id = v_order_id
      and pj.store_id = v_store_id
      and pj.status = 'queued'
      and (
        (pj.kind = 'receipt' and coalesce((p_local_print ->> 'receipt')::boolean, false))
        or (pj.kind = 'drawer' and coalesce((p_local_print ->> 'drawer')::boolean, false))
        or (
          pj.kind = 'order'
          and pj.station in (
            select jsonb_array_elements_text(coalesce(p_local_print -> 'stations', '[]'::jsonb))
          )
        )
      )
    returning pj.id, pj.kind, pj.station
  )
  insert into public.event_log (order_id, store_id, actor_user_id, type, payload)
  select
    v_order_id,
    v_store_id,
    v_uid,
    'print.local_acknowledged',
    jsonb_build_object('job_id', a.id, 'kind', a.kind, 'station', a.station)
  from acknowledged a;

  return v_result || jsonb_build_object('offline_sync', true);
end;
$$;

revoke all on function public.sync_counter_sale(jsonb, jsonb) from public, anon;
grant execute on function public.sync_counter_sale(jsonb, jsonb) to authenticated;
