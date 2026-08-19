-- HAWSMASH 2.0 — F7 / 1009: entrada pública com escolha de loja.
--
-- O cliente escolhe a loja antes de ver preços, zonas ou horários. Esta RPC é
-- a única porta anónima para a lista de lojas: devolve o que a página de
-- entrada precisa e nada do que é segredo (chaves Paysuite, e-mail do dono).

create or replace function public.list_public_stores()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_local timestamp := (v_now at time zone 'Africa/Maputo');
begin
  return coalesce(
    (
      select jsonb_agg(entry order by entry.sort, entry.short_name)
      from (
        select
          s.slug,
          s.name,
          s.short_name,
          s.address,
          s.phone,
          s.maps_url,
          s.accepting_orders,
          s.delivery_enabled,
          s.pickup_enabled,
          s.sort,
          exists (
            select 1
            from public.store_hours h
            where h.store_id = s.id
              and h.active
              and h.dow = extract(dow from v_local)::smallint
              and (
                (h.closes > h.opens and v_local::time >= h.opens and v_local::time < h.closes)
                -- Horário que atravessa a meia-noite conta como aberto até fechar.
                or (h.closes <= h.opens and (v_local::time >= h.opens or v_local::time < h.closes))
              )
          ) as open_now,
          (
            select coalesce(jsonb_agg(jsonb_build_object(
              'dow', h.dow,
              'opens', h.opens,
              'closes', h.closes,
              'active', h.active
            ) order by h.dow), '[]'::jsonb)
            from public.store_hours h
            where h.store_id = s.id
          ) as hours
        from public.stores s
        where s.active
      ) entry
    ),
    '[]'::jsonb
  );
end;
$$;

revoke all on function public.list_public_stores() from public;
grant execute on function public.list_public_stores() to anon, authenticated, service_role;
