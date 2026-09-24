-- HAWSMASH 2.0 — 1076: senhas chamadas do balcão.
--
-- Pedido do dono, 24 Set: na barra lateral do POS, por baixo de Delivery, uma
-- aba Senhas. O caixa digita o número que a cozinha acabou de pôr no balcão e
-- a TV mostra PEDIDO PRONTO. Sem isto, só o quadro de Pedidos punha um pedido
-- em `ready` — dois toques por pedido, a procurar o cartão certo.
--
-- 1. `call_ticket(loja, senha)` encontra o pedido de hoje com esse número do
--    dia e leva-o a `ready` pelo `advance_order` (§12: o estado só muda por
--    ali). Um pedido ainda `paid`/`approved` passa por `in_preparation` na
--    mesma transacção — a máquina de estados não se salta, anda-se depressa.
--    Repetir a mesma senha devolve o mesmo pedido e não escreve nada (regra 4).
--    Pedido da internet por aprovar ou por pagar não vai para a TV.
--
-- 2. `get_store_queue` passa a dizer o tipo do pedido (canal e entrega), para
--    a TV escrever BALCÃO, LEVANTAMENTO ou ENTREGA por baixo do número.
--    Continua sem nomes, telefones nem valores: a TV é pública.

create or replace function public.call_ticket(p_store_id uuid, p_daily_number integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order record;
  v_day_start timestamptz := ((now() at time zone 'Africa/Maputo')::date::timestamp
    at time zone 'Africa/Maputo');
begin
  if not private.auth_can_store(p_store_id) then
    raise exception 'store_access_denied' using errcode = 'P0403';
  end if;

  -- O número do dia reinicia todos os dias: só vale o de hoje. Se por acaso
  -- houver dois (um contador reposto à mão), manda o que ainda está vivo.
  select o.id, o.status, o.daily_number, o.order_number, o.channel, o.fulfillment_type
  into v_order
  from public.orders o
  where o.store_id = p_store_id
    and o.daily_number = p_daily_number
    and o.created_at >= v_day_start
  order by (o.status in ('paid', 'approved', 'in_preparation', 'ready')) desc, o.created_at desc
  limit 1
  for update;

  if not found then
    raise exception 'ticket_not_found' using errcode = 'P0404';
  end if;

  if v_order.status = 'ready' then
    return jsonb_build_object(
      'order_id', v_order.id, 'daily_number', v_order.daily_number,
      'order_number', v_order.order_number, 'channel', v_order.channel,
      'fulfillment_type', v_order.fulfillment_type, 'status', 'ready',
      'already_ready', true);
  end if;
  if v_order.status = 'delivered' then
    raise exception 'ticket_already_delivered' using errcode = 'P0409';
  end if;
  if v_order.status = 'cancelled' then
    raise exception 'ticket_cancelled' using errcode = 'P0409';
  end if;
  if v_order.status not in ('paid', 'approved', 'in_preparation') then
    raise exception 'ticket_not_paid' using errcode = 'P0409';
  end if;

  if v_order.status in ('paid', 'approved') then
    perform public.advance_order(v_order.id, 'START_PREPARATION', null);
  end if;
  perform public.advance_order(v_order.id, 'MARK_READY', null);

  insert into public.event_log (store_id, order_id, actor_user_id, type, payload)
  values (p_store_id, v_order.id, (select auth.uid()), 'ticket.called',
    jsonb_build_object('source', 'pos_senhas', 'daily_number', v_order.daily_number,
      'previous_status', v_order.status));

  return jsonb_build_object(
    'order_id', v_order.id, 'daily_number', v_order.daily_number,
    'order_number', v_order.order_number, 'channel', v_order.channel,
    'fulfillment_type', v_order.fulfillment_type, 'status', 'ready',
    'already_ready', false);
end;
$$;

revoke all on function public.call_ticket(uuid, integer) from public, anon;
grant execute on function public.call_ticket(uuid, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- A TV passa a saber o tipo de cada senha pronta
-- ---------------------------------------------------------------------------
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
        'fulfillment_type', o.fulfillment_type,
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
