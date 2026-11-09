-- Pedido feito dentro da conversa do WhatsApp, pago por comprovativo (ADR 0012). DO RESTAURANTE:
-- como a 1118, não vai para o Gym OS.
--
-- O pedido nasce no MESMO create_order do site: preço, stock, promoções, horário e zona são do servidor
-- (regra 2). O que muda é quem confirma: a pessoa, com o botão "Confirmar" na conversa, e o telefone
-- vem do próprio WhatsApp. O pagamento é o manual de sempre: M-Pesa/e-Mola para o número da loja e
-- comprovativo — que aqui chega como foto na conversa e o caixa confere no POS.

-- ── Idempotência: um "Confirmar" = um pedido ────────────────────────────────
create table if not exists public.whatsapp_checkouts (
  checkout_id uuid primary key,
  store_id uuid not null references public.stores(id),
  phone text not null check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  order_id uuid references public.orders(id),
  created_at timestamptz not null default now()
);
create index if not exists whatsapp_checkouts_phone_idx on public.whatsapp_checkouts (store_id, phone, created_at desc);

alter table public.whatsapp_checkouts enable row level security;
revoke all on public.whatsapp_checkouts from public, anon, authenticated;
grant select on public.whatsapp_checkouts to authenticated;
grant all on public.whatsapp_checkouts to service_role;
drop policy if exists whatsapp_checkouts_owner_read on public.whatsapp_checkouts;
create policy whatsapp_checkouts_owner_read on public.whatsapp_checkouts for select to authenticated
  using ((select private.auth_is_owner()) and (select private.auth_can_store(store_id)));

-- ── Criar o pedido ──────────────────────────────────────────────────────────
-- Repetir com o mesmo checkout_id devolve o mesmo pedido (toque duplo, webhook repetido, cron).
-- Um erro do create_order (esgotado, loja fechada…) desfaz o claim: a pessoa pode corrigir e confirmar.
create or replace function public.whatsapp_create_order(
  p_store_id uuid, p_phone text, p_checkout_id uuid, p_payload jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_store public.stores;
  v_claim public.whatsapp_checkouts;
  v_method text := p_payload ->> 'paymentMethod';
  v_payload jsonb;
  v_order_id uuid;
  v_order public.orders;
begin
  if p_phone is null or p_phone !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'invalid_phone' using errcode = 'P0400'; end if;
  if p_checkout_id is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'invalid_payload' using errcode = 'P0400'; end if;
  select * into v_store from public.stores where id = p_store_id;
  if v_store.id is null or not v_store.whatsapp_chat_enabled then
    raise exception 'whatsapp_chat_disabled' using errcode = 'P0403';
  end if;

  insert into public.whatsapp_checkouts (checkout_id, store_id, phone) values (p_checkout_id, p_store_id, p_phone)
  on conflict (checkout_id) do nothing;
  if not found then
    select * into v_claim from public.whatsapp_checkouts where checkout_id = p_checkout_id;
    if v_claim.store_id <> p_store_id or v_claim.phone <> p_phone then
      raise exception 'checkout_mismatch' using errcode = 'P0409';
    end if;
    select * into v_order from public.orders where id = v_claim.order_id;
    if v_order.id is null then raise exception 'checkout_in_progress' using errcode = 'P0409'; end if;
    return jsonb_build_object('order_id', v_order.id, 'order_number', v_order.order_number,
      'total_cents', v_order.total_cents, 'payment_method', v_order.payment_method, 'status', v_order.status, 'created', false);
  end if;

  if v_method not in ('mpesa', 'emola') then raise exception 'invalid_payment_method' using errcode = 'P0400'; end if;
  -- Na conversa só há pagamento por comprovativo. Loja com pagamento automático → o bot manda para o site.
  if private.payment_mode(v_store.payment_provider, v_store.emola_provider, v_method) <> 'manual' then
    raise exception 'payment_not_manual' using errcode = 'P0400';
  end if;
  if coalesce(p_payload ->> 'fulfillmentType', '') not in ('delivery', 'pickup') then
    raise exception 'invalid_fulfillment' using errcode = 'P0400';
  end if;

  -- O servidor fixa o que não é escolha do cliente: loja, telefone (o do WhatsApp) e fluxo manual.
  v_payload := (p_payload - 'flow' - 'clientCheckoutId' - 'expectedTotalCents' - 'tableId' - 'referralCode' - 'msisdn')
    || jsonb_build_object('storeSlug', v_store.slug, 'customerPhone', p_phone);
  v_order_id := public.create_order(v_store.slug, v_payload);

  update public.whatsapp_checkouts set order_id = v_order_id where checkout_id = p_checkout_id;

  -- Origem no funil (1066/1121). Marketing: se falhar, o pedido fica na mesma.
  begin
    perform public.record_order_attribution(v_order_id, jsonb_build_object(
      'first_touch', null,
      'last_touch', jsonb_build_object('ch', 'whatsapp', 's', 'whatsapp', 'm', 'chat'),
      'channel', 'whatsapp', 'source', 'whatsapp', 'medium', 'chat',
      'campaign', null, 'content', null, 'term', null, 'referrer_host', null,
      'landing_path', null, 'click_ids', '{}'::jsonb));
  exception when others then
    raise warning 'whatsapp_attribution_failed: %', sqlstate;
  end;

  select * into v_order from public.orders where id = v_order_id;
  insert into public.event_log (store_id, order_id, type, payload)
  values (p_store_id, v_order_id, 'whatsapp.order_created', jsonb_build_object('checkout_id', p_checkout_id));
  return jsonb_build_object('order_id', v_order.id, 'order_number', v_order.order_number,
    'total_cents', v_order.total_cents, 'payment_method', v_order.payment_method, 'status', v_order.status, 'created', true);
end $$;
revoke all on function public.whatsapp_create_order(uuid, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.whatsapp_create_order(uuid, text, uuid, jsonb) to service_role;

-- ── O pedido à espera de comprovativo deste telefone ────────────────────────
-- Serve também quem encomendou no SITE e manda o comprovativo pelo WhatsApp: o telefone do pedido,
-- normalizado, tem de ser o número que está a escrever. O mais recente das últimas 12 h.
create or replace function public.whatsapp_pending_order(p_store_id uuid, p_phone text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('order_id', o.id, 'order_number', o.order_number, 'total_cents', o.total_cents,
                            'payment_method', o.payment_method)
    from public.orders o
   where o.store_id = p_store_id
     and o.status = 'awaiting_approval'
     and o.payment_proof_path is null
     and o.created_at > now() - interval '12 hours'
     and (o.customer_phone = p_phone or private.whatsapp_phone_mz(o.customer_phone) = p_phone)
   order by o.created_at desc
   limit 1;
$$;
revoke all on function public.whatsapp_pending_order(uuid, text) from public, anon, authenticated;
grant execute on function public.whatsapp_pending_order(uuid, text) to service_role;

-- ── Comprovativo pela conversa ──────────────────────────────────────────────
-- O mesmo attach_payment_proof do site (só o primeiro, só à espera de aprovação), com a garantia
-- de que o pedido é desta loja e deste telefone.
create or replace function public.whatsapp_attach_proof(p_store_id uuid, p_phone text, p_order_id uuid, p_path text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_result jsonb;
begin
  if not exists (
    select 1 from public.orders o
     where o.id = p_order_id and o.store_id = p_store_id
       and (o.customer_phone = p_phone or private.whatsapp_phone_mz(o.customer_phone) = p_phone)
  ) then
    raise exception 'order_not_yours' using errcode = 'P0403';
  end if;
  -- O caminho tem de ser deste pedido no bucket privado (nunca outro ficheiro qualquer).
  if p_path is null or p_path !~ ('^' || p_order_id::text || '/whatsapp-[A-Za-z0-9_-]{1,80}\.(jpg|png|webp|pdf)$') then
    raise exception 'invalid_proof_path' using errcode = 'P0020';
  end if;
  v_result := public.attach_payment_proof(p_order_id, p_path);
  insert into public.event_log (store_id, order_id, type, payload)
  values (p_store_id, p_order_id, 'whatsapp.proof_received', jsonb_build_object('path', p_path));
  return v_result;
end $$;
revoke all on function public.whatsapp_attach_proof(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.whatsapp_attach_proof(uuid, text, uuid, text) to service_role;

notify pgrst, 'reload schema';
