-- HAWSMASH 2.0 — 1039: o balcão também reconhece o cliente.
--
-- O PEDIDO: a atendente pega o telefone da pessoa antes de fechar a venda e o
-- sistema já diz quem é — e essa compra presencial passa a contar na mesma
-- ficha do cliente que a loja online já usa.
--
-- O que já existia: `identify_customer(phone, name)` (loja §9) faz exactamente
-- isto — upsert em `customers`, devolve nome/pedidos/total/favoritos — mas só
-- era chamada pelo site. O balcão gravava `orders.customer_phone` (a RPC do
-- POS sempre aceitou o campo, para a "entrega vendida ao balcão") e ficava
-- por aí: nenhuma venda de balcão tocava a tabela `customers`. Por isso é que
-- ela estava vazia mesmo havendo dezenas de vendas com telefone gravado.
--
-- A correcção não mexe na lógica de preço/stock/pagamento (create_counter_sale
-- _unlocked, a camada mais funda e mais arriscada de tocar) — entra na camada
-- mais de fora, `create_counter_sale`, ao lado da impressão e da gaveta:
-- depois da venda gravada, se veio telefone, chama identify_customer outra
-- vez (o POS já a chamou ao digitar o número, para mostrar quem é ANTES de
-- fechar a venda) para os totais incluírem esta compra que acabou de entrar.
-- Best-effort, como tudo aqui: se falhar, fica no event_log e a venda continua
-- — reconhecer o cliente nunca pode ser a razão de uma venda não fechar.

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
