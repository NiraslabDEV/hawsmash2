-- HAWSMASH 2.0 — 1113: módulo de descontos e promoções.
--
-- Porta para o 2.0 o mecanismo que a instância SLICE já tem a facturar,
-- adaptado a várias lojas (CLAUDE §5):
--
--   · **Promo 2x1** por loja — compre um, leve o segundo grátis. Produtos
--     elegíveis marcados um a um (`menu_items.bogo_eligible`). UMA unidade
--     grátis por pedido; paga-se a mais cara e sai grátis a SEGUNDA mais cara.
--     Por omissão o par tem de ser do mesmo produto (o stock fecha); a loja
--     pode aceitar quaisquer dois elegíveis. Corre nos dias da semana marcados,
--     contados pelo dia do TURNO (02:00 de sábado ainda é sexta, se a sexta
--     virar a noite), dentro de uma janela opcional de datas.
--   · **Entrega grátis** por loja a partir de um mínimo, contado DEPOIS dos
--     descontos — senão as promoções acumulavam.
--   · **Cupões** (`referral_codes`, herdados do motor): passam a poder valer só
--     numa loja e ganham o tipo `bogo`, que liberta o 2x1 a quem tem o código.
--     A % calcula-se DEPOIS do 2x1: não se dá desconto sobre o que já é grátis.
--
--   · **Balcão (POS)**: aceita cupões, o 2x1/entrega grátis das promoções
--     marcadas "também no balcão" e um desconto manual (só gerente/dono, com
--     motivo). Tudo recalculado pelo create_counter_sale ANTES de conferir o
--     pagamento — o POS só pré-visualiza.
--
-- Uma só conta para os dois canais: `private.compute_promotions` (espelho de
-- applyPromotions() em packages/core). Ordem: 2x1 → cupão → manual → entrega.
--
-- Onde entra no site: uma camada nova por baixo da idempotência do checkout
-- (1048), no mesmo andar da campanha (1060). Um retry com a mesma chave devolve
-- o pedido original sem voltar a passar por aqui — nunca há desconto em dobro.
-- No balcão: dentro do create_counter_sale_unlocked, depois do lock por
-- client_sale_id — a repetição devolve a venda original.
--
-- Como fica o dinheiro: `orders.discount_cents` continua a ser TODO o abatimento
-- aos produtos e `total = subtotal - discount + entrega`, como sempre.
-- Relatórios, caixa, fecho e talão continuam certos sem mudar nada. As colunas
-- novas só dizem DE ONDE veio cada parte:
--     bogo_discount_cents     — parte do discount_cents que é do 2x1
--     manual_discount_cents   — parte que é desconto manual do balcão
--     (cupão = discount - bogo - manual)
--     delivery_discount_cents — taxa de entrega perdoada (delivery_fee fica 0)
--
-- Mesas (conta da mesa no POS) ficam de fora: a conta fecha com pagamentos
-- próprios (close_table_bill). Pedidos QR de mesa seguem a regra do balcão.
--
-- Nada disto confia no cliente (CLAUDE §1 regra 2): o checkout só mostra uma
-- pré-visualização (packages/core/src/promotions.ts, espelho desta conta).

-- ---------------------------------------------------------------------------
-- 1. Colunas
-- ---------------------------------------------------------------------------
alter table public.menu_items
  add column if not exists bogo_eligible boolean not null default false;
comment on column public.menu_items.bogo_eligible is
  'Entra na promo 2x1 (compre um, leve o segundo grátis). A promo em si é por loja, em promotions.';

alter table public.orders
  add column if not exists bogo_discount_cents integer not null default 0
    check (bogo_discount_cents >= 0),
  add column if not exists bogo_free_item text,
  add column if not exists delivery_discount_cents integer not null default 0
    check (delivery_discount_cents >= 0),
  add column if not exists manual_discount_cents integer not null default 0
    check (manual_discount_cents >= 0),
  add column if not exists discount_reason text
    check (discount_reason is null or length(discount_reason) <= 200);
comment on column public.orders.manual_discount_cents is
  'Parte de discount_cents que é desconto manual do balcão (gerente/dono). Motivo em discount_reason.';
comment on column public.orders.bogo_discount_cents is
  'Parte de discount_cents que veio da promo 2x1. O cupão é discount_cents - bogo_discount_cents.';
comment on column public.orders.bogo_free_item is
  'Nome (snapshot) da unidade que saiu grátis pelo 2x1. null = sem 2x1.';
comment on column public.orders.delivery_discount_cents is
  'Taxa de entrega perdoada pela promo de entrega grátis. delivery_fee_cents já vem a 0.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'orders_bogo_within_discount') then
    alter table public.orders add constraint orders_bogo_within_discount
      check (bogo_discount_cents + manual_discount_cents <= discount_cents) not valid;
  end if;
end $$;

-- orders tem permissões por coluna (1047): sem isto o painel não as lê.
grant select (bogo_discount_cents, bogo_free_item, delivery_discount_cents,
  manual_discount_cents, discount_reason)
  on public.orders to authenticated;

-- Cupões: loja opcional + tipo 2x1 + regras que o formulário não pode furar.
alter table public.referral_codes
  add column if not exists store_id uuid references public.stores(id);
comment on column public.referral_codes.store_id is
  'Loja onde o cupão vale. null = todas as lojas.';

alter table public.referral_codes drop constraint if exists referral_codes_reward_type_check;
alter table public.referral_codes add constraint referral_codes_reward_type_check
  check (reward_type in ('discount_cents', 'discount_pct', 'free_item', 'bogo'));

do $$
begin
  -- NOT VALID: não se reescreve nem se recusa o que já existe no LIVE; vale
  -- para tudo o que se criar ou alterar daqui para a frente.
  if not exists (select 1 from pg_constraint where conname = 'referral_codes_code_format') then
    alter table public.referral_codes add constraint referral_codes_code_format
      check (code = upper(btrim(code)) and length(code) between 2 and 40) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'referral_codes_reward_value') then
    alter table public.referral_codes add constraint referral_codes_reward_value
      check (
        (reward_type = 'discount_pct' and reward_value between 1 and 100)
        or (reward_type = 'discount_cents' and reward_value > 0)
        or (reward_type = 'free_item' and gift_item_id is not null)
        or reward_type = 'bogo'
      ) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'referral_codes_max_redemptions') then
    alter table public.referral_codes add constraint referral_codes_max_redemptions
      check (max_redemptions >= 1) not valid;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Promoções automáticas, por loja
-- ---------------------------------------------------------------------------
create table if not exists public.promotions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id),
  kind text not null check (kind in ('bogo', 'free_delivery')),
  active boolean not null default false,
  -- A frase que o cliente lê na montra e no checkout.
  label text not null default '' check (length(label) <= 120),
  -- 0 = domingo. Vazio = nunca corre (uma promo nunca dá dinheiro por engano).
  weekdays smallint[] not null default '{0,1,2,3,4,5,6}'
    check (weekdays <@ array[0,1,2,3,4,5,6]::smallint[]),
  -- Só 2x1: o par tem de ser do mesmo produto?
  same_item_only boolean not null default true,
  -- Também no balcão (POS) e nos pedidos QR de mesa. Por omissão, só o site.
  include_counter boolean not null default false,
  -- Só entrega grátis: a partir de quanto (centavos, depois dos descontos).
  min_subtotal_cents integer check (min_subtotal_cents is null or min_subtotal_cents >= 0),
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  unique (store_id, kind),
  check (ends_at is null or starts_at is null or ends_at > starts_at),
  check (kind <> 'free_delivery' or not active or coalesce(min_subtotal_cents, 0) > 0)
);
comment on table public.promotions is
  'Promoções automáticas de cada loja (2x1, entrega grátis). Uma de cada tipo por loja. Aplicadas no create_order (1113).';

alter table public.promotions enable row level security;
revoke all on public.promotions from public, anon, authenticated;
grant select, insert, update, delete on public.promotions to authenticated;

drop policy if exists promotions_store_select on public.promotions;
create policy promotions_store_select on public.promotions for select to authenticated
  using ((select private.auth_can_store(store_id)));

-- Promoção mexe no preço: é do dono (§6), como a campanha (1060).
drop policy if exists promotions_owner_insert on public.promotions;
create policy promotions_owner_insert on public.promotions for insert to authenticated
  with check ((select private.auth_is_owner()) and (select private.auth_can_store(store_id)));
drop policy if exists promotions_owner_update on public.promotions;
create policy promotions_owner_update on public.promotions for update to authenticated
  using ((select private.auth_is_owner()) and (select private.auth_can_store(store_id)))
  with check ((select private.auth_is_owner()) and (select private.auth_can_store(store_id)));
drop policy if exists promotions_owner_delete on public.promotions;
create policy promotions_owner_delete on public.promotions for delete to authenticated
  using ((select private.auth_is_owner()) and (select private.auth_can_store(store_id)));

create or replace function private.touch_promotion()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  new.updated_by := (select auth.uid());
  return new;
end $$;
revoke all on function private.touch_promotion() from public, anon, authenticated;

drop trigger if exists promotions_touch on public.promotions;
create trigger promotions_touch before insert or update on public.promotions
  for each row execute function private.touch_promotion();

-- ---------------------------------------------------------------------------
-- 3. Auditoria — quem mexeu em cupões, promoções e produtos elegíveis
-- ---------------------------------------------------------------------------
create or replace function private.audit_promotion()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  r public.promotions;
begin
  r := case when tg_op = 'DELETE' then old else new end;
  insert into public.event_log (store_id, type, payload)
  values (r.store_id, 'promotion.saved', jsonb_build_object(
    'op', lower(tg_op), 'id', r.id, 'kind', r.kind, 'active', r.active, 'label', r.label,
    'weekdays', to_jsonb(r.weekdays), 'same_item_only', r.same_item_only, 'include_counter', r.include_counter,
    'min_subtotal_cents', r.min_subtotal_cents, 'starts_at', r.starts_at, 'ends_at', r.ends_at));
  return null;
end $$;
revoke all on function private.audit_promotion() from public, anon, authenticated;

drop trigger if exists promotions_audit on public.promotions;
create trigger promotions_audit after insert or update or delete on public.promotions
  for each row execute function private.audit_promotion();

create or replace function private.audit_referral_code()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  r public.referral_codes;
begin
  r := case when tg_op = 'DELETE' then old else new end;
  insert into public.event_log (store_id, type, payload)
  values (r.store_id, 'coupon.saved', jsonb_build_object(
    'op', lower(tg_op), 'id', r.id, 'code', r.code, 'reward_type', r.reward_type,
    'reward_value', r.reward_value, 'gift_item_id', r.gift_item_id, 'active', r.active,
    'max_redemptions', r.max_redemptions, 'expires_at', r.expires_at, 'store_id', r.store_id));
  return null;
end $$;
revoke all on function private.audit_referral_code() from public, anon, authenticated;

drop trigger if exists referral_codes_audit on public.referral_codes;
create trigger referral_codes_audit after insert or update or delete on public.referral_codes
  for each row execute function private.audit_referral_code();

create or replace function private.audit_bogo_eligible()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.event_log (type, payload)
  values ('promotion.item_eligibility', jsonb_build_object(
    'item_id', new.id, 'name', new.name, 'bogo_eligible', new.bogo_eligible));
  return null;
end $$;
revoke all on function private.audit_bogo_eligible() from public, anon, authenticated;

drop trigger if exists menu_items_audit_bogo on public.menu_items;
create trigger menu_items_audit_bogo after update of bogo_eligible on public.menu_items
  for each row when (old.bogo_eligible is distinct from new.bogo_eligible)
  execute function private.audit_bogo_eligible();

-- ---------------------------------------------------------------------------
-- 4. Quando é que uma promoção está a correr
-- ---------------------------------------------------------------------------

-- Dia da semana do TURNO — espelho de businessWeekday() em packages/core.
create or replace function private.store_business_dow(p_store uuid, p_at timestamptz)
returns integer language sql stable security definer set search_path = '' as $$
  with l as (select (p_at at time zone 'Africa/Maputo') as t)
  select case
    when exists (
      select 1 from public.store_hours h
      where h.store_id = p_store
        and h.active
        and h.dow = (extract(dow from l.t)::integer + 6) % 7
        and h.closes < h.opens
        and l.t::time < h.closes
    ) then (extract(dow from l.t)::integer + 6) % 7
    else extract(dow from l.t)::integer
  end
  from l;
$$;
revoke all on function private.store_business_dow(uuid, timestamptz) from public, anon, authenticated;

-- Espelho de isPromotionLive() em packages/core.
create or replace function private.promotion_is_live(p public.promotions, p_at timestamptz)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(
    p.active
    and (p.starts_at is null or p.starts_at <= p_at)
    and (p.ends_at is null or p.ends_at > p_at)
    and private.store_business_dow(p.store_id, p_at) = any (p.weekdays),
    false);
$$;
revoke all on function private.promotion_is_live(public.promotions, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. A conta — espelho de applyPromotions() em packages/core
-- ---------------------------------------------------------------------------
-- Pura (não escreve nada). Serve o site e o balcão.
--   p_lines    [{menu_item_id, name, unit_price_cents, qty}] — preços do servidor
--   p_coupon   {type, value, gift_item_id} já validado, ou null
--   p_bogo_on  a promo 2x1 corre para este canal neste instante
--   p_same     o par tem de ser do mesmo produto
--   p_free_min mínimo da entrega grátis que corre agora (null = não corre)
--   p_manual   {type: pct|cents, value} já autorizado, ou null
create or replace function private.compute_promotions(
  p_lines jsonb,
  p_fulfillment text,
  p_zone_fee integer,
  p_coupon jsonb,
  p_bogo_on boolean,
  p_same boolean,
  p_free_min integer,
  p_manual jsonb
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_subtotal integer;
  v_bogo_on boolean;
  v_bogo_cents integer := 0;
  v_bogo_item text;
  v_base integer;
  v_coupon integer := 0;
  v_base2 integer;
  v_manual integer := 0;
  v_discount integer;
  v_fee integer := coalesce(p_zone_fee, 0);
  v_fee_off integer := 0;
  v_type text := p_coupon ->> 'type';
  v_value integer := coalesce((p_coupon ->> 'value')::integer, 0);
begin
  select coalesce(sum((l ->> 'unit_price_cents')::integer * (l ->> 'qty')::integer), 0)
  into v_subtotal
  from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) l;

  -- 1. 2x1
  v_bogo_on := coalesce(p_bogo_on, false) or coalesce(v_type = 'bogo', false);
  if v_bogo_on then
    with units as (
      select (l ->> 'menu_item_id')::uuid as menu_item_id, l ->> 'name' as nome,
             (l ->> 'unit_price_cents')::integer as preco
      from jsonb_array_elements(p_lines) l
      join public.menu_items mi on mi.id = (l ->> 'menu_item_id')::uuid
      cross join lateral generate_series(1, (l ->> 'qty')::integer)
      where mi.bogo_eligible and not mi.is_gift and (l ->> 'unit_price_cents')::integer > 0
    ), ranked as (
      select nome, preco,
        row_number() over (
          partition by case when coalesce(p_same, true) then menu_item_id::text else '*' end
          order by preco desc, nome collate "C" asc
        ) as rn
      from units
    )
    select r.nome, r.preco into v_bogo_item, v_bogo_cents
    from ranked r where r.rn = 2
    order by r.preco desc, r.nome collate "C" asc
    limit 1;
    v_bogo_cents := coalesce(v_bogo_cents, 0);
    if v_bogo_cents = 0 then v_bogo_item := null; end if;
  end if;

  -- 2. Cupão, sobre o que sobra depois do 2x1
  v_base := greatest(0, v_subtotal - v_bogo_cents);
  if v_type = 'discount_pct' then
    v_coupon := ((v_base::bigint * v_value) / 100)::integer;
  elsif v_type = 'discount_cents' then
    v_coupon := least(v_value, v_base);
  elsif v_type = 'free_item' and p_coupon ->> 'gift_item_id' is not null then
    -- No balcão o produto está no carrinho a preço cheio: sai uma unidade.
    -- No site o brinde já entra a 0 e isto dá 0.
    select coalesce(max((l ->> 'unit_price_cents')::integer), 0) into v_coupon
    from jsonb_array_elements(p_lines) l
    join public.menu_items mi on mi.id = (l ->> 'menu_item_id')::uuid
    where l ->> 'menu_item_id' = p_coupon ->> 'gift_item_id'
      and (l ->> 'unit_price_cents')::integer > 0;
    v_coupon := least(v_coupon, v_base);
  end if;

  -- 3. Manual (balcão), sobre o que ainda falta
  v_base2 := v_base - v_coupon;
  if p_manual ->> 'type' = 'pct' then
    v_manual := ((v_base2::bigint * (p_manual ->> 'value')::integer) / 100)::integer;
  elsif p_manual ->> 'type' = 'cents' then
    v_manual := least((p_manual ->> 'value')::integer, v_base2);
  end if;
  v_discount := v_bogo_cents + v_coupon + v_manual;

  -- 4. Entrega grátis, sobre o que se paga pelos produtos
  if p_fulfillment = 'delivery' and v_fee > 0 and coalesce(p_free_min, 0) > 0
    and v_subtotal - v_discount >= p_free_min
  then
    v_fee_off := v_fee;
    v_fee := 0;
  end if;

  return jsonb_build_object(
    'subtotal_cents', v_subtotal,
    'bogo_discount_cents', v_bogo_cents,
    'bogo_free_item', v_bogo_item,
    'coupon_discount_cents', v_coupon,
    'manual_discount_cents', v_manual,
    'discount_cents', v_discount,
    'delivery_fee_cents', v_fee,
    'delivery_discount_cents', v_fee_off,
    'total_cents', greatest(0, v_subtotal - v_discount + v_fee));
end $$;
revoke all on function private.compute_promotions(jsonb, text, integer, jsonb, boolean, boolean, integer, jsonb)
  from public, anon, authenticated;

-- As promoções automáticas de uma loja para um canal, num instante.
create or replace function private.store_promotions_at(p_store uuid, p_at timestamptz, p_in_store boolean)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_bogo public.promotions;
  v_fd public.promotions;
begin
  select p.* into v_bogo from public.promotions p where p.store_id = p_store and p.kind = 'bogo';
  select p.* into v_fd from public.promotions p where p.store_id = p_store and p.kind = 'free_delivery';
  return jsonb_build_object(
    'bogo_on', private.promotion_is_live(v_bogo, p_at)
      and (not p_in_store or coalesce(v_bogo.include_counter, false)),
    'same_item_only', coalesce(v_bogo.same_item_only, true),
    'free_min', case when private.promotion_is_live(v_fd, p_at)
      and (not p_in_store or coalesce(v_fd.include_counter, false))
      then v_fd.min_subtotal_cents end);
end $$;
revoke all on function private.store_promotions_at(uuid, timestamptz, boolean) from public, anon, authenticated;

-- Site: recalcula a partir das linhas gravadas. Idempotente — a taxa de
-- partida é delivery_fee + a já perdoada, e o desconto recalcula-se do zero.
create or replace function private.apply_order_promotions(p_order_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_order record;
  v_coupon jsonb;
  v_lines jsonb;
  v_rules jsonb;
  v_r jsonb;
  v_coupon_cents integer;
begin
  select o.id, o.store_id, o.channel, o.fulfillment_type, o.referral_code, o.created_at,
         o.delivery_fee_cents + o.delivery_discount_cents as zone_fee
  into v_order
  from public.orders o
  where o.id = p_order_id
  for update;
  if not found then return; end if;

  if v_order.referral_code is not null then
    select jsonb_build_object('type', c.reward_type, 'value', c.reward_value, 'gift_item_id', c.gift_item_id)
    into v_coupon
    from public.referral_codes c where c.code = v_order.referral_code;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'menu_item_id', oi.menu_item_id, 'name', oi.name_snapshot,
    'unit_price_cents', oi.unit_price_cents, 'qty', oi.qty) order by oi.id), '[]'::jsonb)
  into v_lines
  from public.order_items oi where oi.order_id = v_order.id;

  -- Site = entrega/levantamento online. Pedido QR de mesa segue o balcão.
  v_rules := private.store_promotions_at(v_order.store_id, v_order.created_at,
    v_order.channel not in ('delivery', 'pickup'));

  v_r := private.compute_promotions(
    v_lines,
    case when v_order.channel = 'delivery' then 'delivery' else v_order.fulfillment_type end,
    v_order.zone_fee, v_coupon,
    (v_rules ->> 'bogo_on')::boolean, (v_rules ->> 'same_item_only')::boolean,
    (v_rules ->> 'free_min')::integer, null);

  update public.orders
  set discount_cents = (v_r ->> 'discount_cents')::integer,
      bogo_discount_cents = (v_r ->> 'bogo_discount_cents')::integer,
      bogo_free_item = v_r ->> 'bogo_free_item',
      manual_discount_cents = 0,
      delivery_fee_cents = (v_r ->> 'delivery_fee_cents')::integer,
      delivery_discount_cents = (v_r ->> 'delivery_discount_cents')::integer,
      total_cents = (v_r ->> 'total_cents')::integer
  where id = v_order.id;

  -- O rasto tem de dizer o mesmo que o pedido.
  update public.event_log
  set payload = payload || jsonb_build_object(
    'total_cents', (v_r ->> 'total_cents')::integer, 'discount_cents', (v_r ->> 'discount_cents')::integer)
  where order_id = v_order.id and type = 'order.created';

  v_coupon_cents := (v_r ->> 'coupon_discount_cents')::integer;
  if v_coupon is not null then
    update public.event_log
    set payload = payload || jsonb_build_object('discount', v_coupon_cents)
    where order_id = v_order.id and type = 'referral.redeemed';
  end if;

  if ((v_r ->> 'bogo_discount_cents')::integer > 0 or (v_r ->> 'delivery_discount_cents')::integer > 0)
    and not exists (select 1 from public.event_log e where e.order_id = v_order.id and e.type = 'promotion.applied')
  then
    insert into public.event_log (order_id, store_id, type, payload)
    values (v_order.id, v_order.store_id, 'promotion.applied', v_r);
  end if;
end $$;
revoke all on function private.apply_order_promotions(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. A camada no create_order
-- ---------------------------------------------------------------------------
--   public.create_order                        (1081 mesas → 1074 upsell)
--   private.create_order_before_upsell         (1048: horário, idempotência)
--   private.create_order_store_legacy          ← ESTA (1113 promoções)
--   private.create_order_store_before_promotions (1060 campanha)
--   private.create_order_store_before_campaign (1013 numeração)
--   private.create_order_legacy                (motor herdado)
do $$
begin
  if to_regprocedure('private.create_order_store_before_promotions(text,jsonb)') is null then
    alter function private.create_order_store_legacy(text, jsonb)
      rename to create_order_store_before_promotions;
  end if;
end $$;
revoke all on function private.create_order_store_before_promotions(text, jsonb)
  from public, anon, authenticated;

create or replace function private.create_order_store_legacy(p_store_slug text, p_payload jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_store uuid;
  v_code text;
  v_code_store uuid;
  v_order uuid;
begin
  select s.id into v_store from public.stores s where s.slug = p_store_slug and s.active;

  -- Loja inválida: a camada de baixo recusa com o erro de sempre.
  -- DECISÃO: com uma campanha de preço activa (1060) não há promoções — a
  -- campanha já é o desconto e retira o cupão; acumular seria dar duas vezes.
  if v_store is null or (private.active_store_campaign(v_store)).id is not null then
    return private.create_order_store_before_promotions(p_store_slug, p_payload);
  end if;

  -- Cupão de outra loja: recusar ANTES de o motor gravar o resgate.
  v_code := nullif(upper(btrim(p_payload ->> 'referralCode')), '');
  if v_code is not null then
    select c.store_id into v_code_store from public.referral_codes c where c.code = v_code;
    if v_code_store is not null and v_code_store <> v_store then
      raise exception 'referral_wrong_store' using errcode = 'P0026';
    end if;
  end if;

  v_order := private.create_order_store_before_promotions(p_store_slug, p_payload);
  perform private.apply_order_promotions(v_order);
  return v_order;
end $$;
revoke all on function private.create_order_store_legacy(text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Leituras públicas (montra e checkout)
-- ---------------------------------------------------------------------------
create or replace function public.get_store_promotions(p_store_slug text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_store uuid;
  v_bogo public.promotions;
  v_fd public.promotions;
  v_items jsonb := '[]'::jsonb;
begin
  select s.id into v_store from public.stores s where s.slug = p_store_slug and s.active;
  if v_store is null then
    return jsonb_build_object('bogo', null, 'free_delivery', null);
  end if;

  select p.* into v_bogo from public.promotions p where p.store_id = v_store and p.kind = 'bogo' and p.active;
  select p.* into v_fd from public.promotions p where p.store_id = v_store and p.kind = 'free_delivery' and p.active;

  if v_bogo.id is not null then
    select coalesce(jsonb_agg(mi.id order by mi.id), '[]'::jsonb) into v_items
    from public.menu_items mi
    join public.store_items si on si.menu_item_id = mi.id and si.store_id = v_store
    where mi.bogo_eligible and not mi.is_gift;
  end if;

  -- Colunas listadas uma a uma (AGENTS §4.7): nada de custo nem de quem editou.
  return jsonb_build_object(
    'bogo', case when v_bogo.id is null then null else jsonb_build_object(
      'live', private.promotion_is_live(v_bogo, now()),
      'label', v_bogo.label,
      'weekdays', to_jsonb(v_bogo.weekdays),
      'same_item_only', v_bogo.same_item_only,
      'include_counter', v_bogo.include_counter,
      'starts_at', v_bogo.starts_at,
      'ends_at', v_bogo.ends_at,
      'item_ids', v_items) end,
    'free_delivery', case when v_fd.id is null then null else jsonb_build_object(
      'live', private.promotion_is_live(v_fd, now()),
      'label', v_fd.label,
      'weekdays', to_jsonb(v_fd.weekdays),
      'min_subtotal_cents', v_fd.min_subtotal_cents,
      'include_counter', v_fd.include_counter,
      'starts_at', v_fd.starts_at,
      'ends_at', v_fd.ends_at) end);
end $$;
revoke all on function public.get_store_promotions(text) from public;
grant execute on function public.get_store_promotions(text) to anon, authenticated, service_role;

-- Pré-validação do cupão já com a loja. A de dois argumentos fica, para quem
-- ainda tenha a página antiga aberta; o create_order recusa na mesma.
create or replace function public.validate_referral(p_code text, p_phone text, p_store_slug text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_store uuid;
  v_code_store uuid;
  v_result jsonb;
begin
  select s.id into v_store from public.stores s where s.slug = p_store_slug and s.active;
  if v_store is null then
    return jsonb_build_object('valid', false, 'reason', 'invalid_or_expired');
  end if;

  v_result := public.validate_referral(p_code, p_phone);
  if coalesce((v_result ->> 'valid')::boolean, false) is not true then
    return v_result;
  end if;

  select c.store_id into v_code_store from public.referral_codes c where c.code = upper(btrim(p_code));
  if v_code_store is not null and v_code_store <> v_store then
    return jsonb_build_object('valid', false, 'reason', 'wrong_store');
  end if;
  return v_result;
end $$;
revoke all on function public.validate_referral(text, text, text) from public;
grant execute on function public.validate_referral(text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7b. Balcão (POS): cupão, promoções "também no balcão" e desconto manual
-- ---------------------------------------------------------------------------
-- Chamada DENTRO do create_counter_sale_unlocked, antes de conferir os
-- pagamentos. Não escreve nada: devolve a conta e o que é preciso gravar.
--
-- Venda que chega pela sincronização offline (`offlineTotalCents`): já foi
-- cobrada ao cliente. Regra 1 — a venda nunca pára: um cupão entretanto
-- esgotado, ou um desconto manual gravado por outro operador, aplica-se na
-- mesma, mas a venda fica `needs_review` e deixa rasto.
create or replace function private.counter_sale_promotions(
  p_store uuid,
  p_items jsonb,
  p_fulfillment text,
  p_zone_fee integer,
  p_payload jsonb,
  p_role text
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_lenient boolean := p_payload ? 'offlineTotalCents';
  v_at timestamptz := now();
  v_code text := nullif(upper(btrim(p_payload ->> 'referralCode')), '');
  v_phone text := nullif(btrim(p_payload ->> 'customerPhone'), '');
  v_rc public.referral_codes;
  v_coupon jsonb;
  v_problem text;
  v_flags jsonb := '[]'::jsonb;
  v_manual jsonb := p_payload -> 'manualDiscount';
  v_manual_ok jsonb;
  v_reason text;
  v_value integer;
  v_lines jsonb;
  v_rules jsonb;
  v_r jsonb;
begin
  -- Venda offline: as promoções do dia contam-se à hora em que foi feita.
  if v_lenient and p_payload ->> 'promoAt' is not null then
    begin
      v_at := (p_payload ->> 'promoAt')::timestamptz;
      if v_at > now() + interval '5 minutes' or v_at < now() - interval '7 days' then
        v_at := now();
      end if;
    exception when others then
      v_at := now();
    end;
  end if;

  -- Cupão
  if v_code is not null then
    select c.* into v_rc from public.referral_codes c where c.code = v_code;
    if v_rc.id is null then
      v_problem := 'referral_invalid_or_expired';
    elsif not v_rc.active or (v_rc.expires_at is not null and v_rc.expires_at <= v_at) then
      v_problem := 'referral_invalid_or_expired';
    elsif v_rc.store_id is not null and v_rc.store_id <> p_store then
      v_problem := 'referral_wrong_store';
    elsif v_phone is null then
      -- Cada pessoa usa cada código uma vez: sem telefone não há como saber.
      v_problem := 'coupon_requires_phone';
    elsif v_rc.owner_phone is not null and v_rc.owner_phone = v_phone then
      v_problem := 'referral_auto_redemption';
    elsif exists (select 1 from public.referral_redemptions r where r.code_id = v_rc.id and r.customer_phone = v_phone) then
      v_problem := 'referral_already_redeemed';
    elsif (select count(*) from public.referral_redemptions r where r.code_id = v_rc.id) >= v_rc.max_redemptions then
      v_problem := 'referral_max_redemptions';
    end if;

    if v_problem is not null and not v_lenient then
      raise exception '%', v_problem using errcode = case v_problem
        when 'referral_invalid_or_expired' then 'P0020'
        when 'referral_auto_redemption' then 'P0021'
        when 'referral_already_redeemed' then 'P0022'
        when 'referral_max_redemptions' then 'P0023'
        when 'referral_wrong_store' then 'P0026'
        else 'P0027' end;
    end if;
    if v_problem is not null then
      v_flags := v_flags || to_jsonb(v_problem);
    end if;
    if v_rc.id is not null then
      v_coupon := jsonb_build_object('type', v_rc.reward_type, 'value', v_rc.reward_value,
        'gift_item_id', v_rc.gift_item_id);
    end if;
  end if;

  -- Desconto manual: só gerente/dono, com motivo
  if v_manual is not null and jsonb_typeof(v_manual) = 'object' then
    v_reason := nullif(btrim(v_manual ->> 'reason'), '');
    begin
      v_value := (v_manual ->> 'value')::integer;
    exception when others then
      raise exception 'invalid_manual_discount' using errcode = 'P0007';
    end;
    if v_manual ->> 'type' not in ('pct', 'cents') or v_value is null or v_value <= 0
      or (v_manual ->> 'type' = 'pct' and v_value > 100)
      or v_reason is null or length(v_reason) < 3 or length(v_reason) > 200
    then
      raise exception 'invalid_manual_discount' using errcode = 'P0007';
    end if;
    if coalesce(p_role, '') not in ('owner', 'manager') then
      if not v_lenient then
        raise exception 'discount_requires_manager' using errcode = 'P0403';
      end if;
      v_flags := v_flags || to_jsonb('manual_discount_unverified'::text);
    end if;
    v_manual_ok := jsonb_build_object('type', v_manual ->> 'type', 'value', v_value);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'menu_item_id', i ->> 'menu_item_id', 'name', i ->> 'name',
    'unit_price_cents', (i ->> 'unit_price_cents')::integer, 'qty', (i ->> 'qty')::integer)), '[]'::jsonb)
  into v_lines
  from jsonb_array_elements(p_items) i;

  v_rules := private.store_promotions_at(p_store, v_at, true);
  v_r := private.compute_promotions(
    v_lines,
    case when p_fulfillment = 'delivery' then 'delivery' else 'pickup' end,
    p_zone_fee, v_coupon,
    (v_rules ->> 'bogo_on')::boolean, (v_rules ->> 'same_item_only')::boolean,
    (v_rules ->> 'free_min')::integer, v_manual_ok);

  return v_r || jsonb_build_object(
    'coupon_id', v_rc.id,
    'coupon_code', case when v_rc.id is not null then v_code end,
    'customer_phone', v_phone,
    'discount_reason', v_reason,
    'flags', v_flags);
end $$;
revoke all on function private.counter_sale_promotions(uuid, jsonb, text, integer, jsonb, text)
  from public, anon, authenticated;

-- Grava na venda o que counter_sale_promotions calculou (resgate, rasto).
create or replace function private.record_counter_promotions(p_order_id uuid, p_promo jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_store uuid;
  v_uid uuid := (select auth.uid());
  v_flags jsonb := coalesce(p_promo -> 'flags', '[]'::jsonb);
begin
  if p_promo is null then return; end if;
  if (p_promo ->> 'discount_cents')::integer = 0
    and (p_promo ->> 'delivery_discount_cents')::integer = 0
    and p_promo ->> 'coupon_id' is null
  then
    return;
  end if;

  update public.orders
  set discount_cents = (p_promo ->> 'discount_cents')::integer,
      bogo_discount_cents = (p_promo ->> 'bogo_discount_cents')::integer,
      bogo_free_item = p_promo ->> 'bogo_free_item',
      manual_discount_cents = (p_promo ->> 'manual_discount_cents')::integer,
      discount_reason = p_promo ->> 'discount_reason',
      delivery_discount_cents = (p_promo ->> 'delivery_discount_cents')::integer,
      referral_code = coalesce(p_promo ->> 'coupon_code', referral_code),
      needs_review = needs_review or jsonb_array_length(v_flags) > 0
  where id = p_order_id
  returning store_id into v_store;

  if p_promo ->> 'coupon_id' is not null and p_promo ->> 'customer_phone' is not null then
    insert into public.referral_redemptions (code_id, order_id, customer_phone)
    values ((p_promo ->> 'coupon_id')::uuid, p_order_id, p_promo ->> 'customer_phone')
    on conflict (code_id, customer_phone) do nothing;

    insert into public.event_log (order_id, store_id, actor_user_id, type, payload)
    values (p_order_id, v_store, v_uid, 'referral.redeemed', jsonb_build_object(
      'code', p_promo ->> 'coupon_code', 'discount', (p_promo ->> 'coupon_discount_cents')::integer,
      'channel', 'counter'));
  end if;

  if (p_promo ->> 'manual_discount_cents')::integer > 0 then
    insert into public.event_log (order_id, store_id, actor_user_id, type, payload)
    values (p_order_id, v_store, v_uid, 'pos.manual_discount', jsonb_build_object(
      'discount_cents', (p_promo ->> 'manual_discount_cents')::integer,
      'reason', p_promo ->> 'discount_reason', 'role', private.auth_role()));
  end if;

  if (p_promo ->> 'bogo_discount_cents')::integer > 0 or (p_promo ->> 'delivery_discount_cents')::integer > 0 then
    insert into public.event_log (order_id, store_id, actor_user_id, type, payload)
    values (p_order_id, v_store, v_uid, 'promotion.applied', p_promo - 'customer_phone');
  end if;

  if jsonb_array_length(v_flags) > 0 then
    insert into public.event_log (order_id, store_id, actor_user_id, type, payload)
    values (p_order_id, v_store, v_uid, 'promotion.needs_review', jsonb_build_object('flags', v_flags));
  end if;
end $$;
revoke all on function private.record_counter_promotions(uuid, jsonb) from public, anon, authenticated;

-- Injecta as duas chamadas no create_counter_sale_unlocked (500 linhas, a
-- facturar): três substituições exactas, cada uma verificada. Se o corpo
-- tiver mudado e um âncora não existir, a migration PÁRA — nunca instala uma
-- venda de balcão meio alterada.
do $$
declare
  v_def text;
  v_new text;
begin
  v_def := pg_get_functiondef('public.create_counter_sale_unlocked(jsonb)'::regprocedure);
  if position('private.counter_sale_promotions' in v_def) > 0 then
    return; -- já aplicado
  end if;

  -- regexp sem 'g': só a primeira ocorrência; (\r?\n) aguenta um corpo com CRLF.
  v_new := regexp_replace(v_def, '(  v_needs_review boolean := false;)(\r?\n)',
    '\1\2  v_promo jsonb;\2');
  if v_new = v_def then raise exception '1113: âncora v_needs_review não encontrada'; end if;
  v_def := v_new;

  v_new := regexp_replace(v_def, '  v_total := v_subtotal \+ v_delivery_fee;(\r?\n)',
    '  -- (1113) Cupão, promoções "também no balcão" e desconto manual.\1'
    || '  v_promo := private.counter_sale_promotions(v_store.id, v_resolved_items, v_fulfillment, v_delivery_fee, p_payload, v_role);\1'
    || '  v_delivery_fee := (v_promo ->> ''delivery_fee_cents'')::integer;\1'
    || '  v_total := (v_promo ->> ''total_cents'')::integer;\1');
  if v_new = v_def then raise exception '1113: âncora v_total não encontrada'; end if;
  v_def := v_new;

  v_new := regexp_replace(v_def, '(  returning id into v_order_id;)(\r?\n)',
    '\1\2\2  perform private.record_counter_promotions(v_order_id, v_promo);\2');
  if v_new = v_def then raise exception '1113: âncora returning id não encontrada'; end if;

  execute v_new;
end $$;

-- A sincronização offline recalcula `needs_review` só pela diferença de total
-- e apagava a marca de revisão de um cupão/desconto não verificado. Mantém-na.
do $$
declare
  v_def text;
  v_new text;
begin
  v_def := pg_get_functiondef('public.sync_counter_sale(jsonb,jsonb)'::regprocedure);
  if position('promotion.needs_review' in v_def) > 0 then
    return;
  end if;
  v_new := regexp_replace(v_def,
    '  v_needs_review := v_offline_total <> v_server_total;(\r?\n)',
    '  v_needs_review := v_offline_total <> v_server_total\1'
    || '    or exists (select 1 from public.event_log e where e.order_id = v_order_id and e.type = ''promotion.needs_review'');\1');
  if v_new = v_def then raise exception '1113: âncora do sync_counter_sale não encontrada'; end if;
  execute v_new;
end $$;

-- ---------------------------------------------------------------------------
-- 7c. O talão sabe de onde veio o desconto
-- ---------------------------------------------------------------------------
-- Enriquece o payload de cada talão completo com a origem dos abatimentos,
-- lida do pedido. Uma bridge antiga ignora os campos e imprime "Desconto:"
-- com o total, como hoje. Best-effort: falhar aqui nunca impede o papel.
create or replace function private.print_job_promotions()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  o record;
begin
  if new.order_id is null or new.kind <> 'order' then return new; end if;
  begin
    select discount_cents, bogo_discount_cents, bogo_free_item, manual_discount_cents,
           discount_reason, delivery_discount_cents, referral_code
    into o from public.orders where id = new.order_id;
    if found and (o.discount_cents > 0 or o.delivery_discount_cents > 0) then
      new.payload := new.payload || jsonb_build_object(
        'bogo_discount_cents', o.bogo_discount_cents,
        'bogo_free_item', o.bogo_free_item,
        'coupon_code', o.referral_code,
        'coupon_discount_cents', o.discount_cents - o.bogo_discount_cents - o.manual_discount_cents,
        'manual_discount_cents', o.manual_discount_cents,
        'discount_reason', o.discount_reason,
        'delivery_discount_cents', o.delivery_discount_cents);
    end if;
  exception when others then
    null;
  end;
  return new;
end $$;
revoke all on function private.print_job_promotions() from public, anon, authenticated;

drop trigger if exists print_jobs_promotions on public.print_jobs;
create trigger print_jobs_promotions before insert on public.print_jobs
  for each row execute function private.print_job_promotions();

-- ---------------------------------------------------------------------------
-- 7d. A página do cliente mostra os descontos
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('private.get_order_status_before_promotions(uuid)') is null then
    alter function public.get_order_status(uuid) set schema private;
    alter function private.get_order_status(uuid) rename to get_order_status_before_promotions;
  end if;
end $$;
revoke all on function private.get_order_status_before_promotions(uuid) from public, anon, authenticated;

create or replace function public.get_order_status(p_order_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_result jsonb;
  o record;
begin
  v_result := private.get_order_status_before_promotions(p_order_id);
  select subtotal_cents, delivery_fee_cents, discount_cents, bogo_discount_cents, bogo_free_item,
         manual_discount_cents, delivery_discount_cents, referral_code
  into o from public.orders where id = p_order_id;
  return v_result || jsonb_build_object(
    'subtotal_cents', o.subtotal_cents,
    'delivery_fee_cents', o.delivery_fee_cents,
    'promo', jsonb_build_object(
      'bogo_discount_cents', o.bogo_discount_cents,
      'bogo_free_item', o.bogo_free_item,
      'coupon_code', o.referral_code,
      'coupon_discount_cents', o.discount_cents - o.bogo_discount_cents - o.manual_discount_cents,
      'manual_discount_cents', o.manual_discount_cents,
      'delivery_discount_cents', o.delivery_discount_cents));
end $$;
revoke all on function public.get_order_status(uuid) from public;
grant execute on function public.get_order_status(uuid) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. Resumo para o painel — contas feitas na BD, sem cortar às 1000 linhas
-- ---------------------------------------------------------------------------
create or replace function public.get_promotions_summary(
  p_store_id uuid default null,
  p_from timestamptz default null,
  p_to timestamptz default null
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_from timestamptz := coalesce(p_from, now() - interval '30 days');
  v_to timestamptz := coalesce(p_to, now());
  result jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated' using errcode = 'P0020';
  end if;
  if coalesce(private.auth_role(), '') not in ('owner', 'manager')
    or (p_store_id is null and not private.auth_is_owner())
    or (p_store_id is not null and not private.auth_can_store(p_store_id))
  then
    raise exception 'promotions_access_denied' using errcode = 'P0403';
  end if;
  if v_to <= v_from then
    raise exception 'invalid_period' using errcode = 'P0007';
  end if;

  with o as (
    select o.referral_code, o.discount_cents, o.bogo_discount_cents, o.manual_discount_cents,
      o.delivery_discount_cents, o.total_cents
    from public.orders o
    where o.status in ('paid', 'approved', 'in_preparation', 'ready', 'delivered')
      and o.created_at >= v_from and o.created_at < v_to
      and (p_store_id is null or o.store_id = p_store_id)
  ), per_code as (
    select referral_code as code, count(*) as orders,
      sum(discount_cents - bogo_discount_cents - manual_discount_cents) as discount_cents
    from o where referral_code is not null
    group by referral_code
  )
  select jsonb_build_object(
    'orders', (select count(*) from o),
    'promo_orders', (select count(*) from o where discount_cents > 0 or delivery_discount_cents > 0 or referral_code is not null),
    'bogo_orders', (select count(*) from o where bogo_discount_cents > 0),
    'bogo_discount_cents', (select coalesce(sum(bogo_discount_cents), 0) from o),
    'coupon_orders', (select count(*) from o where referral_code is not null),
    'coupon_discount_cents', (select coalesce(sum(discount_cents - bogo_discount_cents - manual_discount_cents), 0) from o),
    'manual_orders', (select count(*) from o where manual_discount_cents > 0),
    'manual_discount_cents', (select coalesce(sum(manual_discount_cents), 0) from o),
    'free_delivery_orders', (select count(*) from o where delivery_discount_cents > 0),
    'free_delivery_cents', (select coalesce(sum(delivery_discount_cents), 0) from o),
    'promo_revenue_cents', (select coalesce(sum(total_cents), 0) from o
      where discount_cents > 0 or delivery_discount_cents > 0 or referral_code is not null),
    'coupons', coalesce((select jsonb_agg(to_jsonb(c) order by c.orders desc, c.code) from per_code c), '[]'::jsonb)
  ) into result;
  return result;
end $$;
revoke all on function public.get_promotions_summary(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.get_promotions_summary(uuid, timestamptz, timestamptz) to authenticated;

-- Utilizações de cada cupão desde sempre (o "3/100 usos" da lista). Só o dono,
-- como a própria tabela de cupões.
create or replace function public.get_coupon_usage()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or not private.auth_is_owner() then
    raise exception 'promotions_access_denied' using errcode = 'P0403';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('code_id', r.code_id, 'redemptions', r.n, 'last_at', r.last_at))
    from (
      select rr.code_id, count(*) as n, max(rr.created_at) as last_at
      from public.referral_redemptions rr
      group by rr.code_id
    ) r
  ), '[]'::jsonb);
end $$;
revoke all on function public.get_coupon_usage() from public, anon;
grant execute on function public.get_coupon_usage() to authenticated;

notify pgrst, 'reload schema';
