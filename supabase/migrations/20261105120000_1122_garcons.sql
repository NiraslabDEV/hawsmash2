-- HAWSMASH 2.0 — 1122: o garçom tira o pedido no telemóvel.
--
-- Até aqui o pedido da mesa entrava de duas maneiras: o cliente pelo QR, ou o
-- caixa ao balcão (`launch_table_order`, 1081). Com sala cheia, o garçom anota
-- no papel, caminha até ao balcão e espera que o caixa o lance. Agora o
-- garçom lança-o do telemóvel, na mesa, e o resto é igual ao do balcão:
--
--   · o preço é o da loja, calculado aqui (`price_table_items`, Regra 2);
--   · o stock e a matéria-prima baixam na mesma transacção;
--   · a comanda sai nas vias da loja e a senha pequena no balcão (1092), agora
--     com "Garçom: <nome>" — a cozinha sabe a quem entregar;
--   · o pedido fica na conta aberta da mesa, que o caixa cobra no fim
--     (`close_table_bill`). O garçom não toca em dinheiro.
--
-- DECISÃO: o garçom NÃO é uma conta Supabase nem um perfil de `staff_profiles`.
-- É o mesmo desenho do estafeta (1115) e pela mesma razão: toda a RLS da loja é
-- `auth_can_store(store_id)`, e um perfil `waiter` com sessão passava a ler o
-- caixa, os pagamentos e os clientes da loja inteira (o problema da cozinha,
-- B-116). Entra com telefone + PIN numa rota do servidor, recebe um token
-- aleatório (a BD só guarda o sha256) e tudo o que faz passa por RPCs
-- `waiter_*` que só o service_role executa e que validam o token primeiro.
-- Revogar = desactivar o garçom ou trocar-lhe o PIN.
--
-- DECISÃO: `launch_table_order` (1092) fica como está — é o caminho do balcão
-- em produção. `waiter_launch_order` repete a orquestração, mas o dinheiro, o
-- stock e o papel vêm das mesmas funções privadas (`price_table_items`,
-- `consume_order_stock`, `enqueue_table_comanda`): não há uma segunda conta.
--
-- Idempotente pelo `clientSaleId` do telemóvel (Regra 4): rede fraca na sala e
-- um segundo toque em "Enviar" devolvem o mesmo pedido, nunca dois.
--
-- Forward-only: tabelas e funções novas; substitui `build_table_comanda` (1081)
-- e `pos_table_overview` (1102) só para acrescentar o nome do garçom.

-- ---------------------------------------------------------------------------
-- 1. Tabelas
-- ---------------------------------------------------------------------------
create table if not exists public.waiters (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id),
  full_name text not null check (length(btrim(full_name)) between 2 and 80),
  -- 9 dígitos, sem indicativo. Normalizado por private.normalize_courier_phone.
  phone text not null check (phone ~ '^[0-9]{9}$'),
  active boolean not null default true,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- O telefone é o login: um só garçom activo por número.
create unique index if not exists waiters_phone_active_uidx
  on public.waiters (phone) where active;
create index if not exists waiters_store_idx on public.waiters (store_id);

create table if not exists public.waiter_credentials (
  waiter_id uuid primary key references public.waiters(id) on delete cascade,
  pin_hash text not null,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.waiter_sessions (
  id uuid primary key default gen_random_uuid(),
  waiter_id uuid not null references public.waiters(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index if not exists waiter_sessions_waiter_idx on public.waiter_sessions (waiter_id);

-- Quem lançou o pedido da mesa. Null = QR ou balcão.
alter table public.orders
  add column if not exists waiter_id uuid references public.waiters(id);
create index if not exists orders_waiter_idx
  on public.orders (waiter_id, created_at desc) where waiter_id is not null;

comment on column public.orders.waiter_id is
  'Garçom que lançou o pedido da mesa pelo telemóvel (1122). Null = QR ou balcão.';

-- ---------------------------------------------------------------------------
-- 2. RLS — leitura pelo gerente/dono da loja; escrita só por RPC
-- ---------------------------------------------------------------------------
alter table public.waiters enable row level security;
alter table public.waiter_credentials enable row level security;
alter table public.waiter_sessions enable row level security;

revoke all on public.waiters, public.waiter_credentials, public.waiter_sessions
  from public, anon, authenticated;

grant select, insert, update, delete on public.waiters, public.waiter_credentials,
  public.waiter_sessions to service_role;

-- PIN e sessões: nenhuma policy, nenhum grant à equipa. Só as funções security definer.
grant select on public.waiters to authenticated;

drop policy if exists waiters_store_select on public.waiters;
create policy waiters_store_select on public.waiters for select to authenticated
  using ((select private.auth_role()) in ('owner', 'manager')
         and (select private.auth_can_store(store_id)));

-- ---------------------------------------------------------------------------
-- 3. Helpers privados
-- ---------------------------------------------------------------------------

-- O token do telemóvel → o garçom. Falha fechado.
create or replace function private.waiter_from_token(p_token text)
returns public.waiters
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_waiter public.waiters%rowtype;
  v_session_id uuid;
begin
  if p_token is null or length(p_token) < 32 then
    raise exception 'waiter_session_invalid' using errcode = 'P0401';
  end if;

  select ws.id into v_session_id
  from public.waiter_sessions ws
  where ws.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and ws.revoked_at is null
    and ws.expires_at > now();
  if not found then
    raise exception 'waiter_session_invalid' using errcode = 'P0401';
  end if;

  select w.* into v_waiter
  from public.waiter_sessions ws
  join public.waiters w on w.id = ws.waiter_id
  where ws.id = v_session_id and w.active;
  if not found then
    raise exception 'waiter_session_invalid' using errcode = 'P0401';
  end if;

  update public.waiter_sessions set last_used_at = now() where id = v_session_id;
  update public.waiters set last_seen_at = now() where id = v_waiter.id;
  return v_waiter;
end;
$$;

-- A loja onde o garçom trabalha, se estiver a operar o balcão — a mesma porta
-- que o POS tem em `pos_device_store`.
create or replace function private.waiter_store(p_waiter public.waiters)
returns public.stores
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_store public.stores%rowtype;
begin
  select s.* into v_store
  from public.stores s
  where s.id = p_waiter.store_id
    and s.active
    and s.counter_enabled;
  if not found then
    raise exception 'counter_disabled' using errcode = 'P0403';
  end if;
  return v_store;
end;
$$;

-- A gestão de garçons é do gerente e do dono, na sua loja.
create or replace function private.assert_waiter_admin(p_store_id uuid)
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
    raise exception 'waiter_access_denied' using errcode = 'P0403';
  end if;
end;
$$;

revoke all on function private.waiter_from_token(text) from public, anon, authenticated;
revoke all on function private.waiter_store(public.waiters) from public, anon, authenticated;
revoke all on function private.assert_waiter_admin(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Gestão (painel): criar, PIN, lista
-- ---------------------------------------------------------------------------
create or replace function public.save_waiter(
  p_waiter_id uuid,
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
  v_existing public.waiters%rowtype;
  v_id uuid;
begin
  if v_phone !~ '^[0-9]{9}$' then
    raise exception 'invalid_waiter_phone' using errcode = 'P0007';
  end if;
  if length(btrim(coalesce(p_full_name, ''))) not between 2 and 80 then
    raise exception 'invalid_waiter_name' using errcode = 'P0007';
  end if;

  if p_waiter_id is null then
    perform private.assert_waiter_admin(p_store_id);
    begin
      insert into public.waiters (store_id, full_name, phone, active)
      values (p_store_id, btrim(p_full_name), v_phone, coalesce(p_active, true))
      returning id into v_id;
    exception when unique_violation then
      raise exception 'waiter_phone_taken' using errcode = 'P0409';
    end;
  else
    select * into v_existing from public.waiters w where w.id = p_waiter_id for update;
    if not found then
      raise exception 'waiter_not_found' using errcode = 'P0404';
    end if;
    -- A loja de um garçom não muda: os pedidos que lançou são dela.
    perform private.assert_waiter_admin(v_existing.store_id);
    begin
      update public.waiters
      set full_name = btrim(p_full_name),
          phone = v_phone,
          active = coalesce(p_active, active),
          updated_at = now()
      where id = p_waiter_id;
    exception when unique_violation then
      raise exception 'waiter_phone_taken' using errcode = 'P0409';
    end;
    v_id := p_waiter_id;
    if not coalesce(p_active, true) then
      update public.waiter_sessions set revoked_at = now()
      where waiter_id = v_id and revoked_at is null;
    end if;
  end if;

  insert into public.event_log (store_id, actor_user_id, type, payload)
  select w.store_id, (select auth.uid()), 'waiter.saved',
    jsonb_build_object('waiter_id', w.id, 'full_name', w.full_name, 'active', w.active,
      'created', p_waiter_id is null)
  from public.waiters w where w.id = v_id;

  return v_id;
end;
$$;

create or replace function public.set_waiter_pin(p_waiter_id uuid, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store_id uuid;
begin
  select w.store_id into v_store_id from public.waiters w where w.id = p_waiter_id;
  if not found then
    raise exception 'waiter_not_found' using errcode = 'P0404';
  end if;
  perform private.assert_waiter_admin(v_store_id);
  if coalesce(p_pin, '') !~ '^[0-9]{4,6}$' then
    raise exception 'invalid_pin_format' using errcode = 'P0007';
  end if;

  insert into public.waiter_credentials (waiter_id, pin_hash, failed_attempts, locked_until, updated_at)
  values (p_waiter_id, extensions.crypt(p_pin, extensions.gen_salt('bf', 10)), 0, null, now())
  on conflict (waiter_id) do update
    set pin_hash = excluded.pin_hash, failed_attempts = 0, locked_until = null, updated_at = now();

  -- PIN novo = o telemóvel antigo (perdido, de outra pessoa) deixa de entrar.
  update public.waiter_sessions set revoked_at = now()
  where waiter_id = p_waiter_id and revoked_at is null;

  -- Nunca o PIN no payload.
  insert into public.event_log (store_id, actor_user_id, type, payload)
  values (v_store_id, (select auth.uid()), 'waiter.pin_set', jsonb_build_object('waiter_id', p_waiter_id));

  return jsonb_build_object('waiter_id', p_waiter_id, 'configured', true);
end;
$$;

-- Os garçons da loja, para o painel: quem tem PIN e quanto lançou hoje.
create or replace function public.get_waiters(p_store_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_day_start timestamptz :=
    (date_trunc('day', now() at time zone 'Africa/Maputo')) at time zone 'Africa/Maputo';
begin
  perform private.assert_waiter_admin(p_store_id);

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', w.id,
      'full_name', w.full_name,
      'phone', w.phone,
      'active', w.active,
      'last_seen_at', w.last_seen_at,
      'has_pin', exists (select 1 from public.waiter_credentials wc where wc.waiter_id = w.id),
      'orders_today', (
        select count(*) from public.orders o
        where o.waiter_id = w.id and o.created_at >= v_day_start and o.status <> 'cancelled'),
      'total_today_cents', (
        select coalesce(sum(o.total_cents), 0) from public.orders o
        where o.waiter_id = w.id and o.created_at >= v_day_start and o.status <> 'cancelled')
    ) order by w.active desc, w.full_name)
    from public.waiters w
    where w.store_id = p_store_id
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.save_waiter(uuid, uuid, text, text, boolean) from public, anon;
revoke all on function public.set_waiter_pin(uuid, text) from public, anon;
revoke all on function public.get_waiters(uuid) from public, anon;
grant execute on function public.save_waiter(uuid, uuid, text, text, boolean) to authenticated;
grant execute on function public.set_waiter_pin(uuid, text) to authenticated;
grant execute on function public.get_waiters(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. O papel: a comanda leva o nome do garçom
-- ---------------------------------------------------------------------------
-- Igual à 1081, mais "Garçom: Ana" nas observações — o formato que qualquer
-- bridge já imprime, sem trocar o .exe das lojas. Só no papel: `orders.notes`
-- continua a ser só o que se escreveu no pedido.
create or replace function private.build_table_comanda(p_order_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'order_number', o.order_number,
    'daily_number', o.daily_number,
    'customer_name', coalesce(nullif(btrim(o.customer_name), ''), 'Mesa ' || t.number),
    'fulfillment_type', 'dine_in',
    'table_number', t.number,
    'items', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'name', oi.name_snapshot,
          'quantity', oi.qty,
          'variant', oi.variant_name_snapshot,
          'notes', oi.notes,
          'person', oi.person_label,
          'modifiers',
            case when jsonb_typeof(oi.modifiers) = 'array' then oi.modifiers else '[]'::jsonb end
            || case
              when jsonb_typeof(oi.addons) = 'array' and jsonb_array_length(oi.addons) > 0 then
                jsonb_build_array(jsonb_build_object(
                  'group_name', 'Extras',
                  'options', (
                    select coalesce(jsonb_agg(jsonb_build_object('name', a.value ->> 'name')), '[]'::jsonb)
                    from jsonb_array_elements(oi.addons) a
                  )
                ))
              else '[]'::jsonb
            end
        ) order by oi.person_label nulls first, oi.id
      ), '[]'::jsonb)
      from public.order_items oi
      where oi.order_id = o.id
    ),
    'payment_method', 'no_payment',
    'total_cents', o.total_cents,
    'notes', nullif(concat_ws(' · ', 'Garçom: ' || w.full_name, nullif(btrim(o.notes), '')), ''),
    'created_at', o.created_at
  )
  from public.orders o
  join public.tables t on t.id = o.table_id
  left join public.waiters w on w.id = o.waiter_id
  where o.id = p_order_id;
$$;

revoke all on function private.build_table_comanda(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. As mesas, como o POS e o telemóvel as vêem
-- ---------------------------------------------------------------------------
-- Uma só leitura da conta aberta para os dois ecrãs: o garçom vê exactamente
-- o que o caixa vai cobrar.
create or replace function private.table_overview_json(p_store_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(mesa order by (mesa ->> 'number')::integer), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'id', t.id,
      'number', t.number,
      'active', t.active,
      'orders', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', o.id,
            'order_number', o.order_number,
            'daily_number', o.daily_number,
            'status', o.status,
            'origin', case when o.client_sale_id is null then 'qr' else 'pos' end,
            'waiter_name', w.full_name,
            'customer_name', o.customer_name,
            'created_at', o.created_at,
            'total_cents', o.total_cents,
            'notes', o.notes,
            'items', (
              select coalesce(jsonb_agg(
                jsonb_build_object(
                  'id', oi.id,
                  'name', oi.name_snapshot,
                  'variant', oi.variant_name_snapshot,
                  'qty', oi.qty,
                  'unit_price_cents', oi.unit_price_cents,
                  'notes', oi.notes,
                  'person', oi.person_label,
                  'addons', case when jsonb_typeof(oi.addons) = 'array' then oi.addons else '[]'::jsonb end
                ) order by oi.person_label nulls first, oi.id
              ), '[]'::jsonb)
              from public.order_items oi
              where oi.order_id = o.id
            )
          ) order by o.created_at, o.id
        )
        from private.table_tab_order_ids(p_store_id, t.id) tab(id)
        join public.orders o on o.id = tab.id
        left join public.waiters w on w.id = o.waiter_id
      ), '[]'::jsonb)
    ) as mesa
    from public.tables t
    where t.store_id = p_store_id
  ) mesas
  -- Uma mesa desactivada com conta por fechar continua a aparecer.
  where (mesa ->> 'active')::boolean
    or jsonb_array_length(mesa -> 'orders') > 0;
$$;

revoke all on function private.table_overview_json(uuid) from public, anon, authenticated;

-- O POS, igual à 1102, com `waiter_name` em cada pedido.
create or replace function public.pos_table_overview(p_device_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_store public.stores%rowtype;
begin
  v_store := private.pos_device_store(p_device_id);
  return jsonb_build_object(
    'store_id', v_store.id,
    'tables', private.table_overview_json(v_store.id)
  );
end;
$$;

revoke all on function public.pos_table_overview(uuid) from public, anon;
grant execute on function public.pos_table_overview(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. O telemóvel do garçom (só service_role; o token é a chave)
-- ---------------------------------------------------------------------------
create or replace function public.waiter_login(p_phone text, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone text := private.normalize_courier_phone(p_phone);
  v_waiter public.waiters%rowtype;
  v_cred public.waiter_credentials%rowtype;
  v_attempts integer;
  v_lock_until timestamptz;
  v_token text;
begin
  if v_phone !~ '^[0-9]{9}$' or coalesce(p_pin, '') !~ '^[0-9]{4,6}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_credentials');
  end if;

  select * into v_waiter from public.waiters w where w.phone = v_phone and w.active;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'invalid_credentials');
  end if;

  select * into v_cred from public.waiter_credentials wc where wc.waiter_id = v_waiter.id for update;
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
    update public.waiter_credentials
    set failed_attempts = v_attempts, locked_until = coalesce(v_lock_until, locked_until)
    where waiter_id = v_waiter.id;
    insert into public.event_log (store_id, type, payload)
    values (v_waiter.store_id, 'waiter.login_failed',
      jsonb_build_object('waiter_id', v_waiter.id, 'attempts', v_attempts));
    return jsonb_build_object(
      'ok', false,
      'reason', case when v_lock_until is null then 'invalid_credentials' else 'pin_locked' end,
      'locked_until', v_lock_until);
  end if;

  update public.waiter_credentials set failed_attempts = 0, locked_until = null
  where waiter_id = v_waiter.id;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.waiter_sessions (waiter_id, token_hash, expires_at)
  values (v_waiter.id, encode(extensions.digest(v_token, 'sha256'), 'hex'), now() + interval '30 days');

  insert into public.event_log (store_id, type, payload)
  values (v_waiter.store_id, 'waiter.login', jsonb_build_object('waiter_id', v_waiter.id));

  return jsonb_build_object('ok', true, 'token', v_token, 'waiter_id', v_waiter.id,
    'full_name', v_waiter.full_name);
end;
$$;

create or replace function public.waiter_logout(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.waiter_sessions set revoked_at = now()
  where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
    and revoked_at is null;
  return jsonb_build_object('ok', true);
end;
$$;

-- O ecrã do garçom: quem é, a loja, e as mesas com a conta aberta.
create or replace function public.waiter_state(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_waiter public.waiters%rowtype := private.waiter_from_token(p_token);
  v_store public.stores%rowtype;
  v_day_start timestamptz :=
    (date_trunc('day', now() at time zone 'Africa/Maputo')) at time zone 'Africa/Maputo';
begin
  select s.* into v_store from public.stores s where s.id = v_waiter.store_id;

  return jsonb_build_object(
    'waiter', jsonb_build_object('id', v_waiter.id, 'full_name', v_waiter.full_name),
    'store', jsonb_build_object(
      'name', v_store.name,
      'short_name', v_store.short_name,
      -- O balcão fechado não recebe pedidos: o telemóvel avisa em vez de falhar no envio.
      'open', v_store.active and v_store.counter_enabled),
    'tables', private.table_overview_json(v_store.id),
    'today', (
      select jsonb_build_object('orders', count(*))
      from public.orders o
      where o.waiter_id = v_waiter.id and o.created_at >= v_day_start and o.status <> 'cancelled')
  );
end;
$$;

-- O cardápio da loja dele, só com o que se pode vender agora. O alargado (com
-- os esgotados a cinzento, como no POS) exige uma sessão da equipa
-- (`menu_scope_requires_auth`), e o garçom não a tem — de propósito.
create or replace function public.waiter_menu(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_waiter public.waiters%rowtype := private.waiter_from_token(p_token);
  v_slug text;
begin
  select s.slug into v_slug from public.stores s where s.id = v_waiter.store_id;
  return public.get_menu(v_slug, null, false);
end;
$$;

-- Lançar na mesa. O mesmo pedido que o balcão lança (1092), assinado pelo garçom.
create or replace function public.waiter_launch_order(p_token text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_waiter public.waiters%rowtype := private.waiter_from_token(p_token);
  v_store public.stores%rowtype;
  v_client_sale_id uuid;
  v_table_id uuid;
  v_table public.tables%rowtype;
  v_existing public.orders%rowtype;
  v_lines jsonb;
  v_line jsonb;
  v_subtotal integer := 0;
  v_day date;
  v_daily integer;
  v_order_number text;
  v_order_id uuid;
  v_name text;
begin
  begin
    v_client_sale_id := nullif(p_payload ->> 'clientSaleId', '')::uuid;
    v_table_id := nullif(p_payload ->> 'tableId', '')::uuid;
  exception when invalid_text_representation then
    raise exception 'invalid_waiter_payload' using errcode = 'P0007';
  end;
  if v_client_sale_id is null then
    raise exception 'client_sale_id_required' using errcode = 'P0007';
  end if;

  -- Repetir o mesmo envio devolve o mesmo pedido (Regra 4).
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_client_sale_id::text, 0)
  );
  select o.* into v_existing
  from public.orders o
  where o.client_sale_id = v_client_sale_id;
  if found then
    -- A chave de outro garçom, ou de outra loja, não abre o pedido dele.
    if v_existing.waiter_id is distinct from v_waiter.id then
      raise exception 'client_sale_id_store_conflict' using errcode = 'P0409';
    end if;
    return jsonb_build_object(
      'order_id', v_existing.id,
      'order_number', v_existing.order_number,
      'daily_number', v_existing.daily_number,
      'total_cents', v_existing.total_cents,
      'table_id', v_existing.table_id,
      'table_number', (select t.number from public.tables t where t.id = v_existing.table_id),
      'customer_name', v_existing.customer_name,
      'duplicate', true
    );
  end if;

  v_store := private.waiter_store(v_waiter);

  -- Regra 3: a mesa tem de ser da loja dele.
  select t.* into v_table
  from public.tables t
  where t.id = v_table_id
    and t.store_id = v_store.id
    and t.active;
  if not found then
    raise exception 'invalid_table' using errcode = 'P0060';
  end if;

  -- O nome da conta (1092): o que o garçom escreveu, ou o que a conta já tem.
  v_name := left(nullif(btrim(p_payload ->> 'customerName'), ''), 60);
  if v_name is null then
    v_name := private.table_tab_name(v_store.id, v_table.id);
  end if;

  -- Regra 2: o preço é da loja, calculado aqui.
  v_lines := private.price_table_items(v_store.id, p_payload -> 'items');
  for v_line in select value from jsonb_array_elements(v_lines)
  loop
    v_subtotal := v_subtotal
      + (v_line ->> 'unit_price_cents')::integer * (v_line ->> 'qty')::integer;
  end loop;

  v_day := (now() at time zone 'Africa/Maputo')::date;
  insert into public.order_counters (store_id, day, seq)
  values (v_store.id, v_day, 1)
  on conflict (store_id, day) do update
    set seq = public.order_counters.seq + 1
  returning seq into v_daily;

  v_order_number := private.next_order_number(v_store.id);

  perform set_config('app.request_store_id', v_store.id::text, true);

  insert into public.orders (
    store_id, order_number, daily_number, client_sale_id, table_id, waiter_id,
    status, flow, fulfillment_type, channel,
    customer_name, subtotal_cents, delivery_fee_cents, total_cents,
    payment_method, notes
  ) values (
    v_store.id, v_order_number, v_daily, v_client_sale_id, v_table.id, v_waiter.id,
    'in_preparation', 'dine_in', 'dine_in', 'dine_in',
    'Mesa ' || v_table.number || coalesce(' · ' || v_name, ''),
    v_subtotal, 0, v_subtotal,
    'no_payment', left(nullif(btrim(p_payload ->> 'notes'), ''), 300)
  )
  returning id into v_order_id;

  for v_line in select value from jsonb_array_elements(v_lines)
  loop
    insert into public.order_items (
      order_id, store_id, menu_item_id, name_snapshot, qty, unit_price_cents,
      station, notes, variant_name_snapshot, addons
    ) values (
      v_order_id,
      v_store.id,
      (v_line ->> 'menu_item_id')::uuid,
      v_line ->> 'name',
      (v_line ->> 'qty')::integer,
      (v_line ->> 'unit_price_cents')::integer,
      v_line ->> 'station',
      v_line ->> 'notes',
      v_line ->> 'variant_name',
      coalesce(v_line -> 'addons', '[]'::jsonb)
    );
  end loop;

  -- Stock do produto e matéria-prima, na mesma transacção: se faltar, o
  -- lançamento inteiro reverte (out_of_stock / out_of_ingredient).
  perform private.consume_order_stock(v_order_id);

  insert into public.event_log (order_id, store_id, type, payload)
  values (
    v_order_id, v_store.id, 'table.order_launched',
    jsonb_build_object(
      'source', 'waiter',
      'waiter_id', v_waiter.id,
      'client_sale_id', v_client_sale_id,
      'table_number', v_table.number,
      'total_cents', v_subtotal
    )
  );

  -- O papel é best-effort (Regra 1): sem impressora o pedido fica na mesa.
  begin
    perform private.enqueue_table_comanda(v_order_id);
  exception when others then
    insert into public.event_log (order_id, store_id, type, payload)
    values (v_order_id, v_store.id, 'print.table_comanda_failed',
      jsonb_build_object('error', sqlstate, 'source', 'waiter'));
  end;

  return jsonb_build_object(
    'order_id', v_order_id,
    'order_number', v_order_number,
    'daily_number', v_daily,
    'total_cents', v_subtotal,
    'table_id', v_table.id,
    'table_number', v_table.number,
    'customer_name', 'Mesa ' || v_table.number || coalesce(' · ' || v_name, ''),
    'duplicate', false
  );
end;
$$;

-- "Servido": o garçom pousou o prato na mesa. Comida na mão do garçom é comida
-- pronta: se ninguém marcou pronto, marca-se agora (como o estafeta, 1115).
create or replace function public.waiter_serve_order(p_token text, p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_waiter public.waiters%rowtype := private.waiter_from_token(p_token);
  v_order record;
  v_reason text;
begin
  select o.id, o.store_id, o.status, o.table_id, o.fulfillment_type into v_order
  from public.orders o
  where o.id = p_order_id
  for update;
  -- Pedido de outra loja, ou que não é de mesa: para o garçom não existe.
  if not found
     or v_order.store_id <> v_waiter.store_id
     or v_order.table_id is null
     or v_order.fulfillment_type <> 'dine_in' then
    raise exception 'order_not_found' using errcode = 'P0404';
  end if;

  if v_order.status = 'delivered' then
    return jsonb_build_object('order_id', p_order_id, 'status', 'delivered', 'unchanged', true);
  end if;
  if v_order.status = 'cancelled' then
    raise exception 'order_cancelled' using errcode = 'P0409';
  end if;
  if v_order.status not in ('in_preparation', 'ready') then
    raise exception 'order_not_ready' using errcode = 'P0409';
  end if;

  v_reason := 'Servido por ' || v_waiter.full_name;
  if v_order.status = 'in_preparation' then
    perform public.advance_order(p_order_id, 'MARK_READY', v_reason);
  end if;
  perform public.advance_order(p_order_id, 'DELIVER', v_reason);

  insert into public.event_log (order_id, store_id, type, payload)
  values (p_order_id, v_order.store_id, 'table.order_served',
    jsonb_build_object('waiter_id', v_waiter.id, 'previous_status', v_order.status));

  return jsonb_build_object('order_id', p_order_id, 'status', 'delivered', 'unchanged', false);
end;
$$;

revoke all on function public.waiter_login(text, text) from public, anon, authenticated;
revoke all on function public.waiter_logout(text) from public, anon, authenticated;
revoke all on function public.waiter_state(text) from public, anon, authenticated;
revoke all on function public.waiter_menu(text) from public, anon, authenticated;
revoke all on function public.waiter_launch_order(text, jsonb) from public, anon, authenticated;
revoke all on function public.waiter_serve_order(text, uuid) from public, anon, authenticated;
grant execute on function public.waiter_login(text, text) to service_role;
grant execute on function public.waiter_logout(text) to service_role;
grant execute on function public.waiter_state(text) to service_role;
grant execute on function public.waiter_menu(text) to service_role;
grant execute on function public.waiter_launch_order(text, jsonb) to service_role;
grant execute on function public.waiter_serve_order(text, uuid) to service_role;

notify pgrst, 'reload schema';
