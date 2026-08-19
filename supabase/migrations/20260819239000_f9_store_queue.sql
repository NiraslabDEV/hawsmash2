-- HAWSMASH 2.0 — F9: fila de senhas para a TV do balcão (CLAUDE §14).
--
-- A TV corre sem sessão, num ecrã à vista de toda a gente: devolve números,
-- nunca nomes, telefones ou valores.

create or replace function public.get_store_queue(p_store_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_store public.stores%rowtype;
  v_day_start timestamptz := ((now() at time zone 'Africa/Maputo')::date::timestamp
    at time zone 'Africa/Maputo');
begin
  select s.*
  into v_store
  from public.stores s
  where s.slug = p_store_slug
    and s.active;

  if not found then
    raise exception 'store_not_found' using errcode = 'P0404';
  end if;

  return jsonb_build_object(
    'store', jsonb_build_object(
      'slug', v_store.slug,
      'short_name', v_store.short_name
    ),
    'updated_at', now(),
    'ready', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'daily_number', o.daily_number,
        'order_number', o.order_number,
        'channel', o.channel,
        'ready_at', o.updated_at
      ) order by o.updated_at desc), '[]'::jsonb)
      from public.orders o
      where o.store_id = v_store.id
        and o.status = 'ready'
        and o.created_at >= v_day_start
        and o.daily_number is not null
    ),
    'preparing', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'daily_number', o.daily_number,
        'order_number', o.order_number
      ) order by o.created_at), '[]'::jsonb)
      from public.orders o
      where o.store_id = v_store.id
        and o.status in ('paid', 'approved', 'in_preparation')
        and o.created_at >= v_day_start
        and o.daily_number is not null
    )
  );
end;
$$;

revoke all on function public.get_store_queue(text) from public;
grant execute on function public.get_store_queue(text) to anon, authenticated, service_role;
