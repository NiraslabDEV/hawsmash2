-- HAWSMASH 2.0 — F1 / 1002: store_id nas linhas operacionais existentes.

alter table public.orders add column if not exists store_id uuid;
alter table public.order_items add column if not exists store_id uuid;
alter table public.payments add column if not exists store_id uuid;
alter table public.print_jobs add column if not exists store_id uuid;
alter table public.delivery_zones add column if not exists store_id uuid;
alter table public.cash_sessions add column if not exists store_id uuid;
alter table public.analytics_events add column if not exists store_id uuid;

update public.orders
set store_id = '00000000-0000-4000-8000-000000000101'
where store_id is null;

update public.order_items oi
set store_id = o.store_id
from public.orders o
where oi.order_id = o.id
  and oi.store_id is null;

update public.payments p
set store_id = o.store_id
from public.orders o
where p.order_id = o.id
  and p.store_id is null;

update public.print_jobs pj
set store_id = o.store_id
from public.orders o
where pj.order_id = o.id
  and pj.store_id is null;

update public.delivery_zones
set store_id = '00000000-0000-4000-8000-000000000101'
where store_id is null;

update public.cash_sessions
set store_id = '00000000-0000-4000-8000-000000000101'
where store_id is null;

alter table public.orders alter column store_id set not null;
alter table public.order_items alter column store_id set not null;
alter table public.payments alter column store_id set not null;
alter table public.print_jobs alter column store_id set not null;
alter table public.delivery_zones alter column store_id set not null;
alter table public.cash_sessions alter column store_id set not null;

alter table public.orders
  alter column store_id set default private.request_store_id();
alter table public.order_items
  alter column store_id set default private.request_store_id();
alter table public.payments
  alter column store_id set default private.request_store_id();
alter table public.print_jobs
  alter column store_id set default private.request_store_id();
alter table public.cash_sessions
  alter column store_id set default private.request_store_id();

do $$
declare
  v_table text;
  v_constraint text;
begin
  foreach v_table in array array[
    'orders', 'order_items', 'payments', 'print_jobs',
    'delivery_zones', 'cash_sessions', 'analytics_events'
  ]
  loop
    v_constraint := v_table || '_store_id_fkey';
    if not exists (
      select 1
      from pg_constraint
      where conname = v_constraint
        and conrelid = format('public.%I', v_table)::regclass
    ) then
      execute format(
        'alter table public.%I add constraint %I foreign key (store_id) references public.stores(id) on delete restrict',
        v_table,
        v_constraint
      );
    end if;
  end loop;
end $$;

create or replace function private.enforce_order_store_id()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store_id uuid;
begin
  if new.order_id is null then
    if new.store_id is null then
      new.store_id := private.request_store_id();
    end if;
    return new;
  end if;

  select o.store_id
  into v_store_id
  from public.orders o
  where o.id = new.order_id;

  if v_store_id is null then
    raise exception 'order_not_found' using errcode = 'P0002';
  end if;

  if new.store_id is not null and new.store_id <> v_store_id then
    raise exception 'store_mismatch' using errcode = 'P0401';
  end if;

  new.store_id := v_store_id;
  return new;
end;
$$;

revoke execute on function private.enforce_order_store_id() from public, anon, authenticated;

drop trigger if exists order_items_enforce_store_id on public.order_items;
create trigger order_items_enforce_store_id
before insert or update of order_id, store_id on public.order_items
for each row execute function private.enforce_order_store_id();

drop trigger if exists payments_enforce_store_id on public.payments;
create trigger payments_enforce_store_id
before insert or update of order_id, store_id on public.payments
for each row execute function private.enforce_order_store_id();

drop trigger if exists print_jobs_enforce_store_id on public.print_jobs;
create trigger print_jobs_enforce_store_id
before insert or update of order_id, store_id on public.print_jobs
for each row execute function private.enforce_order_store_id();

create index if not exists orders_store_created_at_idx
  on public.orders (store_id, created_at desc);
create index if not exists orders_store_status_created_at_idx
  on public.orders (store_id, status, created_at desc);
create index if not exists order_items_store_id_idx
  on public.order_items (store_id);
create index if not exists payments_store_id_idx
  on public.payments (store_id);
create index if not exists print_jobs_store_status_created_at_idx
  on public.print_jobs (store_id, status, created_at);
create index if not exists delivery_zones_store_sort_idx
  on public.delivery_zones (store_id, sort);
create index if not exists cash_sessions_store_opened_at_idx
  on public.cash_sessions (store_id, opened_at desc);
create index if not exists analytics_events_store_created_at_idx
  on public.analytics_events (store_id, created_at desc)
  where store_id is not null;
