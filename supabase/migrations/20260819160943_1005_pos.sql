-- HAWSMASH 2.0 — F2 / 1005: dados necessários ao POS de balcão.

alter table public.orders
  add column if not exists client_sale_id uuid,
  add column if not exists daily_number integer,
  add column if not exists cash_received_cents integer,
  add column if not exists change_cents integer,
  add column if not exists needs_review boolean not null default false,
  add column if not exists channel text;

update public.orders
set channel = case fulfillment_type
  when 'delivery' then 'delivery'
  else 'pickup'
end
where channel is null;

alter table public.orders
  alter column channel set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'orders_client_sale_id_key'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_client_sale_id_key unique (client_sale_id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'orders_daily_number_check'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_daily_number_check
      check (daily_number is null or daily_number > 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'orders_cash_received_cents_check'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_cash_received_cents_check
      check (cash_received_cents is null or cash_received_cents >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'orders_change_cents_check'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_change_cents_check
      check (
        (cash_received_cents is null and change_cents is null)
        or (
          cash_received_cents is not null
          and change_cents is not null
          and change_cents >= 0
          and change_cents <= cash_received_cents
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'orders_channel_check'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_channel_check
      check (channel in ('delivery', 'pickup', 'counter', 'dine_in'));
  end if;
end $$;

create or replace function private.set_order_channel()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.channel is null then
    new.channel := case new.fulfillment_type
      when 'delivery' then 'delivery'
      else 'pickup'
    end;
  end if;
  return new;
end;
$$;

revoke execute on function private.set_order_channel()
  from public, anon, authenticated;

drop trigger if exists orders_set_channel on public.orders;
create trigger orders_set_channel
before insert on public.orders
for each row execute function private.set_order_channel();

create index if not exists orders_store_daily_number_idx
  on public.orders (store_id, daily_number)
  where daily_number is not null;
create index if not exists orders_store_needs_review_idx
  on public.orders (store_id, created_at desc)
  where needs_review;

create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  kind text not null check (kind in ('pos', 'bridge', 'kds', 'tv')),
  label text not null check (length(btrim(label)) > 0),
  device_key_hash text not null unique,
  app_version text,
  active boolean not null default true,
  locked_at timestamptz,
  last_seen_at timestamptz,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists devices_store_kind_idx
  on public.devices (store_id, kind, active);
create index if not exists devices_last_seen_at_idx
  on public.devices (last_seen_at desc);

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function private.touch_updated_at()
  from public, anon, authenticated;

drop trigger if exists devices_touch_updated_at on public.devices;
create trigger devices_touch_updated_at
before update on public.devices
for each row execute function private.touch_updated_at();

alter table public.devices enable row level security;

revoke all on public.devices from public, anon, authenticated;
grant select (
  id, store_id, kind, label, app_version, active, locked_at,
  last_seen_at, created_by, created_at, updated_at
) on public.devices to authenticated;
grant insert (
  store_id, kind, label, device_key_hash, app_version, created_by
) on public.devices to authenticated;
grant update (
  label, app_version, active, locked_at, last_seen_at
) on public.devices to authenticated;
grant select, insert, update, delete on public.devices to service_role;

drop policy if exists devices_store_select on public.devices;
create policy devices_store_select on public.devices
for select to authenticated
using ((select private.auth_can_store(store_id)));

drop policy if exists devices_manager_insert on public.devices;
create policy devices_manager_insert on public.devices
for insert to authenticated
with check (
  (select private.auth_can_store(store_id))
  and (select private.auth_role()) in ('owner', 'manager')
);

drop policy if exists devices_manager_update on public.devices;
create policy devices_manager_update on public.devices
for update to authenticated
using (
  (select private.auth_can_store(store_id))
  and (select private.auth_role()) in ('owner', 'manager')
)
with check (
  (select private.auth_can_store(store_id))
  and (select private.auth_role()) in ('owner', 'manager')
);
