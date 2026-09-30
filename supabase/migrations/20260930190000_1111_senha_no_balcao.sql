-- HAWSMASH 2.0 — 1111: a senha pequena também nas vendas do balcão.
--
-- Pedido do dono (30 Set): "quero que saia um papel pequeno com o logo, com a
-- senha do cliente do POS." Até aqui a senha pequena (1092) só saía nos
-- pedidos de mesa; uma venda ao balcão saía nas vias do talão completo
-- (`stores.kitchen_ticket_copies`, 2 na loja) e o cliente ficava sem papel com
-- o número que a TV chama.
--
-- Agora cada venda do POS põe na fila, depois das vias, a senha pequena no
-- balcão: o logo (se o talão da loja o tiver ligado), SENHA em grande e o nome,
-- se o caixa o escreveu. Três papéis com as 2 vias da loja.
--
-- Regras que se mantêm:
--   · best-effort (regra 1): se a senha não entrar na fila, a venda fica e o
--     motivo fica em `event_log`;
--   · idempotente (regra 4): repetir o `client_sale_id` devolve a mesma venda,
--     e a senha bate no `(order_id, station, kind, reprint_seq)` — nunca sai
--     duas vezes;
--   · venda offline: a senha é um trabalho `receipt` no balcão, e a
--     sincronização (1065) marca `receipt` como impresso quando o POS imprimiu
--     o seu talão sem rede. Não sai, horas depois, um número que o cliente
--     nunca recebeu;
--   · sai depois das vias: a bridge lê a fila por `created_at`, e tudo o que a
--     venda cria tem o `now()` da transacção. A senha leva `clock_timestamp()`.
--
-- Forward-only: substitui o `create_counter_sale` da 1074 (o mesmo corpo, mais
-- a senha) e junta duas funções privadas.

-- ---------------------------------------------------------------------------
-- A senha pequena do balcão
-- ---------------------------------------------------------------------------
create or replace function private.build_counter_senha(p_order_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'template', 'senha',
    'store_short_name', s.short_name,
    'daily_number', o.daily_number,
    'table_number', null,
    -- 'Balcão' é o que create_counter_sale_unlocked grava sem nome: não é o
    -- nome de ninguém e não vai para o papel (como no talão completo, 1064).
    'customer_name', case
      when o.customer_name is null or btrim(o.customer_name) in ('', 'Balcão') then ''
      else btrim(o.customer_name)
    end,
    'order_number', o.order_number,
    'created_at', o.created_at,
    -- Formato herdado: um bridge sem a senha pequena imprime isto.
    'fulfillment_type', 'counter',
    'items', '[]'::jsonb,
    'payment_method', 'no_payment',
    'total_cents', o.total_cents
  )
  from public.orders o
  join public.stores s on s.id = o.store_id
  where o.id = p_order_id;
$$;

revoke all on function private.build_counter_senha(uuid) from public, anon, authenticated;

create or replace function private.enqueue_counter_senha(p_order_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store_id uuid;
  v_job_id uuid;
begin
  select o.store_id into v_store_id
  from public.orders o
  where o.id = p_order_id
    and o.channel = 'counter';
  if not found then
    return null;
  end if;

  insert into public.print_jobs (
    store_id, order_id, station, kind, reprint_seq, payload, created_at
  ) values (
    v_store_id, p_order_id, 'counter', 'receipt', 0,
    private.build_counter_senha(p_order_id),
    pg_catalog.clock_timestamp()
  )
  on conflict (order_id, station, kind, reprint_seq) do nothing
  returning id into v_job_id;

  if v_job_id is not null then
    insert into public.event_log (order_id, store_id, actor_user_id, type, payload)
    values (p_order_id, v_store_id, (select auth.uid()), 'print.counter_senha_queued',
      jsonb_build_object('job_id', v_job_id));
  end if;

  return v_job_id;
end;
$$;

revoke all on function private.enqueue_counter_senha(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- A venda de balcão: o corpo da 1074, mais a senha
-- ---------------------------------------------------------------------------
create or replace function public.create_counter_sale(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
  v_order_id uuid;
begin
  result := private.create_counter_sale_before_upsell(p_payload);
  v_order_id := (result ->> 'order_id')::uuid;

  begin
    perform private.record_order_upsells(v_order_id, p_payload);
  exception when others then
    raise warning 'upsell_tracking_failed: %', sqlstate;
  end;

  -- O papel é best-effort (regra 1): sem a senha, a venda fica.
  begin
    perform private.enqueue_counter_senha(v_order_id);
  exception when others then
    begin
      insert into public.event_log (order_id, store_id, actor_user_id, type, payload)
      select o.id, o.store_id, (select auth.uid()), 'print.counter_senha_failed',
        jsonb_build_object('error', sqlstate)
      from public.orders o
      where o.id = v_order_id;
    exception when others then
      null;
    end;
  end;

  return result;
end;
$$;

revoke all on function public.create_counter_sale(jsonb) from public, anon;
grant execute on function public.create_counter_sale(jsonb) to authenticated;
