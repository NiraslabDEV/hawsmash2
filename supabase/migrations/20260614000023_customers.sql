-- ============================================================================
-- DELIVERY OS — F7: Conta do cliente (identificação soft, sem OTP)
-- Tabela customers + RPCs públicas (SECURITY DEFINER) para a loja:
--   • identify_customer(phone, name?) → upsert + RESUMO (métricas, favoritos, últimas compras)
--   • get_customer_orders(phone)      → lista de pedidos do telefone (resumos + itens p/ "pedir de novo")
-- PRIVACIDADE (decisão fechada, CLAUDE §18/§9 loja): soft-login sem OTP →
--   devolver SÓ resumos do próprio telefone. NUNCA morada, comprovativo ou dados de pagamento.
-- Single-tenant: sem tenant_id. anon nunca faz SELECT direto — só estas RPCs.
-- ============================================================================

create table if not exists public.customers (
  phone             text primary key,
  name              text,
  first_seen_at     timestamptz not null default now(),
  last_seen_at      timestamptz not null default now(),
  orders_count      int not null default 0,
  total_spent_cents int not null default 0
);

alter table public.customers enable row level security;

-- staff (qualquer authenticated, pois 1 restaurante) gere/lê tudo
drop policy if exists "staff_all" on public.customers;
create policy "staff_all" on public.customers for all to authenticated using (true) with check (true);
-- anon: NENHUMA policy direta — acesso só via RPCs abaixo.

-- ── identify_customer ───────────────────────────────────────────────────────
-- Upsert do cliente + devolve um resumo leve. "Venda confirmada" = mesma
-- definição do painel (approved/paid/in_preparation/ready/delivered).
create or replace function public.identify_customer(p_phone text, p_name text default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_phone text := nullif(trim(p_phone), '');
  v_name  text := nullif(trim(p_name), '');
  v_count int := 0;
  v_spent int := 0;
  v_favs  jsonb;
  v_orders jsonb;
  v_stored_name text;
begin
  if v_phone is null then raise exception 'phone_required'; end if;

  -- métricas de vendas confirmadas deste telefone
  select count(*), coalesce(sum(total_cents), 0)
    into v_count, v_spent
  from orders
  where customer_phone = v_phone
    and status in ('approved','paid','in_preparation','ready','delivered');

  insert into customers (phone, name, orders_count, total_spent_cents)
  values (v_phone, v_name, v_count, v_spent)
  on conflict (phone) do update
    set last_seen_at      = now(),
        name              = coalesce(v_name, customers.name),
        orders_count      = excluded.orders_count,
        total_spent_cents = excluded.total_spent_cents
  returning name into v_stored_name;

  -- favoritos derivados: itens mais pedidos (top 5)
  select coalesce(jsonb_agg(
           jsonb_build_object('menu_item_id', t.menu_item_id, 'name', t.name, 'qty', t.qty)
           order by t.qty desc
         ), '[]'::jsonb)
    into v_favs
  from (
    select oi.menu_item_id, oi.name_snapshot as name, sum(oi.qty)::int as qty
    from order_items oi
    join orders o on o.id = oi.order_id
    where o.customer_phone = v_phone
      and o.status in ('approved','paid','in_preparation','ready','delivered')
    group by oi.menu_item_id, oi.name_snapshot
    order by sum(oi.qty) desc
    limit 5
  ) t;

  -- últimas compras (top 5) — SÓ resumo (sem morada/comprovativo/pagamento)
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'id', o.id, 'order_number', o.order_number, 'status', o.status,
             'total_cents', o.total_cents, 'created_at', o.created_at
           ) order by o.created_at desc
         ), '[]'::jsonb)
    into v_orders
  from (
    select id, order_number, status, total_cents, created_at
    from orders
    where customer_phone = v_phone and status <> 'draft'
    order by created_at desc
    limit 5
  ) o;

  return jsonb_build_object(
    'phone',             v_phone,
    'name',              v_stored_name,
    'orders_count',      v_count,
    'total_spent_cents', v_spent,
    'favorites',         v_favs,
    'recent_orders',     v_orders
  );
end;
$$;

grant execute on function public.identify_customer(text, text) to anon, authenticated;

-- ── get_customer_orders ─────────────────────────────────────────────────────
-- Lista completa de pedidos do telefone (resumos + itens p/ "pedir de novo").
-- NUNCA devolve morada, comprovativo ou dados de pagamento.
create or replace function public.get_customer_orders(p_phone text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_phone text := nullif(trim(p_phone), '');
  v_orders jsonb;
begin
  if v_phone is null then return jsonb_build_object('orders', '[]'::jsonb); end if;

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'id', o.id,
             'order_number', o.order_number,
             'status', o.status,
             'fulfillment_type', o.fulfillment_type,
             'total_cents', o.total_cents,
             'created_at', o.created_at,
             'scheduled_for', o.scheduled_for,
             'items', (
               select coalesce(jsonb_agg(jsonb_build_object(
                        'menu_item_id', x.menu_item_id, 'name', x.name_snapshot, 'qty', x.qty
                      )), '[]'::jsonb)
               from order_items x where x.order_id = o.id
             )
           ) order by o.created_at desc
         ), '[]'::jsonb)
    into v_orders
  from orders o
  where o.customer_phone = v_phone and o.status <> 'draft';

  return jsonb_build_object('orders', v_orders);
end;
$$;

grant execute on function public.get_customer_orders(text) to anon, authenticated;
