-- HAWSMASH 2.0 — 1063: o pedido online sai no talão do HAWSMASH 1.0, em vias.
--
-- A 1062 pôs o pedido online a sair na comanda HAWSMASH, em duas vias iguais.
-- O dono viu-a em papel e pediu outra coisa (23 Set): o talão que a loja já
-- usava no 1.0 — e que o SLICE usa — tudo num só papel, com o cliente, o
-- horário em grande, os artigos com preço, os totais, a forma de pagamento e o
-- rodapé que agradece pelo nome. Duas vias com o mesmo conteúdo e o rótulo
-- diferente: a VIA DE CONTROLO fica na loja, a VIA DO CLIENTE vai para a
-- cozinha e depois cola-se no saco.
--
-- Compatibilidade, que é o que torna isto seguro de lançar: o payload continua
-- a ser `template: 'kitchen'`, só com campos a mais. Uma bridge que ainda não
-- conheça o talão completo ignora-os e imprime a comanda HAWSMASH, como com a
-- 1062. A bridge nova vê `formato: 'talao_completo'` e imprime o talão. Base e
-- bridges das lojas podem ser actualizadas por qualquer ordem.
--
-- O balcão volta a uma comanda só. Aí o cliente está à frente do caixa e leva
-- o talão dele na mão; a segunda via era papel sem destino.
--
-- Nada da marca vem escrito aqui: morada e telefone são da loja; o Instagram e
-- o link de avaliação no Google são da marca (`brand_settings`, §18.2).

comment on column public.stores.kitchen_ticket_copies is
  'Vias do talão de um pedido online: 1 = uma via sem rótulo; 2 = controlo + cliente; 3 = controlo + cliente + cozinha. O balcão sai sempre com uma comanda.';

-- ---------------------------------------------------------------------------
-- O talão completo de um pedido online
-- ---------------------------------------------------------------------------
create or replace function private.build_online_ticket_payload(p_order_id uuid, p_via text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'template', 'kitchen',
    'formato', 'talao_completo',
    'via', p_via,
    'station', 'kitchen',
    'store_short_name', s.short_name,
    'store_address', s.address,
    'store_phone', s.phone,
    'receipt_footer', s.receipt_footer,
    'order_number', o.order_number,
    'daily_number', o.daily_number,
    'channel', o.channel,
    'fulfillment_type', o.fulfillment_type,
    'customer_name', o.customer_name,
    'customer_phone', o.customer_phone,
    'address', o.address,
    'delivery_zone', (
      select z.name from public.delivery_zones z where z.id = o.delivery_zone_id
    ),
    'scheduled_for', o.scheduled_for,
    'items', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'name', oi.name_snapshot,
          'quantity', oi.qty,
          'notes', oi.notes,
          'line_total_cents', oi.unit_price_cents * oi.qty
        ) order by oi.id
      ), '[]'::jsonb)
      from public.order_items oi
      where oi.order_id = o.id
        and oi.store_id = o.store_id
    ),
    'notes', o.notes,
    'subtotal_cents', o.subtotal_cents,
    'delivery_fee_cents', o.delivery_fee_cents,
    'discount_cents', o.discount_cents,
    'total_cents', o.total_cents,
    'payment_method', o.payment_method,
    'review_url', nullif(btrim(coalesce(b.social ->> 'google_review', '')), ''),
    'instagram', nullif(btrim(coalesce(b.contact ->> 'instagram', '')), ''),
    'instagram_url', nullif(btrim(coalesce(b.social ->> 'instagram', '')), ''),
    'created_at', o.created_at
  )
  from public.orders o
  join public.stores s on s.id = o.store_id
  left join public.brand_settings b on b.id = 1
  where o.id = p_order_id;
$$;

revoke all on function private.build_online_ticket_payload(uuid, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- A peça que põe papel na fila: balcão e online, cada um com o seu
-- ---------------------------------------------------------------------------
create or replace function private.enqueue_kitchen_tickets(p_order_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store_id uuid;
  v_channel text;
  v_copias integer;
  v_vias text[];
  v_station text;
  v_i integer;
  v_job_id uuid;
  v_criados integer := 0;
begin
  select o.store_id, o.channel, s.kitchen_ticket_copies
  into v_store_id, v_channel, v_copias
  from public.orders o
  join public.stores s on s.id = o.store_id
  where o.id = p_order_id;

  if not found or v_channel = 'dine_in' then
    return 0;
  end if;

  -- A comanda no formato antigo que o motor herdado acabou de pôr na fila,
  -- nesta mesma transacção. Ainda ninguém a viu.
  delete from public.print_jobs pj
  where pj.order_id = p_order_id
    and pj.kind = 'order'
    and pj.status = 'queued'
    and not (pj.payload ? 'template');

  if v_channel = 'counter' then
    -- Balcão: uma comanda curta por estação. O cliente leva o talão dele.
    for v_station in
      select distinct private.print_station(oi.station)
      from public.order_items oi
      where oi.order_id = p_order_id
        and oi.store_id = v_store_id
    loop
      v_job_id := null;
      insert into public.print_jobs (
        store_id, order_id, station, kind, reprint_seq, payload
      ) values (
        v_store_id,
        p_order_id,
        v_station,
        'order',
        0,
        private.build_sale_print_payload(p_order_id, 'order', v_station)
      )
      on conflict (order_id, station, kind, reprint_seq) do nothing
      returning id into v_job_id;

      if v_job_id is not null then
        v_criados := v_criados + 1;
        insert into public.event_log (order_id, store_id, actor_user_id, type, payload)
        values (p_order_id, v_store_id, (select auth.uid()), 'print.sale_job_queued',
          jsonb_build_object('job_id', v_job_id, 'kind', 'order', 'station', v_station));
      end if;
    end loop;
    return v_criados;
  end if;

  -- Online: o talão completo, uma via por trabalho, na impressora da cozinha.
  v_vias := case greatest(coalesce(v_copias, 2), 1)
    when 1 then array[null]::text[]
    when 2 then array['controlo', 'cliente']
    else array['controlo', 'cliente', 'cozinha']
  end;

  for v_i in 1 .. array_length(v_vias, 1) loop
    v_job_id := null;
    insert into public.print_jobs (
      store_id, order_id, station, kind, reprint_seq, payload
    ) values (
      v_store_id,
      p_order_id,
      'kitchen',
      'order',
      v_i - 1,
      private.build_online_ticket_payload(p_order_id, v_vias[v_i])
    )
    on conflict (order_id, station, kind, reprint_seq) do nothing
    returning id into v_job_id;

    if v_job_id is not null then
      v_criados := v_criados + 1;
      insert into public.event_log (order_id, store_id, actor_user_id, type, payload)
      values (p_order_id, v_store_id, (select auth.uid()), 'print.sale_job_queued',
        jsonb_build_object('job_id', v_job_id, 'kind', 'order', 'station', 'kitchen',
          'via', v_vias[v_i]));
    end if;
  end loop;

  return v_criados;
end;
$$;

revoke all on function private.enqueue_kitchen_tickets(uuid)
  from public, anon, authenticated;
