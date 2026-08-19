-- HAWSMASH 2.0 — F8: auditoria de empresa (equipa) sem loja associada.

-- ---------------------------------------------------------------------------
-- Eventos de empresa (equipa) não pertencem a nenhuma loja.
--
-- Até aqui todo o event_log exigia loja — o que é certo para operação, mas
-- impossível para "o dono mudou o perfil de alguém". A partir daqui um evento
-- sem loja é um evento da empresa: só o dono o escreve e só o dono o lê.
-- ---------------------------------------------------------------------------
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

  -- Sem loja só o dono (ou uma rotina interna) escreve: assim um evento de
  -- operação nunca fica invisível para o gerente da loja onde aconteceu.
  if new.store_id is null
    and not coalesce(private.auth_is_owner(), false)
    and (select auth.uid()) is not null
  then
    raise exception 'store_required' using errcode = 'P0400';
  end if;

  new.actor_user_id := coalesce(new.actor_user_id, (select auth.uid()));
  return new;
end;
$$;

revoke execute on function private.enforce_event_context() from public, anon, authenticated;

drop policy if exists event_log_store_select on public.event_log;
create policy event_log_store_select on public.event_log
for select to authenticated
using (
  case
    when store_id is null then (select private.auth_is_owner())
    else (select private.auth_can_store(store_id))
  end
);
