-- HAWSMASH 2.0 — 1062: a mesma comanda em todos os canais, e em duas vias.
--
-- 1. Uma comanda só. A venda de balcão imprime a comanda HAWSMASH (payload de
--    `build_sale_print_payload`, com `template: 'kitchen'` — número do dia
--    grande, loja, canal). Mas a aprovação de um pedido online e a confirmação
--    de um pagamento digital passam pelo motor herdado, que põe na fila uma
--    comanda no formato antigo, sem `template`. A bridge não a reconhece como
--    comanda e imprime-a no layout genérico. Na cozinha, um pedido da internet
--    saía com cara de outra coisa (23 Set).
--
--    Não se reescreve o motor herdado: a peça nova tira da fila a comanda
--    antiga, na mesma transacção, e põe a padrão no lugar. A bridge só vê o
--    que já foi confirmado, por isso nunca chega a ver a antiga.
--
-- 2. Duas vias. Decisão do dono (23 Set): a comanda da cozinha sai duas vezes
--    — uma fica de reserva, a outra vai para a cozinha e depois cola-se no
--    saco que sai para o cliente. Fica em `stores.kitchen_ticket_copies`, por
--    loja, porque é operação da unidade (§5.1), e não em código.
--
--    Cada via é um trabalho de impressão próprio (`reprint_seq` 0, 1, …). Assim
--    a bridge que já está nas lojas não precisa de ser actualizada, e a
--    idempotência de `unique (order_id, station, kind, reprint_seq)` (§11.2)
--    continua a garantir que repetir não duplica. A reimpressão calcula
--    `max(reprint_seq) + 1`, portanto continua a funcionar e a sair uma folha.
--    As vias só se aplicam à estação da cozinha: a do balcão sai uma vez.
--
-- Mesas (`dine_in`) ficam como estão: têm comanda própria, agrupada por
-- pessoa, e não entram na Fase 1.

alter table public.stores
  add column if not exists kitchen_ticket_copies smallint not null default 2;

alter table public.stores drop constraint if exists stores_kitchen_ticket_copies_check;
alter table public.stores
  add constraint stores_kitchen_ticket_copies_check
  check (kitchen_ticket_copies between 1 and 3);

grant select (kitchen_ticket_copies) on public.stores to authenticated;

-- ---------------------------------------------------------------------------
-- A peça única que põe comandas na fila
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
  v_vias integer;
  v_station text;
  v_via integer;
  v_job_id uuid;
  v_criados integer := 0;
begin
  select o.store_id, o.channel, s.kitchen_ticket_copies
  into v_store_id, v_channel, v_vias
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

  for v_station in
    select distinct private.print_station(oi.station)
    from public.order_items oi
    where oi.order_id = p_order_id
      and oi.store_id = v_store_id
  loop
    for v_via in 0 .. (case when v_station = 'kitchen' then greatest(coalesce(v_vias, 1), 1) else 1 end) - 1 loop
      v_job_id := null;
      insert into public.print_jobs (
        store_id, order_id, station, kind, reprint_seq, payload
      ) values (
        v_store_id,
        p_order_id,
        v_station,
        'order',
        v_via,
        private.build_sale_print_payload(p_order_id, 'order', v_station)
      )
      on conflict (order_id, station, kind, reprint_seq) do nothing
      returning id into v_job_id;

      if v_job_id is not null then
        v_criados := v_criados + 1;
        insert into public.event_log (
          order_id, store_id, actor_user_id, type, payload
        ) values (
          p_order_id,
          v_store_id,
          (select auth.uid()),
          'print.sale_job_queued',
          jsonb_build_object(
            'job_id', v_job_id,
            'kind', 'order',
            'station', v_station,
            'via', v_via + 1
          )
        );
      end if;
    end loop;
  end loop;

  return v_criados;
end;
$$;

revoke all on function private.enqueue_kitchen_tickets(uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Aprovação (pedido manual): a partir da 1046, mais a comanda padrão
-- ---------------------------------------------------------------------------
create or replace function public.advance_order(
  p_order_id uuid,
  p_event text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store_id uuid;
  v_status text;
  v_flow text;
  v_resultado jsonb;
begin
  if p_event = 'PAYMENT_FAILED' then
    if not coalesce((select auth.jwt() ->> 'role') = 'service_role', false) then
      raise exception 'payment_transition_denied' using errcode = 'P0403';
    end if;
    select o.store_id, o.status, o.flow into v_store_id, v_status, v_flow
    from public.orders o where o.id = p_order_id for update;
    if not found then raise exception 'order_not_found' using errcode = 'P0404'; end if;
    if v_flow is distinct from 'digital' or v_status is distinct from 'awaiting_payment' then
      return jsonb_build_object('success', true, 'order_id', p_order_id,
        'status', v_status, 'new_status', v_status, 'unchanged', true);
    end if;
    update public.orders set status = 'payment_failed', updated_at = now()
    where id = p_order_id and store_id = v_store_id and status = 'awaiting_payment';
    insert into public.event_log (store_id, order_id, actor_user_id, type, payload)
    values (v_store_id, p_order_id, (select auth.uid()), 'payment.failed',
      jsonb_build_object('source', 'advance_order', 'reason', left(p_reason, 500),
        'previous_status', v_status, 'new_status', 'payment_failed'));
    return jsonb_build_object('success', true, 'order_id', p_order_id,
      'status', 'payment_failed', 'new_status', 'payment_failed');
  end if;
  if not private.can_access_order(p_order_id) then
    raise exception 'store_access_denied' using errcode = 'P0403';
  end if;
  select o.store_id into v_store_id from public.orders o where o.id = p_order_id;
  perform set_config('app.request_store_id', v_store_id::text, true);

  v_resultado := private.advance_order_legacy(p_order_id, p_event, p_reason);

  -- Aprovar é o que manda o pedido para a cozinha: aqui passa a sair a
  -- comanda HAWSMASH, nas vias que a loja pede.
  if p_event = 'APPROVE' then
    perform private.enqueue_kitchen_tickets(p_order_id);
  end if;

  return v_resultado;
end;
$$;

revoke all on function public.advance_order(uuid, text, text) from public, anon;
grant execute on function public.advance_order(uuid, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Pagamento digital confirmado: a partir da 1004, mais a comanda padrão
-- ---------------------------------------------------------------------------
create or replace function public.confirm_payment(
  p_idempotency_key text,
  p_order_id uuid,
  p_provider text,
  p_provider_ref text,
  p_method text,
  p_amount_cents integer,
  p_raw_webhook jsonb default '{}'::jsonb
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store_id uuid;
  v_resultado text;
begin
  if not private.can_access_order(p_order_id) then
    raise exception 'store_access_denied' using errcode = 'P0403';
  end if;

  select o.store_id into v_store_id
  from public.orders o
  where o.id = p_order_id;
  perform set_config('app.request_store_id', v_store_id::text, true);

  v_resultado := private.confirm_payment_legacy(
    p_idempotency_key,
    p_order_id,
    p_provider,
    p_provider_ref,
    p_method,
    p_amount_cents,
    p_raw_webhook
  );

  -- Só a primeira confirmação manda para a cozinha. Um webhook repetido
  -- devolve outra coisa, e a unicidade da fila apanharia o resto na mesma.
  if v_resultado = 'ok' then
    perform private.enqueue_kitchen_tickets(p_order_id);
  end if;

  return v_resultado;
end;
$$;

revoke all on function public.confirm_payment(text, uuid, text, text, text, integer, jsonb)
  from public, anon;
grant execute on function public.confirm_payment(text, uuid, text, text, text, integer, jsonb)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Venda de balcão: a partir da 1039, com as comandas pela mesma peça
-- ---------------------------------------------------------------------------
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
  v_job_id uuid;
  v_uid uuid := (select auth.uid());
  v_customer_phone text;
  v_customer_name text;
begin
  v_result := public.create_counter_sale_without_tickets(p_payload);
  v_order_id := (v_result ->> 'order_id')::uuid;

  select o.store_id, o.customer_phone
  into v_store_id, v_customer_phone
  from public.orders o
  where o.id = v_order_id;

  -- Do payload, não de orders.customer_name: essa coluna já caiu para
  -- 'Balcão' quando ninguém escreveu nome nenhum (create_counter_sale
  -- _unlocked), e 'Balcão' não é o nome de ninguém — gravá-lo em `customers`
  -- apagaria o nome real de quem só desta vez não o repetiu.
  v_customer_name := nullif(btrim(p_payload ->> 'customerName'), '');

  if v_customer_phone is not null then
    begin
      perform public.identify_customer(v_customer_phone, v_customer_name);
    exception when others then
      insert into public.event_log (
        order_id, store_id, actor_user_id, type, payload
      ) values (
        v_order_id,
        v_store_id,
        v_uid,
        'customer.identify_failed',
        jsonb_build_object('error', sqlstate)
      );
    end;
  end if;

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

    -- As comandas saem pela mesma peça que a aprovação online: uma comanda
    -- só, nas vias que a loja pede.
    perform private.enqueue_kitchen_tickets(v_order_id);
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
