-- 1034 — Conta do cliente: moradas guardadas e sessão presa ao dispositivo.
--
-- O PEDIDO: o cliente entra e o sistema já o conhece — não volta a escrever
-- nome nem morada, escolhe entre CASA, TRABALHO ou morada nova.
--
-- O PROBLEMA: (public)/CLAUDE.md §9 fechou que identificação só por telefone
-- NUNCA devolve morada. A razão é concreta: se escrever um número chega para
-- ver "Casa — Av. Julius Nyerere 812", então quem souber o número de outra
-- pessoa vê onde ela mora. Num sistema de entregas isso não é conformidade,
-- é segurança de gente real.
--
-- A SOLUÇÃO: a morada deixa de estar atrás do telefone e passa a estar atrás
-- de uma prova de posse do dispositivo.
--
--   1. Primeiro pedido: o cliente escreve nome e morada como sempre. No fim,
--      o ecrã de pedido recebido chama `account_bind_device(order_id)`. Quem
--      sabe o UUID do pedido é quem o fez — é esse o segredo. O servidor
--      devolve um token, o browser guarda-o num cookie httpOnly.
--   2. A partir daí: `account_me(token)` traz nome e moradas. Zero fricção,
--      zero SMS, zero custo. É isto que faz o "já estou logado".
--   3. Telemóvel novo: `account_request_code` + `account_verify_code`. O
--      código vai por email (Resend, já ligado) para quem tem email no
--      histórico; quem não tem faz um pedido normal e o dispositivo prende-se
--      no fim. O canal SMS entra aqui quando houver fornecedor — as RPCs já
--      estão desenhadas para isso, só muda quem entrega o código.
--
-- O que NÃO muda: `create_order` continua igual, `customers` continua
-- indexada por telefone, e nenhuma RPC anónima devolve morada sem token.
-- Um telefone sozinho continua a valer resumos e mais nada.
--
-- Forward-only e idempotente (§11.7).

-- ─────────────────────────────────────────────────────────────────────────────
-- Tabelas
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.customer_addresses (
  id               uuid primary key default gen_random_uuid(),
  customer_phone   text not null references public.customers(phone) on delete cascade,
  -- Etiqueta livre: 'Casa' e 'Trabalho' são só os dois atalhos que a loja
  -- sugere. Quem entrega três encomendas no escritório da irmã escreve isso.
  label            text not null,
  address          text not null,
  -- Pista, não verdade: as zonas são por loja, e o cliente pode trocar de
  -- loja. O checkout só pré-selecciona se a zona for da loja escolhida.
  delivery_zone_id uuid null references public.delivery_zones(id) on delete set null,
  notes            text not null default '',
  is_default       boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists customer_addresses_phone_idx
  on public.customer_addresses (customer_phone, is_default desc, updated_at desc);

-- Uma só morada por defeito em cada cliente.
create unique index if not exists customer_addresses_one_default_idx
  on public.customer_addresses (customer_phone)
  where is_default;

create table if not exists public.customer_devices (
  id             uuid primary key default gen_random_uuid(),
  customer_phone text not null references public.customers(phone) on delete cascade,
  -- Só o hash. Se a base de dados vazar, o que lá está não abre sessão
  -- nenhuma: o token vive no cookie do cliente e mais em lado nenhum.
  token_hash     text not null unique,
  label          text not null default '',
  created_at     timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  revoked_at     timestamptz null
);

create index if not exists customer_devices_phone_idx
  on public.customer_devices (customer_phone)
  where revoked_at is null;

create table if not exists public.customer_login_codes (
  phone      text primary key references public.customers(phone) on delete cascade,
  code_hash  text not null,
  expires_at timestamptz not null,
  attempts   int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.customer_addresses   enable row level security;
alter table public.customer_devices     enable row level security;
alter table public.customer_login_codes enable row level security;

-- A equipa vê moradas (precisa delas para entregar). Ninguém vê os tokens
-- nem os códigos — nem a equipa: não há uso legítimo para isso e um segredo
-- que ninguém consulta é um segredo que ninguém vaza.
drop policy if exists "staff_read" on public.customer_addresses;
create policy "staff_read" on public.customer_addresses
  for select to authenticated using (true);

-- anon: nenhuma policy em nenhuma das três. Acesso só pelas RPCs abaixo.

-- ─────────────────────────────────────────────────────────────────────────────
-- Helpers privados
-- ─────────────────────────────────────────────────────────────────────────────

create schema if not exists private;

-- Hash de um segredo. Um só sítio: se um dia mudar de algoritmo, muda aqui.
create or replace function private.secret_hash(p_secret text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(extensions.digest(coalesce(p_secret, ''), 'sha256'), 'hex');
$$;

-- Telefone por trás de um token válido, ou null. Toca no last_seen_at para o
-- painel poder mostrar dispositivos activos sem uma segunda escrita.
create or replace function private.customer_by_token(p_token text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone text;
begin
  if coalesce(btrim(p_token), '') = '' then
    return null;
  end if;

  update public.customer_devices
     set last_seen_at = now()
   where token_hash = private.secret_hash(p_token)
     and revoked_at is null
  returning customer_phone into v_phone;

  return v_phone;
end;
$$;

-- Perfil + moradas. É o payload que todas as RPCs de conta devolvem, para o
-- cliente nunca ter de juntar duas respostas.
create or replace function private.customer_profile(p_phone text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer record;
  v_addresses jsonb;
begin
  select c.phone, c.name, c.orders_count, c.total_spent_cents
    into v_customer
  from public.customers c
  where c.phone = p_phone;

  if v_customer.phone is null then
    return null;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id',               a.id,
        'label',            a.label,
        'address',          a.address,
        'delivery_zone_id', a.delivery_zone_id,
        'notes',            a.notes,
        'is_default',       a.is_default
      )
      order by a.is_default desc, a.updated_at desc
    ),
    '[]'::jsonb
  )
  into v_addresses
  from public.customer_addresses a
  where a.customer_phone = p_phone;

  return jsonb_build_object(
    'phone',        v_customer.phone,
    'name',         v_customer.name,
    'orders_count', v_customer.orders_count,
    'addresses',    v_addresses
  );
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- account_bind_device — a porta de entrada normal
-- ─────────────────────────────────────────────────────────────────────────────
-- Prova de posse: o UUID do pedido. Quem o tem fez o pedido — é o endereço
-- que lhe demos depois de pagar. Não serve para ver morada de mais ninguém:
-- o token que sai daqui só abre a conta do telefone daquele pedido.
create or replace function public.account_bind_device(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order record;
  v_token text;
begin
  select o.customer_phone, o.customer_name, o.address, o.delivery_zone_id, o.fulfillment_type
    into v_order
  from public.orders o
  where o.id = p_order_id;

  if v_order.customer_phone is null then
    -- Pedido inexistente ou sem telefone (balcão). Não distinguimos os dois
    -- casos na resposta: dizer "esse pedido não existe" é dizer quais existem.
    return null;
  end if;

  insert into public.customers (phone, name)
  values (v_order.customer_phone, v_order.customer_name)
  on conflict (phone) do update
    set last_seen_at = now(),
        name = coalesce(public.customers.name, excluded.name);

  -- Primeira morada do cliente vem do pedido que acabou de fazer: se pediu
  -- entrega, já lá está — e nunca mais a escreve.
  if v_order.fulfillment_type = 'delivery'
     and coalesce(btrim(v_order.address), '') <> ''
     and not exists (
       select 1 from public.customer_addresses a
       where a.customer_phone = v_order.customer_phone
         and lower(btrim(a.address)) = lower(btrim(v_order.address))
     )
  then
    insert into public.customer_addresses (customer_phone, label, address, delivery_zone_id, is_default)
    values (
      v_order.customer_phone,
      'Casa',
      btrim(v_order.address),
      v_order.delivery_zone_id,
      not exists (
        select 1 from public.customer_addresses a2
        where a2.customer_phone = v_order.customer_phone and a2.is_default
      )
    );
  end if;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');

  insert into public.customer_devices (customer_phone, token_hash)
  values (v_order.customer_phone, private.secret_hash(v_token));

  return jsonb_build_object(
    'token',   v_token,
    'profile', private.customer_profile(v_order.customer_phone)
  );
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- account_me / logout
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.account_me(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone text := private.customer_by_token(p_token);
begin
  if v_phone is null then return null; end if;
  return private.customer_profile(v_phone);
end;
$$;

create or replace function public.account_logout(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.customer_devices
     set revoked_at = now()
   where token_hash = private.secret_hash(p_token)
     and revoked_at is null;
  return jsonb_build_object('ok', true);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Moradas
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.account_save_address(
  p_token    text,
  p_id       uuid default null,
  p_label    text default 'Casa',
  p_address  text default '',
  p_zone_id  uuid default null,
  p_notes    text default '',
  p_default  boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone   text := private.customer_by_token(p_token);
  v_label   text := btrim(coalesce(p_label, ''));
  v_address text := btrim(coalesce(p_address, ''));
  v_count   int;
  v_id      uuid;
begin
  if v_phone is null then
    raise exception 'not_identified' using errcode = 'P0020';
  end if;
  if v_address = '' then
    raise exception 'address_required' using errcode = 'P0007';
  end if;
  if v_label = '' then v_label := 'Morada'; end if;
  if length(v_label) > 40 then v_label := left(v_label, 40); end if;
  if length(v_address) > 300 then
    raise exception 'address_too_long' using errcode = 'P0007';
  end if;

  -- Tecto por cliente: uma lista de moradas é para escolher de relance, não
  -- para percorrer. Oito chega para casa, trabalho e a família toda.
  select count(*) into v_count
  from public.customer_addresses
  where customer_phone = v_phone;

  if p_id is null and v_count >= 8 then
    raise exception 'address_limit' using errcode = 'P0007';
  end if;

  if p_default then
    update public.customer_addresses
       set is_default = false, updated_at = now()
     where customer_phone = v_phone and is_default;
  end if;

  if p_id is null then
    insert into public.customer_addresses (
      customer_phone, label, address, delivery_zone_id, notes, is_default
    ) values (
      v_phone, v_label, v_address, p_zone_id, btrim(coalesce(p_notes, '')),
      p_default or v_count = 0
    )
    returning id into v_id;
  else
    update public.customer_addresses
       set label            = v_label,
           address          = v_address,
           delivery_zone_id = p_zone_id,
           notes            = btrim(coalesce(p_notes, '')),
           is_default       = p_default or is_default,
           updated_at       = now()
     where id = p_id
       and customer_phone = v_phone   -- nunca se edita a morada de outro
    returning id into v_id;

    if v_id is null then
      raise exception 'address_not_found' using errcode = 'P0007';
    end if;
  end if;

  return private.customer_profile(v_phone);
end;
$$;

create or replace function public.account_delete_address(p_token text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone text := private.customer_by_token(p_token);
begin
  if v_phone is null then
    raise exception 'not_identified' using errcode = 'P0020';
  end if;

  delete from public.customer_addresses
   where id = p_id and customer_phone = v_phone;

  -- Se ficou sem morada por defeito, a mais recente assume.
  update public.customer_addresses
     set is_default = true
   where id = (
     select a.id from public.customer_addresses a
     where a.customer_phone = v_phone
     order by a.updated_at desc
     limit 1
   )
   and not exists (
     select 1 from public.customer_addresses d
     where d.customer_phone = v_phone and d.is_default
   );

  return private.customer_profile(v_phone);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Telemóvel novo: código de uso único
-- ─────────────────────────────────────────────────────────────────────────────
-- Só o servidor chama estas duas (service_role). O código nunca chega ao
-- browser por outra via que não o canal de entrega.

create or replace function public.account_request_code(p_phone text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone text := nullif(btrim(p_phone), '');
  v_code  text;
  v_email text;
begin
  if v_phone is null then
    raise exception 'phone_required' using errcode = 'P0007';
  end if;

  -- Cliente desconhecido: devolve-se o mesmo que a um conhecido sem email.
  -- A resposta não pode dizer quem é cliente da casa e quem não é.
  if not exists (select 1 from public.customers c where c.phone = v_phone) then
    return jsonb_build_object('channel', 'none');
  end if;

  -- Email mais recente que o cliente deixou num pedido.
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
  v_phone text := nullif(btrim(p_phone), '');
  v_row   record;
  v_token text;
begin
  select * into v_row
  from public.customer_login_codes
  where phone = v_phone;

  if v_row.phone is null or v_row.expires_at < now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;

  -- Cinco tentativas por código. Seis dígitos com tentativas ilimitadas é um
  -- cadeado aberto.
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

-- ─────────────────────────────────────────────────────────────────────────────
-- Grants
-- ─────────────────────────────────────────────────────────────────────────────

revoke all on function private.secret_hash(text)        from public, anon, authenticated;
revoke all on function private.customer_by_token(text)  from public, anon, authenticated;
revoke all on function private.customer_profile(text)   from public, anon, authenticated;

revoke all on function public.account_bind_device(uuid) from public;
revoke all on function public.account_me(text)          from public;
revoke all on function public.account_logout(text)      from public;
revoke all on function public.account_save_address(text, uuid, text, text, uuid, text, boolean) from public;
revoke all on function public.account_delete_address(text, uuid) from public;
revoke all on function public.account_request_code(text) from public, anon, authenticated;
revoke all on function public.account_verify_code(text, text) from public, anon, authenticated;

-- As rotas do servidor falam com service_role; nada disto precisa de estar
-- aberto ao browser, e o token viaja em cookie httpOnly que o browser nem lê.
grant execute on function public.account_bind_device(uuid) to service_role;
grant execute on function public.account_me(text)          to service_role;
grant execute on function public.account_logout(text)      to service_role;
grant execute on function public.account_save_address(text, uuid, text, text, uuid, text, boolean) to service_role;
grant execute on function public.account_delete_address(text, uuid) to service_role;
grant execute on function public.account_request_code(text) to service_role;
grant execute on function public.account_verify_code(text, text) to service_role;
