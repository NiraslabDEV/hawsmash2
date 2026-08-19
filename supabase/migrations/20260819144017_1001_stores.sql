-- HAWSMASH 2.0 — F1 / 1001: unidades físicas, horários e contadores.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.request_store_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select nullif(current_setting('app.request_store_id', true), '')::uuid;
$$;

revoke execute on function private.request_store_id() from public, anon, authenticated;

create table if not exists public.stores (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text not null,
  short_name text not null,
  order_prefix text unique not null check (order_prefix ~ '^[A-Z]{2,5}$'),
  active boolean not null default true,
  accepting_orders boolean not null default false,
  address text,
  maps_url text,
  phone text,
  owner_email text,
  delivery_enabled boolean not null default true,
  pickup_enabled boolean not null default true,
  counter_enabled boolean not null default true,
  mpesa_number text,
  mpesa_name text,
  emola_number text,
  emola_name text,
  payment_provider text not null default 'manual'
    check (payment_provider in ('manual', 'mock', 'paysuite')),
  paysuite_api_key text,
  paysuite_webhook_secret text,
  receipt_header text,
  receipt_footer text,
  sort integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.store_hours (
  store_id uuid not null references public.stores(id) on delete cascade,
  dow smallint not null check (dow between 0 and 6),
  opens time not null,
  closes time not null,
  active boolean not null default true,
  primary key (store_id, dow),
  check (opens <> closes)
);

create table if not exists public.order_counters (
  store_id uuid not null references public.stores(id) on delete cascade,
  day date not null,
  seq integer not null default 0 check (seq >= 0),
  primary key (store_id, day)
);

alter table public.stores enable row level security;
alter table public.store_hours enable row level security;
alter table public.order_counters enable row level security;

revoke all on public.stores, public.store_hours, public.order_counters
  from public, anon, authenticated;
grant select, insert, update on public.stores, public.store_hours to authenticated;
grant select, insert, update, delete on public.stores, public.store_hours, public.order_counters
  to service_role;

-- Identidades estruturais e estáveis. Dados comerciais entram no seed quando
-- confirmados; ambas começam fechadas para não aceitar pedidos por engano.
insert into public.stores (
  id, slug, name, short_name, order_prefix, accepting_orders, sort
) values
  ('00000000-0000-4000-8000-000000000101', 'maputo', 'HAWSMASH Maputo', 'Maputo', 'MPT', false, 1),
  ('00000000-0000-4000-8000-000000000102', 'matola', 'HAWSMASH Matola', 'Matola', 'MTL', false, 2)
on conflict (slug) do update set
  name = excluded.name,
  short_name = excluded.short_name,
  order_prefix = excluded.order_prefix,
  sort = excluded.sort;
