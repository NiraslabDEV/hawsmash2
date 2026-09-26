-- HAWSMASH 2.0 — 1098: repetir uma sangria não a conta duas vezes.
--
-- Auditoria de 26/09 (V-13), provada numa BD local antes de corrigir:
-- `add_cash_movement` inseria sempre uma linha nova. Se a resposta se perdia
-- (rede do balcão) e o operador tocava outra vez em "Registar", a mesma sangria
-- ficava duas vezes e o esperado em caixa descia duas vezes — a diferença
-- aparecia no fecho, sem explicação (CLAUDE §1 regra 4).
--
-- Agora o POS e o painel mandam uma chave por movimento (`p_request_id`), como
-- já fazem no fecho do dia (1091). A mesma chave devolve o mesmo movimento; a
-- mesma chave com outro tipo ou valor é recusada (`request_id_reused`). Sem
-- chave, funciona como antes — um POS antigo em cache não parte.

alter table public.cash_movements add column if not exists request_id uuid;

create unique index if not exists cash_movements_store_request_uidx
  on public.cash_movements (store_id, request_id)
  where request_id is not null;

drop function if exists public.add_cash_movement(uuid, text, integer, text);

create or replace function public.add_cash_movement(
  p_store uuid,
  p_type text,
  p_amount_cents integer,
  p_reason text,
  p_request_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_role text;
  v_session_id uuid;
  v_movement_id uuid;
  v_existing record;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0020';
  end if;

  v_role := private.auth_role();
  if v_role is null or v_role not in ('owner', 'manager', 'cashier') then
    raise exception 'cash_access_denied' using errcode = 'P0403';
  end if;
  if p_store is null or not private.auth_can_store(p_store) then
    raise exception 'store_access_denied' using errcode = 'P0403';
  end if;
  if p_type is null or p_type not in ('sangria', 'reforco', 'despesa', 'troco_inicial') then
    raise exception 'invalid_cash_movement_type' using errcode = 'P0007';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'invalid_cash_movement_amount' using errcode = 'P0007';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'cash_movement_reason_required' using errcode = 'P0007';
  end if;

  -- Repetição: devolve o que já ficou gravado, mesmo que o turno já tenha fechado.
  if p_request_id is not null then
    select cm.id, cm.type, cm.amount_cents into v_existing
    from public.cash_movements cm
    where cm.store_id = p_store and cm.request_id = p_request_id;
    if found then
      if v_existing.type <> p_type or v_existing.amount_cents <> p_amount_cents then
        raise exception 'request_id_reused' using errcode = 'P0409';
      end if;
      return v_existing.id;
    end if;
  end if;

  select cs.id into v_session_id
  from public.cash_sessions cs
  where cs.store_id = p_store and cs.closed_at is null
  for update;
  if v_session_id is null then
    raise exception 'no_open_session' using errcode = 'P0032';
  end if;

  insert into public.cash_movements (
    session_id, store_id, type, amount_cents, reason, created_by, request_id
  ) values (
    v_session_id, p_store, p_type, p_amount_cents, btrim(p_reason), v_uid, p_request_id
  )
  on conflict (store_id, request_id) where request_id is not null do nothing
  returning id into v_movement_id;

  if v_movement_id is null then
    -- Corrida entre duas repetições: a outra gravou primeiro.
    select cm.id, cm.type, cm.amount_cents into v_existing
    from public.cash_movements cm
    where cm.store_id = p_store and cm.request_id = p_request_id;
    if v_existing.type <> p_type or v_existing.amount_cents <> p_amount_cents then
      raise exception 'request_id_reused' using errcode = 'P0409';
    end if;
    return v_existing.id;
  end if;

  insert into public.event_log (store_id, actor_user_id, type, payload)
  values (
    p_store,
    v_uid,
    'cash.movement_added',
    jsonb_build_object(
      'session_id', v_session_id,
      'movement_id', v_movement_id,
      'movement_type', p_type,
      'amount_cents', p_amount_cents,
      'reason', btrim(p_reason)
    )
  );

  return v_movement_id;
end;
$$;

revoke all on function public.add_cash_movement(uuid, text, integer, text, uuid)
  from public, anon;
grant execute on function public.add_cash_movement(uuid, text, integer, text, uuid)
  to authenticated, service_role;
