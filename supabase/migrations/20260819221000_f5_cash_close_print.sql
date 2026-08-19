-- F5: o fecho cria papel no balcão sem fazer a impressão bloquear a transacção.

create or replace function private.enqueue_cash_close_print()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store_short_name text;
  v_closed_by_name text;
begin
  if old.closed_at is not null or new.closed_at is null then
    return new;
  end if;

  begin
    select s.short_name into v_store_short_name
    from public.stores s where s.id = new.store_id;

    select sp.full_name into v_closed_by_name
    from public.staff_profiles sp where sp.user_id = new.closed_by;

    insert into public.print_jobs (
      store_id, order_id, request_id, station, kind, reprint_seq, payload
    ) values (
      new.store_id,
      null,
      new.id,
      'counter',
      'cash_close',
      0,
      new.report || jsonb_build_object(
        'template', 'cash_close',
        'store_short_name', coalesce(v_store_short_name, 'Loja'),
        'closed_by_name', v_closed_by_name
      )
    )
    on conflict (store_id, request_id, station, kind)
      where request_id is not null
      do nothing;
  exception when others then
    -- Best-effort: uma falha de papel nunca reverte o fecho financeiro.
    begin
      insert into public.event_log (store_id, actor_user_id, type, payload)
      values (
        new.store_id,
        new.closed_by,
        'cash.close_print_failed',
        jsonb_build_object('session_id', new.id, 'error', sqlstate)
      );
    exception when others then
      null;
    end;
  end;

  return new;
end;
$$;

revoke execute on function private.enqueue_cash_close_print()
  from public, anon, authenticated;

drop trigger if exists cash_sessions_enqueue_close_print on public.cash_sessions;
create trigger cash_sessions_enqueue_close_print
after update of closed_at on public.cash_sessions
for each row
when (old.closed_at is null and new.closed_at is not null)
execute function private.enqueue_cash_close_print();
