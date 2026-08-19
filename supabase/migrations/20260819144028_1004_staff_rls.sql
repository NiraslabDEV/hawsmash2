-- HAWSMASH 2.0 — F1 / 1004: equipa, helpers privados e RLS por loja.

create table if not exists public.staff_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role text not null check (role in ('owner', 'manager', 'cashier', 'kitchen')),
  pin_hash text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.staff_stores (
  user_id uuid not null references auth.users(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  primary key (user_id, store_id)
);

create index if not exists staff_stores_store_id_idx
  on public.staff_stores (store_id);

alter table public.staff_profiles enable row level security;
alter table public.staff_stores enable row level security;

revoke all on public.staff_profiles, public.staff_stores from public, anon, authenticated;
grant select, insert, update on public.staff_profiles, public.staff_stores to authenticated;
grant select, insert, update, delete on public.staff_profiles, public.staff_stores to service_role;

create or replace function private.auth_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select sp.role
  from public.staff_profiles sp
  where sp.user_id = (select auth.uid())
    and sp.active
    and (select auth.uid()) is not null;
$$;

create or replace function private.auth_is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.auth_role() = 'owner', false);
$$;

create or replace function private.auth_can_store(p_store uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when (select auth.uid()) is null then false
    when private.auth_is_owner() then true
    else exists (
      select 1
      from public.staff_stores ss
      join public.staff_profiles sp on sp.user_id = ss.user_id
      where ss.user_id = (select auth.uid())
        and ss.store_id = p_store
        and sp.active
    )
  end;
$$;

create or replace function private.auth_default_store_id()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_requested uuid := private.request_store_id();
  v_store_id uuid;
begin
  if v_requested is not null then
    return v_requested;
  end if;

  select min(ss.store_id)
  into v_store_id
  from public.staff_stores ss
  join public.staff_profiles sp on sp.user_id = ss.user_id
  where ss.user_id = (select auth.uid())
    and sp.active
  having count(*) = 1;

  return v_store_id;
end;
$$;

revoke execute on function private.auth_role() from public, anon, authenticated;
revoke execute on function private.auth_is_owner() from public, anon, authenticated;
revoke execute on function private.auth_can_store(uuid) from public, anon, authenticated;
revoke execute on function private.auth_default_store_id() from public, anon, authenticated;

-- As policies são avaliadas com os privilégios do chamador e precisam de
-- EXECUTE nos helpers. O schema continua fora da Data API, logo não cria RPCs
-- públicas directas.
grant usage on schema private to authenticated;
grant execute on function private.auth_role() to authenticated;
grant execute on function private.auth_is_owner() to authenticated;
grant execute on function private.auth_can_store(uuid) to authenticated;

alter table public.cash_sessions
  alter column store_id set default private.auth_default_store_id();

alter table public.event_log add column if not exists store_id uuid;
alter table public.event_log add column if not exists actor_user_id uuid;

update public.event_log e
set store_id = coalesce(
  (select o.store_id from public.orders o where o.id = e.order_id),
  '00000000-0000-4000-8000-000000000101'::uuid
)
where e.store_id is null;

alter table public.event_log alter column store_id set not null;
alter table public.event_log
  alter column store_id set default private.auth_default_store_id();
alter table public.event_log
  alter column actor_user_id set default auth.uid();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'event_log_store_id_fkey'
      and conrelid = 'public.event_log'::regclass
  ) then
    alter table public.event_log
      add constraint event_log_store_id_fkey
      foreign key (store_id) references public.stores(id) on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'event_log_actor_user_id_fkey'
      and conrelid = 'public.event_log'::regclass
  ) then
    alter table public.event_log
      add constraint event_log_actor_user_id_fkey
      foreign key (actor_user_id) references auth.users(id) on delete set null;
  end if;
end $$;

create index if not exists event_log_store_created_at_idx
  on public.event_log (store_id, created_at desc);
create index if not exists event_log_actor_user_id_idx
  on public.event_log (actor_user_id)
  where actor_user_id is not null;

create or replace function private.enforce_event_context()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_store_id uuid;
begin
  if new.order_id is not null then
    select o.store_id into v_order_store_id
    from public.orders o
    where o.id = new.order_id;

    if v_order_store_id is null then
      raise exception 'order_not_found' using errcode = 'P0002';
    end if;

    if new.store_id is not null and new.store_id <> v_order_store_id then
      raise exception 'store_mismatch' using errcode = 'P0401';
    end if;
    new.store_id := v_order_store_id;
  elsif new.store_id is null then
    new.store_id := private.auth_default_store_id();
  end if;

  if new.store_id is null then
    raise exception 'store_required' using errcode = 'P0400';
  end if;

  new.actor_user_id := coalesce(new.actor_user_id, (select auth.uid()));
  return new;
end;
$$;

revoke execute on function private.enforce_event_context() from public, anon, authenticated;

drop trigger if exists event_log_enforce_context on public.event_log;
create trigger event_log_enforce_context
before insert or update of order_id, store_id, actor_user_id on public.event_log
for each row execute function private.enforce_event_context();

-- Elimina todas as policies permissivas herdadas com este nome.
do $$
declare
  v_policy record;
begin
  for v_policy in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and policyname = 'staff_all'
  loop
    execute format(
      'drop policy if exists %I on %I.%I',
      v_policy.policyname,
      v_policy.schemaname,
      v_policy.tablename
    );
  end loop;
end $$;

drop policy if exists staff_select on public.event_log;
drop policy if exists staff_select on public.analytics_events;

-- O rate limiting é manipulado apenas pelas RPCs SECURITY DEFINER; o cliente
-- nunca escreve directamente nesta tabela.
drop policy if exists rate_limits_anon_insert on public.rate_limits;

-- Grants definem que objectos cada role alcança; as policies abaixo definem
-- que linhas ficam visíveis. Não depender dos defaults variáveis da plataforma.
revoke all on all tables in schema public from public, anon;
revoke all on all sequences in schema public from public, anon, authenticated;

grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select, update on all sequences in schema public to service_role;

grant select on public.stores, public.store_hours, public.order_counters,
  public.orders, public.order_items, public.payments, public.print_jobs,
  public.cash_sessions, public.event_log, public.analytics_events,
  public.delivery_zones, public.store_items,
  public.menu_categories, public.menu_items, public.menu_item_variants,
  public.menu_addons, public.menu_modifier_groups, public.menu_modifier_options,
  public.settings, public.waitlist, public.customers, public.referral_codes,
  public.referral_redemptions, public.device_heartbeats, public.tables,
  public.order_feedback, public.staff_profiles, public.staff_stores
to authenticated;

grant insert, update on public.delivery_zones, public.store_items,
  public.menu_categories, public.menu_items, public.menu_item_variants,
  public.menu_addons, public.menu_modifier_groups, public.menu_modifier_options,
  public.settings, public.waitlist, public.customers, public.referral_codes,
  public.device_heartbeats, public.tables, public.staff_profiles, public.staff_stores
to authenticated;

-- Equipa.
create policy staff_profiles_self_select on public.staff_profiles
for select to authenticated
using ((select auth.uid()) = user_id or (select private.auth_is_owner()));

create policy staff_profiles_owner_insert on public.staff_profiles
for insert to authenticated
with check ((select private.auth_is_owner()));

create policy staff_profiles_owner_update on public.staff_profiles
for update to authenticated
using ((select private.auth_is_owner()))
with check ((select private.auth_is_owner()));

create policy staff_profiles_owner_delete on public.staff_profiles
for delete to authenticated
using ((select private.auth_is_owner()));

create policy staff_stores_self_select on public.staff_stores
for select to authenticated
using ((select auth.uid()) = user_id or (select private.auth_is_owner()));

create policy staff_stores_owner_insert on public.staff_stores
for insert to authenticated
with check ((select private.auth_is_owner()));

create policy staff_stores_owner_update on public.staff_stores
for update to authenticated
using ((select private.auth_is_owner()))
with check ((select private.auth_is_owner()));

create policy staff_stores_owner_delete on public.staff_stores
for delete to authenticated
using ((select private.auth_is_owner()));

-- Lojas e configuração operacional.
create policy stores_staff_select on public.stores
for select to authenticated
using ((select private.auth_can_store(id)));

create policy stores_owner_insert on public.stores
for insert to authenticated
with check ((select private.auth_is_owner()));

create policy stores_owner_update on public.stores
for update to authenticated
using ((select private.auth_is_owner()))
with check ((select private.auth_is_owner()));

create policy stores_owner_delete on public.stores
for delete to authenticated
using ((select private.auth_is_owner()));

create policy store_hours_staff_select on public.store_hours
for select to authenticated
using ((select private.auth_can_store(store_id)));

create policy store_hours_manager_insert on public.store_hours
for insert to authenticated
with check (
  (select private.auth_can_store(store_id))
  and (select private.auth_role()) in ('owner', 'manager')
);

create policy store_hours_manager_update on public.store_hours
for update to authenticated
using (
  (select private.auth_can_store(store_id))
  and (select private.auth_role()) in ('owner', 'manager')
)
with check (
  (select private.auth_can_store(store_id))
  and (select private.auth_role()) in ('owner', 'manager')
);

create policy store_hours_manager_delete on public.store_hours
for delete to authenticated
using (
  (select private.auth_can_store(store_id))
  and (select private.auth_role()) in ('owner', 'manager')
);

create policy order_counters_staff_select on public.order_counters
for select to authenticated
using ((select private.auth_can_store(store_id)));

-- Operação: leitura por loja; escritas sensíveis continuam apenas por RPC.
create policy orders_store_select on public.orders
for select to authenticated
using ((select private.auth_can_store(store_id)));

create policy order_items_store_select on public.order_items
for select to authenticated
using ((select private.auth_can_store(store_id)));

create policy payments_store_select on public.payments
for select to authenticated
using ((select private.auth_can_store(store_id)));

create policy print_jobs_store_select on public.print_jobs
for select to authenticated
using ((select private.auth_can_store(store_id)));

create policy cash_sessions_store_select on public.cash_sessions
for select to authenticated
using ((select private.auth_can_store(store_id)));

create policy event_log_store_select on public.event_log
for select to authenticated
using ((select private.auth_can_store(store_id)));

create policy analytics_events_store_select on public.analytics_events
for select to authenticated
using (
  (select private.auth_is_owner())
  or (store_id is not null and (select private.auth_can_store(store_id)))
);

create policy delivery_zones_store_select on public.delivery_zones
for select to authenticated
using ((select private.auth_can_store(store_id)));

create policy delivery_zones_manager_insert on public.delivery_zones
for insert to authenticated
with check (
  (select private.auth_can_store(store_id))
  and (select private.auth_role()) in ('owner', 'manager')
);

create policy delivery_zones_manager_update on public.delivery_zones
for update to authenticated
using (
  (select private.auth_can_store(store_id))
  and (select private.auth_role()) in ('owner', 'manager')
)
with check (
  (select private.auth_can_store(store_id))
  and (select private.auth_role()) in ('owner', 'manager')
);

create policy store_items_store_select on public.store_items
for select to authenticated
using ((select private.auth_can_store(store_id)));

create policy store_items_manager_insert on public.store_items
for insert to authenticated
with check (
  (select private.auth_can_store(store_id))
  and (select private.auth_role()) in ('owner', 'manager')
);

create policy store_items_manager_update on public.store_items
for update to authenticated
using (
  (select private.auth_can_store(store_id))
  and (select private.auth_role()) in ('owner', 'manager')
)
with check (
  (select private.auth_can_store(store_id))
  and (select private.auth_role()) in ('owner', 'manager')
);

-- Catálogo partilhado: todos os perfis activos lêem; owner/manager escrevem.
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'menu_categories', 'menu_items', 'menu_item_variants', 'menu_addons',
    'menu_modifier_groups', 'menu_modifier_options'
  ]
  loop
    execute format(
      'create policy catalog_staff_select on public.%I for select to authenticated using ((select private.auth_role()) is not null)',
      v_table
    );
    execute format(
      'create policy catalog_manager_insert on public.%I for insert to authenticated with check ((select private.auth_role()) in (''owner'', ''manager''))',
      v_table
    );
    execute format(
      'create policy catalog_manager_update on public.%I for update to authenticated using ((select private.auth_role()) in (''owner'', ''manager'')) with check ((select private.auth_role()) in (''owner'', ''manager''))',
      v_table
    );
    execute format(
      'create policy catalog_manager_delete on public.%I for delete to authenticated using ((select private.auth_role()) in (''owner'', ''manager''))',
      v_table
    );
  end loop;
end $$;

create policy settings_owner_access on public.settings
for all to authenticated
using ((select private.auth_is_owner()))
with check ((select private.auth_is_owner()));

-- Tabelas globais herdadas ficam deliberadamente owner-only até ganharem
-- store_id nas fases que as tornam operacionais.
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'waitlist', 'customers', 'referral_codes', 'device_heartbeats', 'tables'
  ]
  loop
    execute format(
      'create policy owner_only on public.%I for all to authenticated using ((select private.auth_is_owner())) with check ((select private.auth_is_owner()))',
      v_table
    );
  end loop;
end $$;

create policy order_feedback_store_access on public.order_feedback
for all to authenticated
using (exists (
  select 1 from public.orders o
  where o.id = order_feedback.order_id
    and (select private.auth_can_store(o.store_id))
))
with check (exists (
  select 1 from public.orders o
  where o.id = order_feedback.order_id
    and (select private.auth_can_store(o.store_id))
));

create policy referral_redemptions_store_access on public.referral_redemptions
for all to authenticated
using (exists (
  select 1 from public.orders o
  where o.id = referral_redemptions.order_id
    and (select private.auth_can_store(o.store_id))
))
with check (exists (
  select 1 from public.orders o
  where o.id = referral_redemptions.order_id
    and (select private.auth_can_store(o.store_id))
));

-- Os relatórios de leitura passam a SECURITY INVOKER: as próprias policies
-- filtram as linhas e evitam que uma RPC contorne o isolamento.
alter function public.get_orders(jsonb) security invoker;
alter function public.get_order_stats() security invoker;
alter function public.get_cash_dashboard() security invoker;
alter function public.get_dashboard_metrics(text) security invoker;
alter function public.get_funnel_metrics() security invoker;
alter function public.get_device_status() security invoker;
alter function public.admin_list_feedbacks(integer, integer) security invoker;
alter function public.admin_list_waitlist(integer, integer) security invoker;

-- RPCs de mutação herdadas mantêm SECURITY DEFINER, mas passam por uma
-- barreira explícita de loja antes de chegar à implementação antiga.
create or replace function private.can_access_order(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce((select auth.jwt() ->> 'role') = 'service_role', false)
    or exists (
      select 1
      from public.orders o
      where o.id = p_order_id
        and private.auth_can_store(o.store_id)
    );
$$;

revoke execute on function private.can_access_order(uuid) from public, anon, authenticated;

alter function public.advance_order(uuid, text, text) set schema private;
alter function private.advance_order(uuid, text, text) rename to advance_order_legacy;
revoke all on function private.advance_order_legacy(uuid, text, text)
  from public, anon, authenticated;

create or replace function public.advance_order(
  p_order_id uuid,
  p_event text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store_id uuid;
begin
  if not private.can_access_order(p_order_id) then
    raise exception 'store_access_denied' using errcode = 'P0403';
  end if;

  select o.store_id into v_store_id
  from public.orders o
  where o.id = p_order_id;
  perform set_config('app.request_store_id', v_store_id::text, true);

  return private.advance_order_legacy(p_order_id, p_event, p_reason);
end;
$$;

revoke all on function public.advance_order(uuid, text, text) from public, anon;
grant execute on function public.advance_order(uuid, text, text)
  to authenticated, service_role;

alter function public.confirm_payment(text, uuid, text, text, text, integer, jsonb)
  set schema private;
alter function private.confirm_payment(text, uuid, text, text, text, integer, jsonb)
  rename to confirm_payment_legacy;
revoke all on function private.confirm_payment_legacy(text, uuid, text, text, text, integer, jsonb)
  from public, anon, authenticated;

create or replace function public.confirm_payment(
  p_idempotency_key text,
  p_order_id uuid,
  p_provider text,
  p_provider_ref text,
  p_method text,
  p_amount_cents integer,
  p_raw_webhook jsonb default '{}'::jsonb
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store_id uuid;
begin
  if not private.can_access_order(p_order_id) then
    raise exception 'store_access_denied' using errcode = 'P0403';
  end if;

  select o.store_id into v_store_id
  from public.orders o
  where o.id = p_order_id;
  perform set_config('app.request_store_id', v_store_id::text, true);

  return private.confirm_payment_legacy(
    p_idempotency_key,
    p_order_id,
    p_provider,
    p_provider_ref,
    p_method,
    p_amount_cents,
    p_raw_webhook
  );
end;
$$;

revoke all on function public.confirm_payment(text, uuid, text, text, text, integer, jsonb)
  from public, anon;
grant execute on function public.confirm_payment(text, uuid, text, text, text, integer, jsonb)
  to authenticated, service_role;

-- Fechar RPCs herdadas que ainda operam sem contexto de loja. Cada uma volta a
-- ser exposta na fase que adapta o respectivo domínio (impressão, caixa ou
-- estoque). O service_role mantém acesso para tarefas internas controladas.
revoke all on function public.adjust_stock(uuid, integer, text, text)
  from public, anon, authenticated;
grant execute on function public.adjust_stock(uuid, integer, text, text)
  to service_role;

revoke all on function public.open_cash_session()
  from public, anon, authenticated;
grant execute on function public.open_cash_session()
  to service_role;

revoke all on function public.close_cash_session(integer, text)
  from public, anon, authenticated;
grant execute on function public.close_cash_session(integer, text)
  to service_role;

revoke all on function public.import_menu(jsonb)
  from public, anon, authenticated;
grant execute on function public.import_menu(jsonb)
  to service_role;

revoke all on function public.get_secret_settings()
  from public, anon, authenticated;
grant execute on function public.get_secret_settings()
  to service_role;

revoke all on function public.upsert_heartbeat(text, text)
  from public, anon, authenticated;
grant execute on function public.upsert_heartbeat(text, text)
  to service_role;

alter function public.trigger_set_available_on_stock() set search_path = '';
