-- 1020 — dois talões por venda, e não três.
--
-- Medido no balcão: cada venda cuspia o talão do cliente, uma comanda de
-- cozinha e — sempre que houvesse uma bebida — mais uma comanda de bar. Três
-- papelinhos por venda, num sítio onde a bebida sai do mesmo frigorífico que o
-- lanche e onde não há barman nenhum.
--
-- O CLAUDE.md §8.1 já dizia que o station=bar é herança do motor e que o
-- "HAWSMASH usa kitchen + counter". Era a base de dados que continuava a tratar
-- o bar como uma estação com impressora própria.
--
-- Passam a ser exactamente dois papéis por venda:
--   counter/receipt — o talão do cliente
--   kitchen/order   — UMA comanda com tudo o que se prepara, bebidas incluídas
--
-- Não se apaga o conceito de estação: order_items.station continua a distinguir
-- bar de cozinha, porque serve o KDS da Fase 2 e uma loja que um dia tenha bar
-- a sério. O que muda é só para onde vai o papel.

-- Uma função só a decidir em que papel sai cada item. Estava escrita à mão em
-- dois sítios com o mesmo CASE — e é assim que dois sítios divergem.
create or replace function private.print_station(p_station text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_station = 'counter' then 'counter' else 'kitchen' end;
$$;

revoke all on function private.print_station(text) from public, anon, authenticated;

create or replace function private.build_sale_print_payload(
  p_order_id uuid,
  p_kind text,
  p_station text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_payload jsonb;
begin
  if p_kind not in ('order', 'receipt') then
    raise exception 'invalid_print_kind' using errcode = 'P0007';
  end if;

  if p_kind = 'order' then
    select jsonb_build_object(
      'template', 'kitchen',
      'store_short_name', s.short_name,
      'order_number', o.order_number,
      'daily_number', o.daily_number,
      'channel', o.channel,
      'customer_name', o.customer_name,
      'station', p_station,
      'items', (
        select coalesce(jsonb_agg(
          jsonb_build_object(
            'name', oi.name_snapshot,
            'quantity', oi.qty,
            'notes', oi.notes
          ) order by oi.id
        ), '[]'::jsonb)
        from public.order_items oi
        where oi.order_id = o.id
          and oi.store_id = o.store_id
          -- Tudo o que nao e balcao prepara-se na cozinha e sai numa comanda so.
          and private.print_station(oi.station) = p_station
      ),
      'notes', o.notes,
      'created_at', o.created_at
    )
    into v_payload
    from public.orders o
    join public.stores s on s.id = o.store_id
    where o.id = p_order_id;
  else
    select jsonb_build_object(
      'template', 'receipt',
      'store_short_name', s.short_name,
      'store_address', s.address,
      'store_phone', s.phone,
      'receipt_footer', s.receipt_footer,
      'order_number', o.order_number,
      'daily_number', o.daily_number,
      'customer_name', o.customer_name,
      'items', (
        select coalesce(jsonb_agg(
          jsonb_build_object(
            'name', oi.name_snapshot,
            'quantity', oi.qty,
            'unit_price_cents', oi.unit_price_cents,
            'line_total_cents', oi.unit_price_cents * oi.qty,
            'notes', oi.notes
          ) order by oi.id
        ), '[]'::jsonb)
        from public.order_items oi
        where oi.order_id = o.id
          and oi.store_id = o.store_id
      ),
      'subtotal_cents', o.subtotal_cents,
      'delivery_fee_cents', o.delivery_fee_cents,
      'total_cents', o.total_cents,
      'payments', (
        select coalesce(jsonb_agg(
          jsonb_build_object(
            'method', p.method,
            'amount_cents', p.amount_cents
          ) order by p.created_at, p.id
        ), '[]'::jsonb)
        from public.payments p
        where p.order_id = o.id
          and p.store_id = o.store_id
          and p.status = 'confirmed'
      ),
      'cash_received_cents', o.cash_received_cents,
      'change_cents', o.change_cents,
      'created_at', o.created_at
    )
    into v_payload
    from public.orders o
    join public.stores s on s.id = o.store_id
    where o.id = p_order_id;
  end if;

  if v_payload is null then
    raise exception 'order_not_found' using errcode = 'P0002';
  end if;
  return v_payload;
end;
$$;

create or replace function public.create_counter_sale(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_order_id uuid;
  v_store_id uuid;
  v_station text;
  v_job_id uuid;
  v_uid uuid := (select auth.uid());
begin
  v_result := public.create_counter_sale_without_tickets(p_payload);
  v_order_id := (v_result ->> 'order_id')::uuid;

  select o.store_id into v_store_id
  from public.orders o
  where o.id = v_order_id;

  begin
    v_job_id := null;
    insert into public.print_jobs (
      store_id, order_id, station, kind, reprint_seq, payload
    ) values (
      v_store_id,
      v_order_id,
      'counter',
      'receipt',
      0,
      private.build_sale_print_payload(v_order_id, 'receipt', null)
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
        'print.sale_job_queued',
        jsonb_build_object('job_id', v_job_id, 'kind', 'receipt', 'station', 'counter')
      );
    end if;

    for v_station in
      select distinct private.print_station(oi.station)
      from public.order_items oi
      where oi.order_id = v_order_id
        and oi.store_id = v_store_id
    loop
      v_job_id := null;
      insert into public.print_jobs (
        store_id, order_id, station, kind, reprint_seq, payload
      ) values (
        v_store_id,
        v_order_id,
        v_station,
        'order',
        0,
        private.build_sale_print_payload(v_order_id, 'order', v_station)
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
          'print.sale_job_queued',
          jsonb_build_object('job_id', v_job_id, 'kind', 'order', 'station', v_station)
        );
      end if;
    end loop;
  exception when others then
    begin
      insert into public.event_log (
        order_id, store_id, actor_user_id, type, payload
      ) values (
        v_order_id,
        v_store_id,
        v_uid,
        'print.sale_enqueue_failed',
        jsonb_build_object('error', sqlstate)
      );
    exception when others then
      null;
    end;
  end;

  return v_result;
end;
$$;
