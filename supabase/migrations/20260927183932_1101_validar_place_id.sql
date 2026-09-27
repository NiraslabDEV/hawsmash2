-- 1101: PostgreSQL limita repetidores de regex a 255; {10,512} falhava em runtime.
-- Mantém exactamente os limites da 1096, separando comprimento e alfabeto.
alter table public.stores drop constraint if exists stores_google_place_id_format;
alter table public.stores add constraint stores_google_place_id_format
  check (google_place_id is null or
    (length(google_place_id) between 10 and 512 and google_place_id ~ '^[A-Za-z0-9_-]+$'));
create or replace function public.set_store_google_place(p_store_id uuid, p_place_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_place text := nullif(btrim(coalesce(p_place_id, '')), '');
  v_previous text;
begin
  perform private.assert_staff_admin();

  if v_place is not null and (length(v_place) not between 10 and 512 or v_place !~ '^[A-Za-z0-9_-]+$') then
    raise exception 'invalid_google_place_id' using errcode = 'P0007';
  end if;

  select s.google_place_id into v_previous
  from public.stores s
  where s.id = p_store_id
  for update;
  if not found then
    raise exception 'store_not_found' using errcode = 'P0404';
  end if;

  update public.stores s set google_place_id = v_place where s.id = p_store_id;

  insert into public.event_log (store_id, actor_user_id, type, payload)
  values (
    p_store_id,
    v_uid,
    'store.updated',
    jsonb_build_object(
      'fields', jsonb_build_array('google_place_id'),
      'google_place_id', v_place,
      'previous', v_previous
    )
  );

  return jsonb_build_object('store_id', p_store_id, 'google_place_id', v_place);
end;
$$;

revoke all on function public.set_store_google_place(uuid, text) from public, anon;
grant execute on function public.set_store_google_place(uuid, text) to authenticated;
