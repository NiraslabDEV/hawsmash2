-- 1116: pedidos agendados para outro dia aparecem no painel.
--
-- Pedido do dono (23/10): um cliente fez na sexta um pedido para sábado e o
-- painel não o deixava ver. O "Dia actual" (1110) corta pela hora em que o
-- pedido foi FEITO; o site deixa agendar até três dias à frente. Ao fechar o
-- dia de sexta, o pedido de sábado passava para o Histórico — e no sábado não
-- voltava ao dia em curso, que é justamente quando tem de ser feito.
--
-- O que muda na get_orders:
--   * `day = 'current'` passa a incluir também os pedidos MARCADOS para hoje
--     (dia de calendário de Maputo), mesmo que tenham sido feitos antes. Os
--     feitos hoje continuam lá, marcados para hoje ou não: quem os aprova é o
--     turno de hoje.
--   * `day = 'scheduled'` (novo): os pedidos marcados de amanhã em diante, pela
--     ordem em que têm de sair — a hora marcada mais próxima primeiro.
--   * A resposta traz `scheduled_ahead`: quantos pedidos vivos estão marcados
--     de amanhã em diante (com o filtro de loja, sem os outros). É o aviso no
--     topo do painel, para um pedido destes nunca mais passar sem ser visto.
--
-- O resto do contrato (1045, 1110) fica igual: SECURITY INVOKER (RLS por loja),
-- paginação antes da agregação, total e contagens do mesmo snapshot.

create index if not exists orders_scheduled_for_idx
  on public.orders (scheduled_for)
  where scheduled_for is not null;

create or replace function public.get_orders(p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_search text := p_filters ->> 'search';
  v_limit int := greatest(1, least(coalesce((p_filters ->> 'limit')::int, 100), 500));
  v_offset int := greatest(coalesce((p_filters ->> 'offset')::int, 0), 0);
  v_store_slug text := nullif(p_filters ->> 'store', '');
  v_current_day boolean := coalesce(p_filters ->> 'day', '') = 'current';
  v_scheduled boolean := coalesce(p_filters ->> 'day', '') = 'scheduled';
  v_midnight timestamptz :=
    date_trunc('day', now() at time zone 'Africa/Maputo') at time zone 'Africa/Maputo';
  -- Moçambique não tem horário de verão: o dia tem sempre 24 horas.
  v_tomorrow timestamptz := v_midnight + interval '1 day';
  v_result jsonb;
begin
  with day_start as materialized (
    -- A RLS de cash_day_closes deixa ler só as lojas de quem pergunta; sem
    -- linha, a loja conta desde a meia-noite.
    select c.store_id, max(c.closed_at) as started_at
    from public.cash_day_closes c
    where v_current_day
    group by c.store_id
  ), base as materialized (
    select o.id, o.created_at, o.scheduled_for, o.status
    from public.orders o
    left join public.stores s on s.id = o.store_id
    left join day_start d on d.store_id = o.store_id
    where
      (p_filters ->> 'flow' is null or o.flow = p_filters ->> 'flow')
      and (p_filters ->> 'fulfillment_type' is null or o.fulfillment_type = p_filters ->> 'fulfillment_type')
      and (p_filters ->> 'channel' is null or o.channel = p_filters ->> 'channel')
      and (v_store_slug is null or s.slug = v_store_slug)
      and (not v_current_day
        or o.created_at >= coalesce(d.started_at, v_midnight)
        or (o.scheduled_for >= v_midnight and o.scheduled_for < v_tomorrow))
      and (not v_scheduled or o.scheduled_for >= v_tomorrow)
      and (p_filters ->> 'date_from' is null or o.created_at >= (p_filters ->> 'date_from')::timestamptz)
      and (p_filters ->> 'date_to' is null or o.created_at <= (p_filters ->> 'date_to')::timestamptz)
      and (v_search is null or length(v_search) = 0
        or o.order_number ilike '%' || v_search || '%'
        or o.customer_name ilike '%' || v_search || '%'
        or o.customer_phone ilike '%' || v_search || '%')
  ), filtered as materialized (
    select b.id, b.created_at, b.scheduled_for
    from base b
    where
      (p_filters ->> 'status' is null or b.status = p_filters ->> 'status')
      and (p_filters -> 'statuses' is null or (p_filters -> 'statuses') ? b.status)
  ), page as (
    -- Nos agendados manda a hora marcada; no resto, o mais recente primeiro.
    select f.id, f.created_at, f.scheduled_for
    from filtered f
    order by case when v_scheduled then f.scheduled_for end asc nulls last,
      f.created_at desc, f.id desc
    limit v_limit offset v_offset
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered),
    'status_counts', (
      select coalesce(jsonb_object_agg(x.status, x.n), '{}'::jsonb)
      from (select b.status, count(*) as n from base b group by b.status) x
    ),
    'scheduled_ahead', (
      select count(*)
      from public.orders o
      left join public.stores s on s.id = o.store_id
      where o.scheduled_for >= v_tomorrow
        and o.status not in ('cancelled', 'delivered', 'payment_failed', 'draft')
        and (v_store_slug is null or s.slug = v_store_slug)
    ),
    'limit', v_limit,
    'offset', v_offset,
    'orders', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', o.id,
        'store_id', o.store_id,
        'store_slug', s.slug,
        'store_name', s.short_name,
        'order_number', o.order_number,
        'daily_number', o.daily_number,
        'channel', o.channel,
        'status', o.status,
        'flow', o.flow,
        'fulfillment_type', o.fulfillment_type,
        'delivery_zone_id', o.delivery_zone_id,
        'address', o.address,
        'customer_name', o.customer_name,
        'customer_phone', o.customer_phone,
        'customer_email', o.customer_email,
        'scheduled_for', o.scheduled_for,
        'subtotal_cents', o.subtotal_cents,
        'delivery_fee_cents', o.delivery_fee_cents,
        'total_cents', o.total_cents,
        'payment_method', o.payment_method,
        'payment_proof_path', o.payment_proof_path,
        'needs_review', o.needs_review,
        'notes', o.notes,
        'created_at', o.created_at,
        'updated_at', o.updated_at,
        'items', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'id', oi.id,
            'menu_item_id', oi.menu_item_id,
            'name', oi.name_snapshot,
            'qty', oi.qty,
            'unit_price_cents', oi.unit_price_cents,
            'station', oi.station,
            'notes', oi.notes
          ) order by oi.id), '[]'::jsonb)
          from public.order_items oi
          where oi.order_id = o.id and oi.store_id = o.store_id
        )
      ) order by case when v_scheduled then p.scheduled_for end asc nulls last,
        p.created_at desc, p.id desc), '[]'::jsonb)
      from page p
      join public.orders o on o.id = p.id
      left join public.stores s on s.id = o.store_id
    )
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function public.get_orders(jsonb) from public, anon;
grant execute on function public.get_orders(jsonb) to authenticated, service_role;
