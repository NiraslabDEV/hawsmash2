-- HAWSMASH 2.0 — 1028: exportação de vendas para o contabilista.
--
-- O sistema não emite factura fiscal (CLAUDE.md §0/§18) — isso fica com um
-- software certificado pela AT, pago à parte pelo Ridwan. O que o HAWSMASH
-- garante é um caminho de saída limpo: tudo o que entrou como dinheiro real
-- (pagamento confirmado ou devolvido), por venda, pronto para o contabilista
-- mapear para o formato que o software dele pedir.
--
-- Ao nível do PAGAMENTO, não do pedido: uma venda pode ter dinheiro + M-Pesa
-- no mesmo talão (§7.1), e é o pagamento que bate certo com o extracto do
-- banco/carteira móvel — não o total do pedido.

create or replace function public.export_sales_for_accounting(
  p_store_id uuid default null,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns table (
  store_name text,
  sale_date date,
  sale_time text,
  order_number text,
  daily_number integer,
  channel text,
  order_status text,
  customer_name text,
  customer_phone text,
  subtotal_cents integer,
  delivery_fee_cents integer,
  order_total_cents integer,
  payment_method text,
  payment_amount_cents integer,
  payment_status text,
  payment_reference text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from timestamptz := coalesce(p_from, date_trunc('month', now()));
  v_to   timestamptz := coalesce(p_to, now() + interval '1 day');
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated' using errcode = 'P0020';
  end if;

  if p_store_id is null then
    if not private.auth_is_owner() then
      raise exception 'export_access_denied' using errcode = 'P0403';
    end if;
  elsif not private.auth_can_store(p_store_id) then
    raise exception 'export_access_denied' using errcode = 'P0403';
  end if;

  if private.auth_role() not in ('owner', 'manager') then
    raise exception 'export_access_denied' using errcode = 'P0403';
  end if;

  if v_to <= v_from then
    raise exception 'invalid_period' using errcode = 'P0007';
  end if;

  return query
  select
    s.short_name,
    (o.created_at at time zone 'Africa/Maputo')::date,
    to_char(o.created_at at time zone 'Africa/Maputo', 'HH24:MI'),
    o.order_number,
    o.daily_number,
    o.channel,
    o.status,
    o.customer_name,
    o.customer_phone,
    o.subtotal_cents,
    o.delivery_fee_cents,
    o.total_cents,
    p.method,
    p.amount_cents,
    p.status,
    p.provider_ref
  from public.payments p
  join public.orders o on o.id = p.order_id
  join public.stores s on s.id = o.store_id
  where p.status in ('confirmed', 'refunded')
    and o.created_at >= v_from
    and o.created_at < v_to
    and (p_store_id is null or o.store_id = p_store_id)
  order by o.created_at, o.order_number;
end;
$$;

revoke all on function public.export_sales_for_accounting(uuid, timestamptz, timestamptz)
  from public, anon;
grant execute on function public.export_sales_for_accounting(uuid, timestamptz, timestamptz)
  to authenticated;
