-- Corrige o helper da F1: PostgreSQL não define min(uuid).
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

  select (array_agg(ss.store_id))[1]
  into v_store_id
  from public.staff_stores ss
  join public.staff_profiles sp on sp.user_id = ss.user_id
  where ss.user_id = (select auth.uid())
    and sp.active
  having count(*) = 1;

  return v_store_id;
end;
$$;

revoke execute on function private.auth_default_store_id()
  from public, anon, authenticated;
