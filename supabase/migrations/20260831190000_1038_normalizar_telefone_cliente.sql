-- HAWSMASH 2.0 — 1038: um telefone, uma pessoa.
--
-- O "Top 10 Clientes" da Análise mostrava a mesma pessoa em três linhas
-- diferentes: "GABRIEL DOS SANTOS" com +258853860621, "Gab" com 853860621
-- (o mesmo número, só sem o indicativo do país) e ainda "Kaio" com o mesmo
-- 853860621 — um nome diferente a cada compra, o mesmo telefone sempre.
--
-- Dois problemas empilhados:
--   1. O telefone era gravado como veio do formulário — às vezes com "+258"
--      à frente, às vezes sem. "853860621" e "+258853860621" são a mesma
--      pessoa, mas comparavam como strings diferentes em toda a parte que
--      agrupa por telefone.
--   2. get_dashboard_metrics.top_customers agrupava por (nome, telefone) —
--      mesmo com o telefone limpo, duas compras com nomes diferentes no
--      mesmo número continuavam a aparecer em linhas separadas.
--
-- A correcção fixa a identidade no telefone, não no nome (é a mesma regra
-- que já vale para `customers.phone`, chave primária desde a 1023/loja §9):
--   · private.normalize_phone() — só dígitos, sempre os últimos 9 (o formato
--     local moçambicano, o mesmo que já se usa em mpesa_number/emola_number);
--   · dados existentes corrigidos uma vez (orders, customers e o que
--     depende dele);
--   · triggers em orders e customers para que isto nunca mais aconteça;
--   · identify_customer / get_customer_orders / account_request_code /
--     account_verify_code passam a normalizar o telefone recebido antes de
--     o usar numa comparação — senão continuavam a não encontrar as compras
--     de quem escreve o número com o indicativo;
--   · top_customers agrupa por telefone (quando existe) e mostra o nome
--     mais recente usado nesse número — "Balcão"/"Teste Caixa" sem telefone
--     continuam agrupados por nome, como antes.
--
-- Forward-only e idempotente (§11.7): a fusão de duplicados só mexe em quem
-- ainda estiver por normalizar; correr duas vezes não faz nada da segunda vez.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. A função de normalização
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function private.normalize_phone(p_phone text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_phone is null or btrim(p_phone) = '' then null
    when length(regexp_replace(p_phone, '\D', '', 'g')) >= 9
      then right(regexp_replace(p_phone, '\D', '', 'g'), 9)
    else nullif(regexp_replace(p_phone, '\D', '', 'g'), '')
  end;
$$;

comment on function private.normalize_phone(text) is
  'Só dígitos, sempre os últimos 9 — tira +258/00258/258 e qualquer formatação. '
  'É a única definição de "o mesmo telefone" no sistema; usar sempre esta, nunca comparar texto cru.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Corrigir o que já está gravado
-- ═══════════════════════════════════════════════════════════════════════════

-- 2.1 orders — primeiro, para os passos seguintes já lerem dados limpos.
update public.orders
set customer_phone = private.normalize_phone(customer_phone)
where customer_phone is not null
  and private.normalize_phone(customer_phone) is distinct from customer_phone;

-- 2.2 customers — funde as variantes do mesmo número numa só linha canónica.
-- Nunca se muda o valor da PK "no lugar" (violaria as FK de moradas/dispositivos
-- a meio da transição); cria-se/actualiza-se a linha canónica primeiro, depois
-- repontam-se os dependentes, só depois se apaga a linha suja.
insert into public.customers (phone, name, first_seen_at, last_seen_at, orders_count, total_spent_cents)
select
  private.normalize_phone(phone),
  (array_agg(name order by last_seen_at desc nulls last) filter (where name is not null))[1],
  min(first_seen_at),
  max(last_seen_at),
  0,
  0
from public.customers
where private.normalize_phone(phone) is not null
group by private.normalize_phone(phone)
on conflict (phone) do update
set name          = coalesce(public.customers.name, excluded.name),
    first_seen_at = least(public.customers.first_seen_at, excluded.first_seen_at),
    last_seen_at  = greatest(public.customers.last_seen_at, excluded.last_seen_at);

-- 2.3 moradas — evita colidir com "uma morada por defeito por telefone" ao
-- juntar duas variantes que tinham cada uma a sua morada principal.
update public.customer_addresses a
set is_default = false
where a.is_default
  and a.id <> (
    select a2.id
    from public.customer_addresses a2
    where private.normalize_phone(a2.customer_phone) = private.normalize_phone(a.customer_phone)
      and a2.is_default
    order by a2.updated_at desc
    limit 1
  );

update public.customer_addresses a
set customer_phone = private.normalize_phone(a.customer_phone)
where a.customer_phone is not null
  and private.normalize_phone(a.customer_phone) is distinct from a.customer_phone;

-- 2.4 dispositivos guardados (conta do cliente, 1034) — sem restrição de
-- unicidade em customer_phone, repontar é seguro directamente.
update public.customer_devices d
set customer_phone = private.normalize_phone(d.customer_phone)
where d.customer_phone is not null
  and private.normalize_phone(d.customer_phone) is distinct from d.customer_phone;

-- 2.5 códigos de login pendentes — chave primária é o telefone; se por acaso
-- as duas variantes tinham um código pendente ao mesmo tempo, fica o mais
-- recente (o outro já teria expirado em 10 min de qualquer forma).
delete from public.customer_login_codes l
where l.phone is not null
  and private.normalize_phone(l.phone) is distinct from l.phone
  and exists (
    select 1 from public.customer_login_codes l2
    where l2.phone = private.normalize_phone(l.phone)
  );

update public.customer_login_codes l
set phone = private.normalize_phone(l.phone)
where l.phone is not null
  and private.normalize_phone(l.phone) is distinct from l.phone;

-- 2.6 apagar as linhas de customers agora órfãs (os dependentes já foram
-- repontados para a linha canónica nos passos 2.3-2.5).
delete from public.customers c
where private.normalize_phone(c.phone) is distinct from c.phone;

-- 2.7 recalcular orders_count/total_spent_cents a partir de orders já limpo —
-- é o que estava a dividir o histórico de compras da mesma pessoa em dois.
update public.customers c
set orders_count      = coalesce(o.cnt, 0),
    total_spent_cents = coalesce(o.total, 0)
from (
  select customer_phone, count(*) as cnt, sum(total_cents) as total
  from public.orders
  where customer_phone is not null
    and status in ('approved','paid','in_preparation','ready','delivered')
  group by customer_phone
) o
where o.customer_phone = c.phone;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Nunca mais: normalizar sempre que se escreve
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function private.normalize_orders_customer_phone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.customer_phone := private.normalize_phone(new.customer_phone);
  return new;
end;
$$;

drop trigger if exists orders_normalize_customer_phone on public.orders;
create trigger orders_normalize_customer_phone
before insert or update of customer_phone on public.orders
for each row execute function private.normalize_orders_customer_phone();

create or replace function private.normalize_customers_phone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.phone := private.normalize_phone(new.phone);
  return new;
end;
$$;

drop trigger if exists customers_normalize_phone on public.customers;
create trigger customers_normalize_phone
before insert or update of phone on public.customers
for each row execute function private.normalize_customers_phone();

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. RPCs que recebem um telefone do cliente e o usam numa comparação —
--    as triggers acima limpam o que fica GRAVADO, mas uma RPC que compare
--    o telefone recebido (sem normalizar) contra dados já limpos falha a
--    encontrar o cliente sempre que ele escrever o número com "+258".
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.identify_customer(p_phone text, p_name text default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_phone text := private.normalize_phone(p_phone);
  v_name  text := nullif(trim(p_name), '');
  v_count int := 0;
  v_spent int := 0;
  v_favs  jsonb;
  v_orders jsonb;
  v_stored_name text;
begin
  if v_phone is null then raise exception 'phone_required'; end if;

  select count(*), coalesce(sum(total_cents), 0)
    into v_count, v_spent
  from orders
  where customer_phone = v_phone
    and status in ('approved','paid','in_preparation','ready','delivered');

  insert into customers (phone, name, orders_count, total_spent_cents)
  values (v_phone, v_name, v_count, v_spent)
  on conflict (phone) do update
    set last_seen_at      = now(),
        name              = coalesce(v_name, customers.name),
        orders_count      = excluded.orders_count,
        total_spent_cents = excluded.total_spent_cents
  returning name into v_stored_name;

  select coalesce(jsonb_agg(
           jsonb_build_object('menu_item_id', t.menu_item_id, 'name', t.name, 'qty', t.qty)
           order by t.qty desc
         ), '[]'::jsonb)
    into v_favs
  from (
    select oi.menu_item_id, oi.name_snapshot as name, sum(oi.qty)::int as qty
    from order_items oi
    join orders o on o.id = oi.order_id
    where o.customer_phone = v_phone
      and o.status in ('approved','paid','in_preparation','ready','delivered')
    group by oi.menu_item_id, oi.name_snapshot
    order by sum(oi.qty) desc
    limit 5
  ) t;

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'id', o.id, 'order_number', o.order_number, 'status', o.status,
             'total_cents', o.total_cents, 'created_at', o.created_at
           ) order by o.created_at desc
         ), '[]'::jsonb)
    into v_orders
  from (
    select id, order_number, status, total_cents, created_at
    from orders
    where customer_phone = v_phone and status <> 'draft'
    order by created_at desc
    limit 5
  ) o;

  return jsonb_build_object(
    'phone',             v_phone,
    'name',              v_stored_name,
    'orders_count',      v_count,
    'total_spent_cents', v_spent,
    'favorites',         v_favs,
    'recent_orders',     v_orders
  );
end;
$$;

create or replace function public.get_customer_orders(p_phone text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_phone text := private.normalize_phone(p_phone);
  v_orders jsonb;
begin
  if v_phone is null then return jsonb_build_object('orders', '[]'::jsonb); end if;

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'id', o.id,
             'order_number', o.order_number,
             'status', o.status,
             'fulfillment_type', o.fulfillment_type,
             'total_cents', o.total_cents,
             'created_at', o.created_at,
             'scheduled_for', o.scheduled_for,
             'items', (
               select coalesce(jsonb_agg(jsonb_build_object(
                        'menu_item_id', x.menu_item_id, 'name', x.name_snapshot, 'qty', x.qty
                      )), '[]'::jsonb)
               from order_items x where x.order_id = o.id
             )
           ) order by o.created_at desc
         ), '[]'::jsonb)
    into v_orders
  from orders o
  where o.customer_phone = v_phone and o.status <> 'draft';

  return jsonb_build_object('orders', v_orders);
end;
$$;

create or replace function public.account_request_code(p_phone text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone text := private.normalize_phone(p_phone);
  v_code  text;
  v_email text;
begin
  if v_phone is null then
    raise exception 'phone_required' using errcode = 'P0007';
  end if;

  if not exists (select 1 from public.customers c where c.phone = v_phone) then
    return jsonb_build_object('channel', 'none');
  end if;

  select o.customer_email into v_email
  from public.orders o
  where o.customer_phone = v_phone
    and coalesce(btrim(o.customer_email), '') <> ''
  order by o.created_at desc
  limit 1;

  if v_email is null then
    return jsonb_build_object('channel', 'none');
  end if;

  v_code := lpad((floor(random() * 1000000))::int::text, 6, '0');

  insert into public.customer_login_codes (phone, code_hash, expires_at, attempts)
  values (v_phone, private.secret_hash(v_code), now() + interval '10 minutes', 0)
  on conflict (phone) do update
    set code_hash  = excluded.code_hash,
        expires_at = excluded.expires_at,
        attempts   = 0,
        created_at = now();

  return jsonb_build_object('channel', 'email', 'email', v_email, 'code', v_code);
end;
$$;

create or replace function public.account_verify_code(p_phone text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone text := private.normalize_phone(p_phone);
  v_row   record;
  v_token text;
begin
  select * into v_row
  from public.customer_login_codes
  where phone = v_phone;

  if v_row.phone is null or v_row.expires_at < now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;

  if v_row.attempts >= 5 then
    return jsonb_build_object('ok', false, 'reason', 'too_many_attempts');
  end if;

  if v_row.code_hash <> private.secret_hash(btrim(coalesce(p_code, ''))) then
    update public.customer_login_codes
       set attempts = attempts + 1
     where phone = v_phone;
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  delete from public.customer_login_codes where phone = v_phone;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.customer_devices (customer_phone, token_hash)
  values (v_phone, private.secret_hash(v_token));

  update public.customers set last_seen_at = now() where phone = v_phone;

  return jsonb_build_object('ok', true, 'token', v_token, 'profile', private.customer_profile(v_phone));
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. Top clientes: agrupar por telefone (quando existe), não por nome
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.get_dashboard_metrics(
  p_period text default 'week',   -- 'day' | 'week' | 'month' | 'all'
  p_store_id uuid default null    -- null = todas as lojas (só owner)
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_since        timestamptz;
  v_length       interval;
  v_prev_since   timestamptz;
  v_bucket_trunc text;
  v_confirmed    text[] := array['approved','paid','in_preparation','ready','delivered'];
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated' using errcode = 'P0020';
  end if;
  if private.auth_role() not in ('owner', 'manager') then
    raise exception 'dashboard_access_denied' using errcode = 'P0403';
  end if;
  if p_store_id is null then
    if not private.auth_is_owner() then
      raise exception 'dashboard_access_denied' using errcode = 'P0403';
    end if;
  else
    if not private.auth_can_store(p_store_id) then
      raise exception 'dashboard_access_denied' using errcode = 'P0403';
    end if;
  end if;

  v_length := case p_period
    when 'day'   then interval '1 day'
    when 'week'  then interval '7 days'
    when 'month' then interval '30 days'
    else null
  end;

  v_since := case p_period
    when 'day'   then now() - interval '1 day'
    when 'week'  then now() - interval '7 days'
    when 'month' then now() - interval '30 days'
    when 'all'   then '1970-01-01'::timestamptz
    else now() - interval '7 days'
  end;

  v_prev_since := case when v_length is null then null else v_since - v_length end;

  v_bucket_trunc := case p_period
    when 'day' then 'hour'
    else 'day'
  end;

  return jsonb_build_object(

    'store_id', p_store_id,

    'revenue_cents', (
      select coalesce(sum(total_cents), 0)
      from orders
      where status = any(v_confirmed)
        and created_at >= v_since
        and (p_store_id is null or store_id = p_store_id)
    ),

    'avg_ticket_cents', (
      select coalesce(round(avg(total_cents)), 0)
      from orders
      where status = any(v_confirmed)
        and created_at >= v_since
        and (p_store_id is null or store_id = p_store_id)
    ),

    'total_orders', (
      select count(*)
      from orders
      where status not in ('draft', 'cancelled')
        and created_at >= v_since
        and (p_store_id is null or store_id = p_store_id)
    ),

    'previous', case when v_prev_since is null then null else (
      select jsonb_build_object(
        'revenue_cents', coalesce(sum(total_cents), 0),
        'total_orders', count(*)
      )
      from orders
      where status = any(v_confirmed)
        and created_at >= v_prev_since
        and created_at < v_since
        and (p_store_id is null or store_id = p_store_id)
    ) end,

    'pickup_vs_delivery', (
      select coalesce(jsonb_agg(r order by r.fulfillment_type), '[]'::jsonb)
      from (
        select fulfillment_type, count(*) as count, sum(total_cents) as revenue_cents
        from orders
        where status = any(v_confirmed)
          and created_at >= v_since
          and (p_store_id is null or store_id = p_store_id)
        group by fulfillment_type
      ) r
    ),

    'avg_time_minutes', (
      select round(avg(
        extract(epoch from (e_del.created_at - e_pay.created_at)) / 60.0
      )::numeric, 1)
      from event_log e_pay
      join event_log e_del
        on  e_del.order_id = e_pay.order_id
        and e_del.type    = 'order.deliver'
      join orders o on o.id = e_pay.order_id
      where e_pay.type = 'payment.confirmed'
        and e_pay.created_at >= v_since
        and (p_store_id is null or o.store_id = p_store_id)
    ),

    'top_items', (
      select coalesce(jsonb_agg(r order by r.qty desc), '[]'::jsonb)
      from (
        select oi.name_snapshot as name, sum(oi.qty) as qty
        from order_items oi
        join orders o on o.id = oi.order_id
        where o.status = any(v_confirmed)
          and o.created_at >= v_since
          and (p_store_id is null or o.store_id = p_store_id)
        group by oi.name_snapshot
        order by qty desc
        limit 10
      ) r
    ),

    'by_method', (
      select coalesce(jsonb_agg(r), '[]'::jsonb)
      from (
        select payment_method as method, sum(total_cents) as cents
        from orders
        where status = any(v_confirmed)
          and created_at >= v_since
          and (p_store_id is null or store_id = p_store_id)
        group by payment_method
      ) r
    ),

    'hourly', (
      select coalesce(jsonb_agg(r order by r.hour), '[]'::jsonb)
      from (
        select extract(hour from created_at)::int as hour, count(*) as count
        from orders
        where status not in ('draft', 'cancelled')
          and created_at >= v_since
          and (p_store_id is null or store_id = p_store_id)
        group by hour
      ) r
    ),

    -- Um cliente é o telefone, não o nome que escreveu daquela vez. Quem não
    -- deixou telefone (balcão sem identificação) continua agrupado por nome,
    -- como sempre — não há outra chave para esses.
    'top_customers', (
      select coalesce(jsonb_agg(r order by r.total_cents desc), '[]'::jsonb)
      from (
        select
          (array_agg(customer_name order by created_at desc) filter (where customer_name is not null))[1] as customer_name,
          max(customer_phone) as customer_phone,
          count(*) as order_count,
          sum(total_cents) as total_cents
        from orders
        where status = any(v_confirmed)
          and created_at >= v_since
          and customer_name is not null
          and (p_store_id is null or store_id = p_store_id)
        group by coalesce(customer_phone, 'sem-telefone:' || customer_name)
        order by sum(total_cents) desc
        limit 10
      ) r
    ),

    'period_buckets', (
      select coalesce(jsonb_agg(r order by r.bucket), '[]'::jsonb)
      from (
        select
          date_trunc(v_bucket_trunc, created_at) as bucket,
          sum(total_cents) as revenue_cents
        from orders
        where status = any(v_confirmed)
          and created_at >= v_since
          and (p_store_id is null or store_id = p_store_id)
        group by bucket
      ) r
    )

  );
end;
$$;
