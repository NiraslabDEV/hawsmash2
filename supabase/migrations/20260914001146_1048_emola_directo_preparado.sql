-- 1048: preparar e-Mola directo Movitel, independente do M-Pesa e do Paysuite.
-- Sem contrato técnico/credenciais: nenhum endpoint ou segredo é inventado.
-- Não muda configurações existentes. O dono escolhe 'emola' (pendente) ou
-- 'emola_sim' (ensaio sem dinheiro); o gateway legado continua compatível.
alter table public.stores drop constraint if exists stores_emola_provider_check;
alter table public.stores add constraint stores_emola_provider_check
  check (emola_provider is null or emola_provider in ('manual', 'mock', 'paysuite', 'emola', 'emola_sim'));

create or replace function private.payment_mode(p_provider text, p_emola_provider text, p_method text)
returns text language sql immutable security invoker set search_path = '' as $$
  select case
    when p_method = 'emola' then case when coalesce(p_emola_provider, p_provider) in ('paysuite', 'mock', 'emola', 'emola_sim')
      then coalesce(p_emola_provider, p_provider) else 'manual' end
    when p_method = 'mpesa' and p_provider in ('mpesa', 'mpesa_sim') then p_provider
    when p_method in ('mpesa', 'credit_card') and p_provider in ('paysuite', 'mock') then p_provider
    else 'manual' end;
$$;

create or replace function public.save_store_payment(p_store_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_provider text;
  v_emola_provider text;
  v_existing public.stores%rowtype;
  v_mudou text[] := '{}';
  v_chave text;
begin
  if not coalesce((select private.auth_is_owner()), false) then
    raise exception 'forbidden' using errcode = 'P0403';
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'invalid_payload' using errcode = 'P0400';
  end if;

  if jsonb_exists(p_payload, 'payment_provider') then
    v_provider := btrim(coalesce(p_payload ->> 'payment_provider', ''));
    if v_provider not in ('manual', 'mock', 'paysuite', 'mpesa', 'mpesa_sim') then
      raise exception 'invalid_payment_provider' using errcode = 'P0400';
    end if;
  end if;

  select s.* into v_existing from public.stores s where s.id = p_store_id for update;
  if not found then raise exception 'store_not_found' using errcode = 'P0002'; end if;

  if jsonb_exists(p_payload, 'emola_provider') then
    v_emola_provider := nullif(btrim(p_payload ->> 'emola_provider'), '');
    if v_emola_provider is not null and v_emola_provider not in ('manual', 'mock', 'paysuite', 'emola', 'emola_sim') then
      raise exception 'invalid_emola_provider' using errcode = 'P0400';
    end if;
  else
    v_emola_provider := v_existing.emola_provider;
  end if;

  -- Uma tentativa iniciada continua a ser consultada na mesma conta/provider.
  -- Corrigir credenciais é permitido; trocar gateways espera pelo fecho da fila.
  if (coalesce(v_provider, v_existing.payment_provider) is distinct from v_existing.payment_provider
      or v_emola_provider is distinct from v_existing.emola_provider)
    and exists (select 1 from public.orders o where o.store_id = p_store_id
      and o.flow = 'digital' and o.status in ('awaiting_payment', 'payment_failed')) then
    raise exception 'pending_payments_provider_change' using errcode = 'P0409';
  end if;

  update public.stores s
  set
    payment_provider = coalesce(v_provider, s.payment_provider),
    emola_provider = v_emola_provider,
    paysuite_api_key = case when jsonb_exists(p_payload, 'paysuite_api_key')
      then nullif(btrim(p_payload ->> 'paysuite_api_key'), '') else s.paysuite_api_key end,
    paysuite_webhook_secret = case when jsonb_exists(p_payload, 'paysuite_webhook_secret')
      then nullif(btrim(p_payload ->> 'paysuite_webhook_secret'), '') else s.paysuite_webhook_secret end,
    mpesa_api_key = case when jsonb_exists(p_payload, 'mpesa_api_key')
      then nullif(btrim(p_payload ->> 'mpesa_api_key'), '') else s.mpesa_api_key end,
    mpesa_public_key = case when jsonb_exists(p_payload, 'mpesa_public_key')
      then nullif(btrim(p_payload ->> 'mpesa_public_key'), '') else s.mpesa_public_key end,
    mpesa_service_provider_code = case when jsonb_exists(p_payload, 'mpesa_service_provider_code')
      then nullif(btrim(p_payload ->> 'mpesa_service_provider_code'), '') else s.mpesa_service_provider_code end,
    mpesa_session_base_url = case when jsonb_exists(p_payload, 'mpesa_session_base_url')
      then nullif(btrim(p_payload ->> 'mpesa_session_base_url'), '') else s.mpesa_session_base_url end,
    mpesa_charge_base_url = case when jsonb_exists(p_payload, 'mpesa_charge_base_url')
      then nullif(btrim(p_payload ->> 'mpesa_charge_base_url'), '') else s.mpesa_charge_base_url end,
    mpesa_query_base_url = case when jsonb_exists(p_payload, 'mpesa_query_base_url')
      then nullif(btrim(p_payload ->> 'mpesa_query_base_url'), '') else s.mpesa_query_base_url end,
    mpesa_number = case when jsonb_exists(p_payload, 'mpesa_number')
      then nullif(btrim(p_payload ->> 'mpesa_number'), '') else s.mpesa_number end,
    emola_number = case when jsonb_exists(p_payload, 'emola_number')
      then nullif(btrim(p_payload ->> 'emola_number'), '') else s.emola_number end
  where s.id = p_store_id;

  if not found then
    raise exception 'store_not_found' using errcode = 'P0002';
  end if;

  -- O registo diz **que campos** mudaram. Nunca o que lá foi escrito: um
  -- event_log com uma chave de API dentro é a mesma fuga, noutro sítio.
  for v_chave in select jsonb_object_keys(p_payload) loop
    v_mudou := array_append(v_mudou, v_chave);
  end loop;

  insert into public.event_log (store_id, actor_user_id, type, payload)
  values (
    p_store_id,
    (select auth.uid()),
    'store.payment_changed',
    jsonb_build_object('campos', to_jsonb(v_mudou))
  );

  return public.get_store_payment_status(p_store_id);
end;
$$;

create or replace function public.create_order(
  p_store_slug text,
  p_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store_id uuid;
  v_provider text;
  v_emola_provider text;
  v_scheduled_for timestamptz;
  v_local_scheduled timestamp;
  v_slot_minutes integer;
  v_order_id uuid;
  v_checkout_id uuid;
  v_request_hash text;
  v_existing record;
begin
  select s.id, s.payment_provider, s.emola_provider
  into v_store_id, v_provider, v_emola_provider
  from public.stores s
  where s.slug = p_store_slug
    and s.active
  for update;

  if not found then
    raise exception 'store_not_found' using errcode = 'P0404';
  end if;

  if p_payload ->> 'flow' = 'digital' then
    if coalesce(p_payload ->> 'clientCheckoutId', '') = '' then
      raise exception 'client_checkout_id_required' using errcode = 'P0400';
    end if;
    begin
      v_checkout_id := (p_payload ->> 'clientCheckoutId')::uuid;
    exception when invalid_text_representation then
      raise exception 'invalid_client_checkout_id' using errcode = 'P0400';
    end;
    v_request_hash := encode(sha256(convert_to((p_payload - 'clientCheckoutId')::text, 'UTF8')), 'hex');

    -- O lock da loja acima serializa criação/retry e também a mudança de gateway.
    -- Repetir uma tentativa mantém o pedido original, mesmo depois de o horário
    -- ou o catálogo mudarem. Nunca recalcular/cobrar uma segunda encomenda aqui.
    select o.id, o.checkout_request_hash, o.payment_method into v_existing
    from public.orders o where o.store_id = v_store_id and o.client_checkout_id = v_checkout_id;
    if found then
      if v_existing.checkout_request_hash is distinct from v_request_hash
        or v_existing.payment_method is distinct from (p_payload ->> 'paymentMethod') then
        raise exception 'checkout_payload_mismatch' using errcode = 'P0409';
      end if;
      return v_existing.id;
    end if;
  end if;

  -- DECISÃO: o contrato directo Movitel ainda não foi fornecido. Mesmo pela
  -- RPC pública não se abre uma encomenda digital real impossível de cobrar.
  -- O simulador fica disponível; a retomada idempotente acima é preservada.
  if p_payload ->> 'flow' = 'digital' and
    private.payment_mode(v_provider, v_emola_provider, p_payload ->> 'paymentMethod') = 'emola' then
    raise exception 'emola_direct_contract_unavailable' using errcode = 'P0400';
  end if;

  -- A API e a RPC pública usam a mesma matriz por método. Um payload não activa gateways.
  if p_payload ->> 'flow' = 'digital' and
    private.payment_mode(v_provider, v_emola_provider, p_payload ->> 'paymentMethod') = 'manual' then
    raise exception 'digital_payment_method_unavailable' using errcode = 'P0400';
  end if;

  if nullif(p_payload ->> 'scheduledFor', '') is not null then
    v_scheduled_for := (p_payload ->> 'scheduledFor')::timestamptz;

    if v_scheduled_for <= now() then
      raise exception 'scheduled_for_must_be_future' using errcode = 'P0010';
    end if;

    v_local_scheduled := v_scheduled_for at time zone 'Africa/Maputo';

    select s.slot_minutes
    into v_slot_minutes
    from public.settings s
    where s.id = 1;

    if extract(minute from v_local_scheduled)::integer % v_slot_minutes <> 0 then
      raise exception 'scheduled_for_invalid_slot' using errcode = 'P0012';
    end if;

    if not exists (
      select 1
      from public.store_hours h
      where h.store_id = v_store_id
        and h.active
        and h.dow = extract(dow from v_local_scheduled)::integer
        and v_local_scheduled::time >= h.opens
        and v_local_scheduled::time < h.closes
    ) then
      raise exception 'scheduled_for_outside_hours' using errcode = 'P0011';
    end if;
  end if;

  -- A validação global antiga não pode voltar a contradizer o horário da loja.
  v_order_id := private.create_order_store_legacy(
    p_store_slug,
    p_payload - 'scheduledFor'
  );

  if v_scheduled_for is not null then
    update public.orders
    set scheduled_for = v_scheduled_for
    where id = v_order_id;
  end if;

  if v_checkout_id is not null then
    update public.orders set client_checkout_id = v_checkout_id, checkout_request_hash = v_request_hash
    where id = v_order_id and store_id = v_store_id;
  end if;

  return v_order_id;
end;
$$;
revoke all on function private.payment_mode(text,text,text) from public, anon, authenticated;
revoke all on function public.save_store_payment(uuid,jsonb) from public, anon;
grant execute on function public.save_store_payment(uuid,jsonb) to authenticated, service_role;
revoke all on function public.create_order(text,jsonb) from public;
grant execute on function public.create_order(text,jsonb) to anon, authenticated, service_role;
