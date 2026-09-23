-- HAWSMASH 2.0 — 1065: uma venda offline não volta a imprimir a via de controlo.
--
-- Sem rede, o POS imprime na hora, pela bridge da loja (HTTP local), o talão do
-- cliente ao balcão e a comanda na cozinha — e ao sincronizar diz ao servidor
-- o que já saiu: `receipt: true`, `stations: ['kitchen']`. O servidor marca
-- esses trabalhos como impressos para a bridge não os repetir.
--
-- A 1064 mudou os papéis: uma venda passa a ter dois talões completos, a VIA
-- DE CONTROLO na estação do balcão (kind 'order') e a VIA DO CLIENTE na
-- cozinha. A regra antiga reconhecia 'receipt' e as estações da cozinha, mas
-- não esta via — e a VIA DE CONTROLO ficava na fila e saía quando a rede
-- voltasse, um papel a mais por cada venda offline. Apanhado pelo teste de
-- sincronização do pos.test (23 Set).
--
-- Agora o talão impresso localmente ao balcão conta como a via de controlo.
-- O resto da função é o da f4_price_reconciliation, sem mais mudanças.

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
        -- O talão que o POS imprimiu ao balcão é a via de controlo (1064).
        or (pj.kind = 'order' and pj.station = 'counter'
          and pj.payload ->> 'via' = 'controlo'
          and coalesce((p_local_print ->> 'receipt')::boolean, false))
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
