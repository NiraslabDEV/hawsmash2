-- HAWSMASH 2.0 — 1061: marcar um produto como esgotado a partir do balcão.
--
-- A carne acaba a meio do turno. Quem está ao balcão tem de tirar o produto do
-- cardápio naquele momento — senão o site continua a vender o que a cozinha já
-- não consegue fazer, e o cliente paga por uma coisa que não vai receber.
--
-- Até aqui, a disponibilidade só mudava sozinha (stock a zero, §10) ou por
-- SQL. O painel de stock é do gerente (`assert_stock_manager`: owner/manager),
-- e bem: mexe em quantidades, contagens e quebras.
--
-- Esta função é deliberadamente MAIS ESTREITA do que o painel de stock, e é
-- por isso que o caixa a pode usar: só liga e desliga `store_items.available`.
-- O caixa pode dizer "acabou"; não pode dizer "temos 40". Decisão do dono
-- (23 Set): dono, gerente e caixa marcam; a cozinha não.
--
-- Regras:
--   · cada loja só mexe no seu cardápio (`auth_can_store`, regra 3);
--   · fica rasto com autor e perfil em `event_log` (§6) — é o que responde
--     "quem tirou o Double do site às 19h?";
--   · marcar o que já está marcado não faz nada e não regista: um duplo toque
--     num ecrã táctil não pode encher o registo de ruído;
--   · marcar disponível não passa por cima do stock: um item com stock
--     controlado e a zero continua esgotado no `get_menu`, como deve.

create or replace function public.set_item_availability(
  p_store_id uuid,
  p_menu_item_id uuid,
  p_available boolean,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_role text;
  v_antes boolean;
  v_motivo text := nullif(left(btrim(coalesce(p_reason, '')), 200), '');
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0020';
  end if;

  v_role := private.auth_role();
  if v_role is null or v_role not in ('owner', 'manager', 'cashier') then
    raise exception 'availability_access_denied' using errcode = 'P0403';
  end if;

  if not private.auth_can_store(p_store_id) then
    raise exception 'availability_access_denied' using errcode = 'P0403';
  end if;

  if p_available is null then
    raise exception 'available_required' using errcode = 'P0007';
  end if;

  select si.available
  into v_antes
  from public.store_items si
  where si.store_id = p_store_id
    and si.menu_item_id = p_menu_item_id
  for update;

  if not found then
    raise exception 'store_item_not_found' using errcode = 'P0404';
  end if;

  if v_antes is distinct from p_available then
    update public.store_items si
    set available = p_available
    where si.store_id = p_store_id
      and si.menu_item_id = p_menu_item_id;

    insert into public.event_log (store_id, actor_user_id, type, payload)
    values (
      p_store_id,
      v_uid,
      'stock.availability_changed',
      jsonb_build_object(
        'menu_item_id', p_menu_item_id,
        'available', p_available,
        'reason', v_motivo,
        'role', v_role
      )
    );
  end if;

  return jsonb_build_object(
    'menu_item_id', p_menu_item_id,
    'available', p_available,
    'changed', v_antes is distinct from p_available
  );
end;
$$;

revoke all on function public.set_item_availability(uuid, uuid, boolean, text)
  from public, anon;
grant execute on function public.set_item_availability(uuid, uuid, boolean, text)
  to authenticated;
