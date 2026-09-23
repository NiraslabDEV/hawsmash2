-- 1071: o número de vias do talão, pela aba POS.
--
-- `stores.kitchen_ticket_copies` (1062) decide quantas vias do talão completo
-- saem por pedido: 1 = uma via sem rótulo; 2 = controlo + cliente; 3 = mais a
-- via da cozinha. Até aqui só mudava por SQL. Passa a mudar-se na aba POS,
-- junto com o modelo de cada via (store_pos_settings.config.printing, 1067).
--
-- Dono e gerente da loja: é operação da loja (§6), como o resto da aba POS. O
-- update directo de `stores` continua só do dono (RLS) — por isso uma RPC com
-- as mesmas regras de `save_pos_settings`, e registo em `event_log`.
--
-- Vale para os pedidos seguintes: a base de dados lê o valor quando cria os
-- trabalhos de impressão, sem precisar do mini-PC. Portável. Idempotente.

create or replace function public.set_store_ticket_copies(p_store_id uuid, p_copies integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_role text;
  v_before smallint;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0020';
  end if;

  v_role := private.auth_role();
  if v_role is null or v_role not in ('owner', 'manager') or not private.auth_can_store(p_store_id) then
    raise exception 'pos_settings_denied' using errcode = 'P0403';
  end if;

  if p_copies is null or p_copies < 1 or p_copies > 3 then
    raise exception 'ticket_copies_invalid' using errcode = 'P0400';
  end if;

  select s.kitchen_ticket_copies into v_before from public.stores s where s.id = p_store_id;
  if not found then
    raise exception 'store_not_found' using errcode = 'P0404';
  end if;

  update public.stores set kitchen_ticket_copies = p_copies where id = p_store_id;

  if v_before is distinct from p_copies then
    insert into public.event_log (store_id, actor_user_id, type, payload)
    values (
      p_store_id,
      v_uid,
      'store.ticket_copies_changed',
      jsonb_build_object('from', v_before, 'to', p_copies)
    );
  end if;

  return jsonb_build_object('store_id', p_store_id, 'ticket_copies', p_copies);
end;
$$;

revoke all on function public.set_store_ticket_copies(uuid, integer) from public, anon;
grant execute on function public.set_store_ticket_copies(uuid, integer) to authenticated;
