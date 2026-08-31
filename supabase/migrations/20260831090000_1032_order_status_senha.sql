-- 1032 — get_order_status passa a devolver a senha do dia.
--
-- Porquê: o ecrã de pedido recebido chama o cliente pelo NÚMERO DO DIA
-- (`orders.daily_number`, §5.4) — é esse que sai grande no talão, na TV de
-- senhas e na chamada ao balcão. O `order_number` (`MPT-0042`) serve para
-- histórico e pesquisa; ninguém grita "MPT zero zero quarenta e dois" numa
-- loja cheia. Até aqui a RPC pública devolvia só o `order_number`, e o ecrã
-- do cliente não tinha como mostrar a senha por que vai ser chamado.
--
-- Campo público e não sensível: é o mesmo número que está impresso no talão
-- que o cliente tem na mão. Nada mais muda no payload — a morada continua
-- deliberadamente de fora ((public)/CLAUDE.md §9: identificação sem OTP nunca
-- devolve PII).
--
-- Forward-only e idempotente (§11.7): create or replace do corpo completo.

create or replace function public.get_order_status(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_order record;
  v_items jsonb;
begin
  select o.id, o.order_number, o.daily_number, o.status, o.flow, o.fulfillment_type,
         o.scheduled_for, o.total_cents, o.payment_method, o.created_at,
         s.slug as store_slug, s.short_name as store_name, s.address as store_address,
         s.phone as store_phone, s.maps_url as store_maps_url
  into v_order
  from public.orders o
  left join public.stores s on s.id = o.store_id
  where o.id = p_order_id;

  if v_order.id is null then
    return null;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'menu_item_id',     oi.menu_item_id,
        'name_snapshot',    oi.name_snapshot,
        'qty',              oi.qty,
        'unit_price_cents', oi.unit_price_cents
      )
      order by oi.created_at
    ),
    '[]'::jsonb
  )
  into v_items
  from public.order_items oi
  where oi.order_id = p_order_id;

  return jsonb_build_object(
    'id',               v_order.id,
    'order_number',     v_order.order_number,
    -- A senha do dia: null nos pedidos antigos, que caem no order_number.
    'daily_number',     v_order.daily_number,
    'status',           v_order.status,
    'flow',             v_order.flow,
    'fulfillment_type', v_order.fulfillment_type,
    'scheduled_for',    v_order.scheduled_for,
    'total_cents',      v_order.total_cents,
    'payment_method',   v_order.payment_method,
    'created_at',       v_order.created_at,
    'order_items',      v_items,
    'store', jsonb_build_object(
      'slug',       v_order.store_slug,
      'short_name', v_order.store_name,
      'address',    v_order.store_address,
      'phone',      v_order.store_phone,
      'maps_url',   v_order.store_maps_url
    )
  );
end;
$$;

revoke all on function public.get_order_status(uuid) from public;
grant execute on function public.get_order_status(uuid) to anon, authenticated, service_role;
