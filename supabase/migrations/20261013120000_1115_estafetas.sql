-- HAWSMASH 2.0 — 1115: estafetas.
--
-- Até aqui a entrega acabava no balcão: o pedido de delivery pronto tinha um
-- botão "Enviar" (`advance_order DELIVER`) e o sistema deixava de saber dele.
-- Não havia quem o levava, quando chegou, nem quanto se deve a quem o levou.
--
-- Esta migration acrescenta, sem mexer na máquina de estados do pedido:
--
--   couriers             o estafeta, por loja (nome, telefone, activo, de serviço)
--   courier_credentials  o hash do PIN e as tentativas — ninguém o lê pela API
--   courier_sessions     a sessão do telemóvel dele (token opaco, só o hash)
--   deliveries           a entrega: atribuída → levantada → entregue
--   courier_ledger       a conta-corrente: o que a loja lhe deve, em centavos
--   courier_positions    a última posição dele, só enquanto está de serviço
--
-- DECISÃO: o estafeta NÃO é uma conta Supabase nem um perfil de `staff_profiles`.
-- Toda a RLS da loja é `auth_can_store(store_id)`: um perfil `driver` com sessão
-- passava a ler pedidos, caixa e clientes da loja inteira (é o problema que a
-- cozinha ainda tem, B-116). Em vez disso entra com telefone + PIN numa rota do
-- servidor, recebe um token aleatório (guardado só como sha256) e tudo o que
-- faz passa por RPCs `courier_*` que só o service_role executa e que só lhe
-- devolvem as entregas dele. Revogar = desactivar o estafeta ou trocar o PIN.
--
-- DECISÃO: a entrega tem estado próprio em `deliveries`, e o pedido continua a
-- usar os estados de sempre. A lista "venda confirmada"
-- ('approved','paid','in_preparation','ready','delivered') está repetida em
-- dezenas de funções de caixa, análise e fecho: acrescentar `out_for_delivery`
-- obrigava a reescrevê-las todas com as lojas a vender. Hoje `delivered` num
-- pedido de entrega já quer dizer "saiu da loja" (o botão chama-se "Enviar").
-- Por isso "Levantei" no telemóvel faz exactamente o que o "Enviar" fazia, e
-- "Entregue" fecha só a entrega e credita a taxa ao estafeta.
--
-- DECISÃO: o que se paga por entrega fica por loja em `stores`:
-- `courier_fee_fixed_cents` (valor fixo) ou, se for null, `courier_fee_pct` da
-- taxa de entrega cobrada (de fábrica 100% — o estafeta fica com a taxa). A
-- confirmar com o dono (B-120). A taxa fica congelada na entrega no momento em
-- que é entregue: mudar a regra depois não reescreve o passado.
--
-- Os pedidos são pagos antes de sair (M-Pesa/e-Mola/balcão): o estafeta não
-- cobra à porta, por isso não há "dinheiro a devolver" nesta fase.

-- ---------------------------------------------------------------------------
-- 1. Regra de pagamento por loja
-- ---------------------------------------------------------------------------
alter table public.stores
  add column if not exists courier_fee_fixed_cents integer
    check (courier_fee_fixed_cents is null or courier_fee_fixed_cents >= 0),
  add column if not exists courier_fee_pct smallint not null default 100
    check (courier_fee_pct between 0 and 100);

comment on column public.stores.courier_fee_fixed_cents is
  'Valor pago ao estafeta por entrega, em centavos. Null = usar courier_fee_pct da taxa de entrega (1115).';
comment on column public.stores.courier_fee_pct is
  'Percentagem da taxa de entrega do pedido paga ao estafeta quando não há valor fixo (1115).';

-- ---------------------------------------------------------------------------
-- 2. Tabelas
-- ---------------------------------------------------------------------------
create table if not exists public.couriers (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id),
  full_name text not null check (length(btrim(full_name)) between 2 and 80),
  -- 9 dígitos, sem indicativo: 84xxxxxxx. Normalizado por private.normalize_courier_phone.
  phone text not null check (phone ~ '^[0-9]{9}$'),
  active boolean not null default true,
  on_shift boolean not null default false,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- O telefone é o login: um só estafeta activo por número.
create unique index if not exists couriers_phone_active_uidx
  on public.couriers (phone) where active;
create index if not exists couriers_store_idx on public.couriers (store_id);

create table if not exists public.courier_credentials (
  courier_id uuid primary key references public.couriers(id) on delete cascade,
  pin_hash text not null,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.courier_sessions (
  id uuid primary key default gen_random_uuid(),
  courier_id uuid not null references public.couriers(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index if not exists courier_sessions_courier_idx on public.courier_sessions (courier_id);

create table if not exists public.deliveries (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id),
  store_id uuid not null references public.stores(id),
  courier_id uuid not null references public.couriers(id),
  status text not null default 'assigned'
    check (status in ('assigned', 'picked_up', 'delivered')),
  assigned_at timestamptz not null default now(),
  assigned_by uuid references auth.users(id) on delete set null,
  picked_up_at timestamptz,
  delivered_at timestamptz,
  -- Onde o telemóvel estava quando carregou em "Entregue". Prova leve, não PoD.
  delivered_lat double precision,
  delivered_lng double precision,
  courier_fee_cents integer check (courier_fee_cents is null or courier_fee_cents >= 0),
  updated_at timestamptz not null default now()
);
create index if not exists deliveries_courier_status_idx on public.deliveries (courier_id, status);
create index if not exists deliveries_store_assigned_idx on public.deliveries (store_id, assigned_at desc);

create table if not exists public.courier_ledger (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id),
  courier_id uuid not null references public.couriers(id),
  delivery_id uuid references public.deliveries(id),
  kind text not null check (kind in ('delivery_fee', 'payout', 'adjustment')),
  -- Positivo = a loja passa a dever ao estafeta; negativo = a loja pagou.
  amount_cents integer not null check (amount_cents <> 0),
  method text check (method is null or method in ('cash', 'mpesa', 'emola', 'other')),
  note text,
  request_id uuid,
  actor_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
-- Regra 4: a mesma entrega não credita duas vezes; o mesmo pagamento não sai duas vezes.
create unique index if not exists courier_ledger_delivery_kind_uidx
  on public.courier_ledger (delivery_id, kind) where delivery_id is not null;
create unique index if not exists courier_ledger_request_uidx
  on public.courier_ledger (store_id, request_id) where request_id is not null;
create index if not exists courier_ledger_courier_idx
  on public.courier_ledger (courier_id, created_at desc);

create table if not exists public.courier_positions (
  courier_id uuid primary key references public.couriers(id) on delete cascade,
  store_id uuid not null references public.stores(id),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  accuracy_m integer check (accuracy_m is null or accuracy_m >= 0),
  recorded_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 3. RLS — leitura pela equipa da loja; escrita só por RPC
-- ---------------------------------------------------------------------------
alter table public.couriers enable row level security;
alter table public.courier_credentials enable row level security;
alter table public.courier_sessions enable row level security;
alter table public.deliveries enable row level security;
alter table public.courier_ledger enable row level security;
alter table public.courier_positions enable row level security;

revoke all on public.couriers, public.courier_credentials, public.courier_sessions,
  public.deliveries, public.courier_ledger, public.courier_positions
  from public, anon, authenticated;

-- O servidor (rotas com a service key, scripts de suporte) lê e escreve tudo.
grant select, insert, update, delete on public.couriers, public.courier_credentials,
  public.courier_sessions, public.deliveries, public.courier_ledger, public.courier_positions
  to service_role;

-- PIN e sessões: nenhuma policy, nenhum grant à equipa. Só as funções security definer.
grant select on public.couriers, public.deliveries, public.courier_ledger, public.courier_positions
  to authenticated;

drop policy if exists couriers_store_select on public.couriers;
create policy couriers_store_select on public.couriers for select to authenticated
  using ((select private.auth_role()) in ('owner', 'manager', 'cashier')
         and (select private.auth_can_store(store_id)));

drop policy if exists deliveries_store_select on public.deliveries;
create policy deliveries_store_select on public.deliveries for select to authenticated
  using ((select private.auth_role()) in ('owner', 'manager', 'cashier')
         and (select private.auth_can_store(store_id)));

drop policy if exists courier_positions_store_select on public.courier_positions;
create policy courier_positions_store_select on public.courier_positions for select to authenticated
  using ((select private.auth_role()) in ('owner', 'manager', 'cashier')
         and (select private.auth_can_store(store_id)));

-- Dinheiro do estafeta: gerente e dono.
drop policy if exists courier_ledger_manager_select on public.courier_ledger;
create policy courier_ledger_manager_select on public.courier_ledger for select to authenticated
  using ((select private.auth_role()) in ('owner', 'manager')
         and (select private.auth_can_store(store_id)));

-- ---------------------------------------------------------------------------
-- 4. Helpers privados
-- ---------------------------------------------------------------------------
create or replace function private.normalize_courier_phone(p_phone text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
begin
  if length(v) = 12 and left(v, 3) = '258' then
    v := substr(v, 4);
  end if;
  return v;
end;
$$;

-- O que se paga por esta entrega, pela regra da loja de agora.
create or replace function private.courier_fee_for(p_order_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    s.courier_fee_fixed_cents,
    (o.delivery_fee_cents * s.courier_fee_pct) / 100
  )::integer
  from public.orders o
  join public.stores s on s.id = o.store_id
  where o.id = p_order_id;
$$;

-- O token do telemóvel → o estafeta. Falha fechado.
create or replace function private.courier_from_token(p_token text)
returns public.couriers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_courier public.couriers%rowtype;
  v_session_id uuid;
begin
  if p_token is null or length(p_token) < 32 then
    raise exception 'courier_session_invalid' using errcode = 'P0401';
  end if;

  select cs.id into v_session_id
  from public.courier_sessions cs
  where cs.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and cs.revoked_at is null
    and cs.expires_at > now();
  if not found then
    raise exception 'courier_session_invalid' using errcode = 'P0401';
  end if;

  select c.* into v_courier
  from public.courier_sessions cs
  join public.couriers c on c.id = cs.courier_id
  where cs.id = v_session_id and c.active;
  if not found then
    raise exception 'courier_session_invalid' using errcode = 'P0401';
  end if;

  update public.courier_sessions set last_used_at = now() where id = v_session_id;
  update public.couriers set last_seen_at = now() where id = v_courier.id;
  return v_courier;
end;
$$;

-- A gestão de estafetas é do gerente e do dono, na sua loja.
create or replace function private.assert_courier_admin(p_store_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated' using errcode = 'P0020';
  end if;
  if coalesce(private.auth_role(), '') not in ('owner', 'manager')
     or p_store_id is null
     or not private.auth_can_store(p_store_id) then
    raise exception 'courier_access_denied' using errcode = 'P0403';
  end if;
end;
$$;

-- Levar o pedido ao estado "saiu da loja", como o botão "Enviar" fazia.
-- Comida na mão do estafeta é comida pronta: se a cozinha se esqueceu de
-- marcar pronto, marca-se agora em vez de obrigar a um telefonema.
create or replace function private.courier_dispatch_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  select o.status into v_status from public.orders o where o.id = p_order_id for update;
  if v_status = 'cancelled' then
    raise exception 'order_cancelled' using errcode = 'P0409';
  end if;
  if v_status in ('draft', 'awaiting_payment', 'payment_failed', 'awaiting_approval', 'approved', 'paid') then
    raise exception 'order_not_ready' using errcode = 'P0409';
  end if;
  if v_status = 'in_preparation' then
    perform public.advance_order(p_order_id, 'MARK_READY', 'Levantado pelo estafeta');
    v_status := 'ready';
  end if;
  if v_status = 'ready' then
    perform public.advance_order(p_order_id, 'DELIVER', 'Levantado pelo estafeta');
  end if;
end;
$$;

revoke all on function private.normalize_courier_phone(text) from public, anon, authenticated;
revoke all on function private.courier_fee_for(uuid) from public, anon, authenticated;
revoke all on function private.courier_from_token(text) from public, anon, authenticated;
revoke all on function private.assert_courier_admin(uuid) from public, anon, authenticated;
revoke all on function private.courier_dispatch_order(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Gestão (painel): criar, PIN, regra de pagamento, atribuir
-- ---------------------------------------------------------------------------
create or replace function public.save_courier(
  p_courier_id uuid,
  p_store_id uuid,
  p_full_name text,
  p_phone text,
  p_active boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone text := private.normalize_courier_phone(p_phone);
  v_existing public.couriers%rowtype;
  v_id uuid;
begin
  if v_phone !~ '^[0-9]{9}$' then
    raise exception 'invalid_courier_phone' using errcode = 'P0007';
  end if;
  if length(btrim(coalesce(p_full_name, ''))) not between 2 and 80 then
    raise exception 'invalid_courier_name' using errcode = 'P0007';
  end if;

  if p_courier_id is null then
    perform private.assert_courier_admin(p_store_id);
    begin
      insert into public.couriers (store_id, full_name, phone, active)
      values (p_store_id, btrim(p_full_name), v_phone, coalesce(p_active, true))
      returning id into v_id;
    exception when unique_violation then
      raise exception 'courier_phone_taken' using errcode = 'P0409';
    end;
  else
    select * into v_existing from public.couriers c where c.id = p_courier_id for update;
    if not found then
      raise exception 'courier_not_found' using errcode = 'P0404';
    end if;
    -- A loja de um estafeta não muda: o histórico de entregas e pagamentos é dela.
    perform private.assert_courier_admin(v_existing.store_id);
    begin
      update public.couriers
      set full_name = btrim(p_full_name),
          phone = v_phone,
          active = coalesce(p_active, active),
          on_shift = case when coalesce(p_active, active) then on_shift else false end,
          updated_at = now()
      where id = p_courier_id;
    exception when unique_violation then
      raise exception 'courier_phone_taken' using errcode = 'P0409';
    end;
    v_id := p_courier_id;
    if not coalesce(p_active, true) then
      update public.courier_sessions set revoked_at = now()
      where courier_id = v_id and revoked_at is null;
      delete from public.courier_positions where courier_id = v_id;
    end if;
  end if;

  insert into public.event_log (store_id, actor_user_id, type, payload)
  select c.store_id, (select auth.uid()), 'courier.saved',
    jsonb_build_object('courier_id', c.id, 'full_name', c.full_name, 'active', c.active,
      'created', p_courier_id is null)
  from public.couriers c where c.id = v_id;

  return v_id;
end;
$$;

create or replace function public.set_courier_pin(p_courier_id uuid, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store_id uuid;
begin
  select c.store_id into v_store_id from public.couriers c where c.id = p_courier_id;
  if not found then
    raise exception 'courier_not_found' using errcode = 'P0404';
  end if;
  perform private.assert_courier_admin(v_store_id);
  if coalesce(p_pin, '') !~ '^[0-9]{4,6}$' then
    raise exception 'invalid_pin_format' using errcode = 'P0007';
  end if;

  insert into public.courier_credentials (courier_id, pin_hash, failed_attempts, locked_until, updated_at)
  values (p_courier_id, extensions.crypt(p_pin, extensions.gen_salt('bf', 10)), 0, null, now())
  on conflict (courier_id) do update
    set pin_hash = excluded.pin_hash, failed_attempts = 0, locked_until = null, updated_at = now();

  -- PIN novo = o telemóvel antigo (perdido, de outra pessoa) deixa de entrar.
  update public.courier_sessions set revoked_at = now()
  where courier_id = p_courier_id and revoked_at is null;

  -- Nunca o PIN no payload.
  insert into public.event_log (store_id, actor_user_id, type, payload)
  values (v_store_id, (select auth.uid()), 'courier.pin_set', jsonb_build_object('courier_id', p_courier_id));

  return jsonb_build_object('courier_id', p_courier_id, 'configured', true);
end;
$$;

-- Quanto se paga por entrega é decisão do dono (§6: preços e dinheiro).
create or replace function public.set_courier_pay(
  p_store_id uuid,
  p_fixed_cents integer,
  p_pct integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated' using errcode = 'P0020';
  end if;
  if not coalesce(private.auth_is_owner(), false) then
    raise exception 'courier_access_denied' using errcode = 'P0403';
  end if;
  if p_fixed_cents is not null and p_fixed_cents < 0 then
    raise exception 'invalid_courier_fee' using errcode = 'P0007';
  end if;
  if p_pct is null or p_pct not between 0 and 100 then
    raise exception 'invalid_courier_fee' using errcode = 'P0007';
  end if;

  update public.stores
  set courier_fee_fixed_cents = p_fixed_cents, courier_fee_pct = p_pct
  where id = p_store_id;
  if not found then
    raise exception 'store_not_found' using errcode = 'P0404';
  end if;

  insert into public.event_log (store_id, actor_user_id, type, payload)
  values (p_store_id, (select auth.uid()), 'courier.pay_rule_set',
    jsonb_build_object('fixed_cents', p_fixed_cents, 'pct', p_pct));

  return jsonb_build_object('store_id', p_store_id, 'fixed_cents', p_fixed_cents, 'pct', p_pct);
end;
$$;

-- Atribuir (ou trocar, antes de levantar) o estafeta de um pedido de entrega.
-- O balcão também atribui: é quem vê o pedido sair.
create or replace function public.assign_courier(p_order_id uuid, p_courier_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_order record;
  v_courier public.couriers%rowtype;
  v_delivery public.deliveries%rowtype;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0020';
  end if;

  select o.id, o.store_id, o.status, o.fulfillment_type into v_order
  from public.orders o where o.id = p_order_id for update;
  if not found then
    raise exception 'order_not_found' using errcode = 'P0404';
  end if;
  if coalesce(private.auth_role(), '') not in ('owner', 'manager', 'cashier')
     or not private.auth_can_store(v_order.store_id) then
    raise exception 'courier_access_denied' using errcode = 'P0403';
  end if;
  if v_order.fulfillment_type <> 'delivery' then
    raise exception 'order_not_delivery' using errcode = 'P0409';
  end if;
  if v_order.status not in ('approved', 'paid', 'in_preparation', 'ready', 'delivered') then
    raise exception 'order_not_assignable' using errcode = 'P0409';
  end if;

  select * into v_courier from public.couriers c where c.id = p_courier_id;
  if not found or not v_courier.active then
    raise exception 'courier_not_found' using errcode = 'P0404';
  end if;
  -- Regra 3: estafeta de Maputo não leva pedido da Matola.
  if v_courier.store_id <> v_order.store_id then
    raise exception 'courier_wrong_store' using errcode = 'P0403';
  end if;

  select * into v_delivery from public.deliveries d where d.order_id = p_order_id for update;
  if found then
    if v_delivery.courier_id = p_courier_id then
      return v_delivery.id;  -- repetir não muda nada
    end if;
    if v_delivery.status <> 'assigned' then
      raise exception 'delivery_already_picked_up' using errcode = 'P0409';
    end if;
    update public.deliveries
    set courier_id = p_courier_id, assigned_at = now(), assigned_by = v_uid, updated_at = now()
    where id = v_delivery.id;
    v_id := v_delivery.id;
  else
    insert into public.deliveries (order_id, store_id, courier_id, assigned_by)
    values (p_order_id, v_order.store_id, p_courier_id, v_uid)
    returning id into v_id;
  end if;

  insert into public.event_log (store_id, order_id, actor_user_id, type, payload)
  values (v_order.store_id, p_order_id, v_uid, 'delivery.assigned',
    jsonb_build_object('delivery_id', v_id, 'courier_id', p_courier_id,
      'previous_courier_id', v_delivery.courier_id));

  return v_id;
end;
$$;

create or replace function public.unassign_courier(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_delivery public.deliveries%rowtype;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0020';
  end if;
  select * into v_delivery from public.deliveries d where d.order_id = p_order_id for update;
  if not found then
    return jsonb_build_object('order_id', p_order_id, 'unchanged', true);
  end if;
  if coalesce(private.auth_role(), '') not in ('owner', 'manager', 'cashier')
     or not private.auth_can_store(v_delivery.store_id) then
    raise exception 'courier_access_denied' using errcode = 'P0403';
  end if;
  if v_delivery.status <> 'assigned' then
    raise exception 'delivery_already_picked_up' using errcode = 'P0409';
  end if;

  -- Uma atribuição que ainda não saiu da loja não é dinheiro nem papel: sai da
  -- tabela, e o rasto fica no event_log.
  delete from public.deliveries where id = v_delivery.id;

  insert into public.event_log (store_id, order_id, actor_user_id, type, payload)
  values (v_delivery.store_id, p_order_id, v_uid, 'delivery.unassigned',
    jsonb_build_object('delivery_id', v_delivery.id, 'courier_id', v_delivery.courier_id));

  return jsonb_build_object('order_id', p_order_id, 'unassigned', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Painel: quadro dos estafetas, conta-corrente, pagamentos
-- ---------------------------------------------------------------------------
create or replace function public.get_couriers_board(p_store_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text := coalesce(private.auth_role(), '');
  v_money boolean;
  v_day_start timestamptz :=
    (date_trunc('day', now() at time zone 'Africa/Maputo')) at time zone 'Africa/Maputo';
  v_result jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated' using errcode = 'P0020';
  end if;
  if v_role not in ('owner', 'manager', 'cashier') or not private.auth_can_store(p_store_id) then
    raise exception 'courier_access_denied' using errcode = 'P0403';
  end if;
  v_money := v_role in ('owner', 'manager');

  select jsonb_build_object(
    'store_id', s.id,
    'pay_rule', jsonb_build_object('fixed_cents', s.courier_fee_fixed_cents, 'pct', s.courier_fee_pct),
    'couriers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'full_name', c.full_name,
        'phone', c.phone,
        'active', c.active,
        'on_shift', c.on_shift,
        'last_seen_at', c.last_seen_at,
        'has_pin', exists (select 1 from public.courier_credentials cc where cc.courier_id = c.id),
        'position', (
          select jsonb_build_object('lat', p.lat, 'lng', p.lng, 'accuracy_m', p.accuracy_m,
            'recorded_at', p.recorded_at)
          from public.courier_positions p where p.courier_id = c.id),
        'jobs', coalesce((
          select jsonb_agg(jsonb_build_object(
            'delivery_id', d.id, 'order_id', o.id, 'order_number', o.order_number,
            'daily_number', o.daily_number, 'status', d.status, 'address', o.address,
            'assigned_at', d.assigned_at, 'picked_up_at', d.picked_up_at)
            order by d.assigned_at)
          from public.deliveries d
          join public.orders o on o.id = d.order_id
          where d.courier_id = c.id and d.status in ('assigned', 'picked_up')
            and o.status <> 'cancelled'), '[]'::jsonb),
        'delivered_today', (
          select count(*) from public.deliveries d
          where d.courier_id = c.id and d.status = 'delivered' and d.delivered_at >= v_day_start),
        'balance_cents', case when v_money then (
          select coalesce(sum(l.amount_cents), 0) from public.courier_ledger l
          where l.courier_id = c.id) end
      ) order by c.active desc, c.on_shift desc, c.full_name)
      from public.couriers c
      where c.store_id = s.id), '[]'::jsonb)
  )
  into v_result
  from public.stores s
  where s.id = p_store_id;

  return v_result;
end;
$$;

create or replace function public.courier_payout(
  p_courier_id uuid,
  p_amount_cents integer,
  p_method text,
  p_note text,
  p_request_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_courier public.couriers%rowtype;
  v_existing record;
  v_id uuid;
begin
  select * into v_courier from public.couriers c where c.id = p_courier_id;
  if not found then
    raise exception 'courier_not_found' using errcode = 'P0404';
  end if;
  perform private.assert_courier_admin(v_courier.store_id);
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'invalid_payout_amount' using errcode = 'P0007';
  end if;
  if p_method is null or p_method not in ('cash', 'mpesa', 'emola', 'other') then
    raise exception 'invalid_payout_method' using errcode = 'P0007';
  end if;
  if p_request_id is null then
    raise exception 'request_id_required' using errcode = 'P0007';
  end if;

  select l.id, l.amount_cents, l.courier_id into v_existing
  from public.courier_ledger l
  where l.store_id = v_courier.store_id and l.request_id = p_request_id;
  if found then
    if v_existing.amount_cents <> -p_amount_cents or v_existing.courier_id <> p_courier_id then
      raise exception 'request_id_reused' using errcode = 'P0409';
    end if;
    return v_existing.id;
  end if;

  -- Em dinheiro sai da gaveta: é uma despesa do turno aberto, na mesma
  -- transacção. Sem turno aberto falha tudo — não fica um pagamento registado
  -- que a gaveta não conhece.
  if p_method = 'cash' then
    perform public.add_cash_movement(
      v_courier.store_id, 'despesa', p_amount_cents,
      'Pagamento ao estafeta ' || v_courier.full_name
        || coalesce(': ' || nullif(btrim(p_note), ''), ''),
      p_request_id);
  end if;

  insert into public.courier_ledger
    (store_id, courier_id, kind, amount_cents, method, note, request_id, actor_user_id)
  values
    (v_courier.store_id, p_courier_id, 'payout', -p_amount_cents, p_method,
     nullif(btrim(p_note), ''), p_request_id, v_uid)
  returning id into v_id;

  insert into public.event_log (store_id, actor_user_id, type, payload)
  values (v_courier.store_id, v_uid, 'courier.payout',
    jsonb_build_object('courier_id', p_courier_id, 'ledger_id', v_id,
      'amount_cents', p_amount_cents, 'method', p_method));

  return v_id;
end;
$$;

-- Acerto à mão (um bónus, um desconto por um saco perdido): sempre com motivo.
create or replace function public.courier_adjust(
  p_courier_id uuid,
  p_amount_cents integer,
  p_reason text,
  p_request_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_courier public.couriers%rowtype;
  v_existing record;
  v_id uuid;
begin
  select * into v_courier from public.couriers c where c.id = p_courier_id;
  if not found then
    raise exception 'courier_not_found' using errcode = 'P0404';
  end if;
  perform private.assert_courier_admin(v_courier.store_id);
  if p_amount_cents is null or p_amount_cents = 0 then
    raise exception 'invalid_adjust_amount' using errcode = 'P0007';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'adjust_reason_required' using errcode = 'P0007';
  end if;
  if p_request_id is null then
    raise exception 'request_id_required' using errcode = 'P0007';
  end if;

  select l.id, l.amount_cents, l.courier_id into v_existing
  from public.courier_ledger l
  where l.store_id = v_courier.store_id and l.request_id = p_request_id;
  if found then
    if v_existing.amount_cents <> p_amount_cents or v_existing.courier_id <> p_courier_id then
      raise exception 'request_id_reused' using errcode = 'P0409';
    end if;
    return v_existing.id;
  end if;

  insert into public.courier_ledger
    (store_id, courier_id, kind, amount_cents, note, request_id, actor_user_id)
  values
    (v_courier.store_id, p_courier_id, 'adjustment', p_amount_cents, left(btrim(p_reason), 500),
     p_request_id, v_uid)
  returning id into v_id;

  insert into public.event_log (store_id, actor_user_id, type, payload)
  values (v_courier.store_id, v_uid, 'courier.adjustment',
    jsonb_build_object('courier_id', p_courier_id, 'ledger_id', v_id,
      'amount_cents', p_amount_cents, 'reason', left(btrim(p_reason), 500)));

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. O telemóvel do estafeta (só service_role, com o token dele)
-- ---------------------------------------------------------------------------
create or replace function public.courier_login(p_phone text, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone text := private.normalize_courier_phone(p_phone);
  v_courier public.couriers%rowtype;
  v_cred public.courier_credentials%rowtype;
  v_attempts integer;
  v_lock_until timestamptz;
  v_token text;
begin
  if v_phone !~ '^[0-9]{9}$' or coalesce(p_pin, '') !~ '^[0-9]{4,6}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_credentials');
  end if;

  select * into v_courier from public.couriers c where c.phone = v_phone and c.active;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'invalid_credentials');
  end if;

  select * into v_cred from public.courier_credentials cc where cc.courier_id = v_courier.id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'pin_not_configured');
  end if;
  if v_cred.locked_until is not null and v_cred.locked_until > now() then
    return jsonb_build_object('ok', false, 'reason', 'pin_locked', 'locked_until', v_cred.locked_until);
  end if;

  if extensions.crypt(p_pin, v_cred.pin_hash) <> v_cred.pin_hash then
    -- Mesma escada do PIN do POS (1049): 5 erros abrem 1 min, depois duplica até 15.
    v_attempts := v_cred.failed_attempts + 1;
    if v_attempts >= 5 then
      v_lock_until := now()
        + make_interval(secs => least(900, 60 * (2 ^ least(v_attempts - 5, 4)))::int);
    end if;
    update public.courier_credentials
    set failed_attempts = v_attempts, locked_until = coalesce(v_lock_until, locked_until)
    where courier_id = v_courier.id;
    insert into public.event_log (store_id, type, payload)
    values (v_courier.store_id, 'courier.login_failed',
      jsonb_build_object('courier_id', v_courier.id, 'attempts', v_attempts));
    return jsonb_build_object(
      'ok', false,
      'reason', case when v_lock_until is null then 'invalid_credentials' else 'pin_locked' end,
      'locked_until', v_lock_until);
  end if;

  update public.courier_credentials set failed_attempts = 0, locked_until = null
  where courier_id = v_courier.id;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.courier_sessions (courier_id, token_hash, expires_at)
  values (v_courier.id, encode(extensions.digest(v_token, 'sha256'), 'hex'), now() + interval '30 days');

  insert into public.event_log (store_id, type, payload)
  values (v_courier.store_id, 'courier.login', jsonb_build_object('courier_id', v_courier.id));

  return jsonb_build_object('ok', true, 'token', v_token, 'courier_id', v_courier.id,
    'full_name', v_courier.full_name);
end;
$$;

create or replace function public.courier_logout(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.courier_sessions set revoked_at = now()
  where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
    and revoked_at is null;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.courier_state(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_courier public.couriers%rowtype := private.courier_from_token(p_token);
  v_day_start timestamptz :=
    (date_trunc('day', now() at time zone 'Africa/Maputo')) at time zone 'Africa/Maputo';
begin
  return jsonb_build_object(
    'courier', jsonb_build_object('id', v_courier.id, 'full_name', v_courier.full_name,
      'on_shift', v_courier.on_shift),
    'store', (select jsonb_build_object('name', s.name, 'short_name', s.short_name,
      'phone', s.phone, 'address', s.address) from public.stores s where s.id = v_courier.store_id),
    -- Só as entregas abertas dele. Depois de entregue, os dados do cliente
    -- (nome, telefone, morada) deixam de aparecer no telemóvel.
    'jobs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'delivery_id', d.id,
        'status', d.status,
        'assigned_at', d.assigned_at,
        'picked_up_at', d.picked_up_at,
        'order_id', o.id,
        'order_number', o.order_number,
        'daily_number', o.daily_number,
        'order_status', o.status,
        'customer_name', o.customer_name,
        'customer_phone', o.customer_phone,
        'address', o.address,
        'zone', (select z.name from public.delivery_zones z where z.id = o.delivery_zone_id),
        'notes', o.notes,
        'scheduled_for', o.scheduled_for,
        'fee_cents', private.courier_fee_for(o.id),
        'items', coalesce((
          select jsonb_agg(jsonb_build_object('name', oi.name_snapshot, 'qty', oi.qty) order by oi.id)
          from public.order_items oi where oi.order_id = o.id), '[]'::jsonb)
      ) order by d.assigned_at)
      from public.deliveries d
      join public.orders o on o.id = d.order_id
      where d.courier_id = v_courier.id
        and d.status in ('assigned', 'picked_up')
        and o.status <> 'cancelled'), '[]'::jsonb),
    'today', (
      select jsonb_build_object('deliveries', count(*),
        'earned_cents', coalesce(sum(d.courier_fee_cents), 0))
      from public.deliveries d
      where d.courier_id = v_courier.id and d.status = 'delivered' and d.delivered_at >= v_day_start),
    'balance_cents', (
      select coalesce(sum(l.amount_cents), 0) from public.courier_ledger l
      where l.courier_id = v_courier.id),
    'ledger', coalesce((
      select jsonb_agg(x.row order by x.created_at desc)
      from (
        select l.created_at, jsonb_build_object(
          'kind', l.kind, 'amount_cents', l.amount_cents, 'method', l.method,
          'created_at', l.created_at,
          'order_number', (select o.order_number from public.deliveries d
                           join public.orders o on o.id = d.order_id where d.id = l.delivery_id)
        ) as row
        from public.courier_ledger l
        where l.courier_id = v_courier.id
        order by l.created_at desc
        limit 20
      ) x), '[]'::jsonb)
  );
end;
$$;

create or replace function public.courier_set_shift(p_token text, p_on boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_courier public.couriers%rowtype := private.courier_from_token(p_token);
begin
  update public.couriers set on_shift = coalesce(p_on, false), updated_at = now()
  where id = v_courier.id;
  -- Fora de serviço não há posição: nem a última fica.
  if not coalesce(p_on, false) then
    delete from public.courier_positions where courier_id = v_courier.id;
  end if;
  insert into public.event_log (store_id, type, payload)
  values (v_courier.store_id, case when p_on then 'courier.shift_on' else 'courier.shift_off' end,
    jsonb_build_object('courier_id', v_courier.id));
  return jsonb_build_object('on_shift', coalesce(p_on, false));
end;
$$;

create or replace function public.courier_ping(
  p_token text,
  p_lat double precision,
  p_lng double precision,
  p_accuracy_m integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_courier public.couriers%rowtype := private.courier_from_token(p_token);
begin
  if not v_courier.on_shift then
    return jsonb_build_object('stored', false, 'reason', 'off_shift');
  end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    return jsonb_build_object('stored', false, 'reason', 'invalid_position');
  end if;
  insert into public.courier_positions (courier_id, store_id, lat, lng, accuracy_m, recorded_at)
  values (v_courier.id, v_courier.store_id, p_lat, p_lng, greatest(p_accuracy_m, 0), now())
  on conflict (courier_id) do update
    set lat = excluded.lat, lng = excluded.lng, accuracy_m = excluded.accuracy_m,
        recorded_at = excluded.recorded_at, store_id = excluded.store_id;
  return jsonb_build_object('stored', true);
end;
$$;

create or replace function public.courier_pickup(
  p_token text,
  p_delivery_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_courier public.couriers%rowtype := private.courier_from_token(p_token);
  v_delivery public.deliveries%rowtype;
begin
  select * into v_delivery from public.deliveries d
  where d.id = p_delivery_id and d.courier_id = v_courier.id
  for update;
  if not found then
    raise exception 'delivery_not_found' using errcode = 'P0404';
  end if;
  if v_delivery.status <> 'assigned' then
    return jsonb_build_object('delivery_id', v_delivery.id, 'status', v_delivery.status, 'unchanged', true);
  end if;

  perform private.courier_dispatch_order(v_delivery.order_id);

  update public.deliveries set status = 'picked_up', picked_up_at = now(), updated_at = now()
  where id = v_delivery.id;

  insert into public.event_log (store_id, order_id, type, payload)
  values (v_delivery.store_id, v_delivery.order_id, 'delivery.picked_up',
    jsonb_build_object('delivery_id', v_delivery.id, 'courier_id', v_courier.id));

  return jsonb_build_object('delivery_id', v_delivery.id, 'status', 'picked_up');
end;
$$;

create or replace function public.courier_deliver(
  p_token text,
  p_delivery_id uuid,
  p_lat double precision default null,
  p_lng double precision default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_courier public.couriers%rowtype := private.courier_from_token(p_token);
  v_delivery public.deliveries%rowtype;
  v_fee integer;
begin
  select * into v_delivery from public.deliveries d
  where d.id = p_delivery_id and d.courier_id = v_courier.id
  for update;
  if not found then
    raise exception 'delivery_not_found' using errcode = 'P0404';
  end if;
  if v_delivery.status = 'delivered' then
    return jsonb_build_object('delivery_id', v_delivery.id, 'status', 'delivered', 'unchanged', true,
      'fee_cents', v_delivery.courier_fee_cents);
  end if;

  -- Esqueceu-se de carregar em "Levantei": a entrega só acontece depois de sair.
  if v_delivery.status = 'assigned' then
    perform private.courier_dispatch_order(v_delivery.order_id);
  elsif exists (select 1 from public.orders o where o.id = v_delivery.order_id and o.status = 'cancelled') then
    raise exception 'order_cancelled' using errcode = 'P0409';
  end if;

  v_fee := coalesce(private.courier_fee_for(v_delivery.order_id), 0);

  update public.deliveries
  set status = 'delivered',
      picked_up_at = coalesce(picked_up_at, now()),
      delivered_at = now(),
      delivered_lat = case when p_lat between -90 and 90 and p_lng between -180 and 180 then p_lat end,
      delivered_lng = case when p_lat between -90 and 90 and p_lng between -180 and 180 then p_lng end,
      courier_fee_cents = v_fee,
      updated_at = now()
  where id = v_delivery.id;

  if v_fee > 0 then
    insert into public.courier_ledger (store_id, courier_id, delivery_id, kind, amount_cents)
    values (v_delivery.store_id, v_courier.id, v_delivery.id, 'delivery_fee', v_fee)
    on conflict (delivery_id, kind) where delivery_id is not null do nothing;
  end if;

  insert into public.event_log (store_id, order_id, type, payload)
  values (v_delivery.store_id, v_delivery.order_id, 'delivery.delivered',
    jsonb_build_object('delivery_id', v_delivery.id, 'courier_id', v_courier.id, 'fee_cents', v_fee));

  return jsonb_build_object('delivery_id', v_delivery.id, 'status', 'delivered', 'fee_cents', v_fee);
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. O cliente vê quem vem: só o primeiro nome, e só a caminho
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'get_order_status_before_couriers'
  ) then
    alter function public.get_order_status(uuid) set schema private;
    alter function private.get_order_status(uuid) rename to get_order_status_before_couriers;
  end if;
end $$;
revoke all on function private.get_order_status_before_couriers(uuid) from public, anon, authenticated;

create or replace function public.get_order_status(p_order_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_result jsonb;
  v_delivery record;
begin
  v_result := private.get_order_status_before_couriers(p_order_id);
  if v_result is null then
    return v_result;
  end if;
  select d.status, split_part(btrim(c.full_name), ' ', 1) as first_name
  into v_delivery
  from public.deliveries d join public.couriers c on c.id = d.courier_id
  where d.order_id = p_order_id;
  if not found then
    return v_result;
  end if;
  return v_result || jsonb_build_object('delivery', jsonb_build_object(
    'status', v_delivery.status,
    'courier_first_name', case when v_delivery.status = 'picked_up' then v_delivery.first_name end));
end $$;
revoke all on function public.get_order_status(uuid) from public;
grant execute on function public.get_order_status(uuid) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9. Grants
-- ---------------------------------------------------------------------------
revoke all on function public.save_courier(uuid, uuid, text, text, boolean) from public, anon;
revoke all on function public.set_courier_pin(uuid, text) from public, anon;
revoke all on function public.set_courier_pay(uuid, integer, integer) from public, anon;
revoke all on function public.assign_courier(uuid, uuid) from public, anon;
revoke all on function public.unassign_courier(uuid) from public, anon;
revoke all on function public.get_couriers_board(uuid) from public, anon;
revoke all on function public.courier_payout(uuid, integer, text, text, uuid) from public, anon;
revoke all on function public.courier_adjust(uuid, integer, text, uuid) from public, anon;
grant execute on function public.save_courier(uuid, uuid, text, text, boolean) to authenticated;
grant execute on function public.set_courier_pin(uuid, text) to authenticated;
grant execute on function public.set_courier_pay(uuid, integer, integer) to authenticated;
grant execute on function public.assign_courier(uuid, uuid) to authenticated;
grant execute on function public.unassign_courier(uuid) to authenticated;
grant execute on function public.get_couriers_board(uuid) to authenticated;
grant execute on function public.courier_payout(uuid, integer, text, text, uuid) to authenticated;
grant execute on function public.courier_adjust(uuid, integer, text, uuid) to authenticated;

-- O telemóvel nunca fala com a BD directamente: só a rota /api/estafeta, com a service key.
revoke all on function public.courier_login(text, text) from public, anon, authenticated;
revoke all on function public.courier_logout(text) from public, anon, authenticated;
revoke all on function public.courier_state(text) from public, anon, authenticated;
revoke all on function public.courier_set_shift(text, boolean) from public, anon, authenticated;
revoke all on function public.courier_ping(text, double precision, double precision, integer) from public, anon, authenticated;
revoke all on function public.courier_pickup(text, uuid) from public, anon, authenticated;
revoke all on function public.courier_deliver(text, uuid, double precision, double precision) from public, anon, authenticated;
grant execute on function public.courier_login(text, text) to service_role;
grant execute on function public.courier_logout(text) to service_role;
grant execute on function public.courier_state(text) to service_role;
grant execute on function public.courier_set_shift(text, boolean) to service_role;
grant execute on function public.courier_ping(text, double precision, double precision, integer) to service_role;
grant execute on function public.courier_pickup(text, uuid) to service_role;
grant execute on function public.courier_deliver(text, uuid, double precision, double precision) to service_role;
