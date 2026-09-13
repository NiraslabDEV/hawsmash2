-- 1047: idempotência do checkout online mesmo quando a resposta HTTP se perde.
-- A chave é do browser, o hash e o preço são do servidor. Não altera pedidos antigos.
alter table public.orders
  add column if not exists client_checkout_id uuid,
  add column if not exists checkout_request_hash text,
  add column if not exists checkout_started_at timestamptz,
  add column if not exists checkout_url text;

alter table public.orders drop constraint if exists orders_checkout_identity_check;
alter table public.orders add constraint orders_checkout_identity_check check (
  (client_checkout_id is null and checkout_request_hash is null) or
  (client_checkout_id is not null and checkout_request_hash is not null
    and checkout_request_hash ~ '^[a-f0-9]{64}$' and flow = 'digital')
);
create unique index if not exists orders_store_checkout_id_key
  on public.orders (store_id, client_checkout_id) where client_checkout_id is not null;

-- SELECT de tabela herdado exporia futuras colunas. Preservar apenas a leitura
-- das colunas que já existiam: o cliente não recebe hash, chave ou URL do checkout.
revoke select on public.orders from public, anon, authenticated;
grant select (
  id, order_number, status, flow, fulfillment_type, delivery_zone_id, address,
  customer_name, customer_phone, customer_email, scheduled_for, subtotal_cents,
  delivery_fee_cents, total_cents, payment_method, payment_proof_path, notes,
  created_at, updated_at, payment_provider_ref, referral_code, discount_cents,
  gift_item_id, table_id, store_id, client_sale_id, daily_number, cash_received_cents,
  change_cents, needs_review, channel, offline_total_cents, payment_reference, payment_ref_seq
) on public.orders to authenticated;
revoke select (client_checkout_id, checkout_request_hash, checkout_started_at, checkout_url)
  on public.orders from public, anon, authenticated;

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
revoke all on function public.create_order(text,jsonb) from public;
grant execute on function public.create_order(text,jsonb) to anon, authenticated, service_role;

-- Claim único e durável, anterior a qualquer chamada ao fornecedor.
-- DECISÃO: uma iniciação incerta não expira nem é reclamada automaticamente:
-- a recuperação consulta/confere a tentativa original sem iniciar outra cobrança.
create or replace function public.claim_online_checkout(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_order record;
begin
  if not coalesce((select auth.jwt() ->> 'role') = 'service_role', false) then
    raise exception 'checkout_claim_denied' using errcode = 'P0403';
  end if;
  select o.store_id, o.flow, o.status, o.client_checkout_id, o.checkout_started_at, o.checkout_url
  into v_order from public.orders o where o.id = p_order_id for update;
  if not found then raise exception 'order_not_found' using errcode = 'P0404'; end if;

  if v_order.checkout_started_at is not null or v_order.flow is distinct from 'digital'
    or v_order.status is distinct from 'awaiting_payment' or v_order.client_checkout_id is null then
    return jsonb_build_object('claimed', false, 'checkoutUrl', v_order.checkout_url,
      'status', v_order.status);
  end if;

  update public.orders set checkout_started_at = now()
  where id = p_order_id and store_id = v_order.store_id and checkout_started_at is null;
  return jsonb_build_object('claimed', true, 'checkoutUrl', null, 'status', v_order.status);
end;
$$;
revoke all on function public.claim_online_checkout(uuid) from public, anon, authenticated;
grant execute on function public.claim_online_checkout(uuid) to service_role;
