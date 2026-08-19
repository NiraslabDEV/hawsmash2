-- HAWSMASH 2.0 — F6: esgotado por loja, automático no site e no POS.
--
-- O site continua a receber apenas o que pode vender. O POS (autenticado)
-- pode pedir o cardápio completo para mostrar o item esgotado a cinzento e
-- não clicável, em vez de o fazer desaparecer do ecrã a meio do turno
-- (CLAUDE §7.1).

drop function if exists public.get_menu(text, text);

create function public.get_menu(
  p_store_slug text,
  p_channel text default null,
  p_include_unavailable boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_store public.stores%rowtype;
  v_legacy jsonb;
  v_categories jsonb := '[]'::jsonb;
  v_items jsonb;
  v_category jsonb;
  v_item jsonb;
  v_store_item record;
  v_available boolean;
begin
  -- O cardápio alargado (com esgotados) é ferramenta de operação, não de loja.
  if p_include_unavailable and (select auth.uid()) is null then
    raise exception 'menu_scope_requires_auth' using errcode = 'P0403';
  end if;

  select s.*
  into v_store
  from public.stores s
  where s.slug = p_store_slug
    and s.active;

  if not found then
    raise exception 'store_not_found' using errcode = 'P0404';
  end if;

  v_legacy := private.get_menu_legacy(p_channel);

  for v_category in
    select value from jsonb_array_elements(v_legacy -> 'categories')
  loop
    v_items := '[]'::jsonb;

    for v_item in
      select value from jsonb_array_elements(v_category -> 'items')
    loop
      select
        si.available,
        si.track_stock,
        si.stock_qty,
        coalesce(si.price_cents_override, mi.price_cents) as effective_price_cents
      into v_store_item
      from public.store_items si
      join public.menu_items mi on mi.id = si.menu_item_id
      where si.store_id = v_store.id
        and si.menu_item_id = (v_item ->> 'id')::uuid;

      if found then
        v_available := v_store_item.available
          and (not v_store_item.track_stock or v_store_item.stock_qty > 0);

        if v_available or p_include_unavailable then
          v_items := v_items || jsonb_build_array(
            v_item || jsonb_build_object(
              'price_cents', v_store_item.effective_price_cents,
              'available', v_available
            ) || case
              when p_include_unavailable then jsonb_build_object(
                'track_stock', v_store_item.track_stock,
                'stock_qty', case when v_store_item.track_stock then v_store_item.stock_qty end
              )
              else '{}'::jsonb
            end
          );
        end if;
      end if;
    end loop;

    if jsonb_array_length(v_items) > 0 then
      v_categories := v_categories || jsonb_build_array(
        (v_category - 'items') || jsonb_build_object('items', v_items)
      );
    end if;
  end loop;

  return (v_legacy - array[
    'accepting_orders', 'payment_provider',
    'mpesa_number', 'mpesa_name', 'emola_number', 'emola_name',
    'categories', 'zones'
  ]) || jsonb_build_object(
    'store', jsonb_build_object(
      'id', v_store.id,
      'slug', v_store.slug,
      'name', v_store.name,
      'short_name', v_store.short_name,
      'address', v_store.address,
      'maps_url', v_store.maps_url,
      'phone', v_store.phone,
      'delivery_enabled', v_store.delivery_enabled,
      'pickup_enabled', v_store.pickup_enabled,
      'counter_enabled', v_store.counter_enabled
    ),
    'accepting_orders', v_store.accepting_orders,
    'payment_provider', v_store.payment_provider,
    'mpesa_number', v_store.mpesa_number,
    'mpesa_name', v_store.mpesa_name,
    'emola_number', v_store.emola_number,
    'emola_name', v_store.emola_name,
    'categories', v_categories,
    'zones', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', z.id,
        'name', z.name,
        'fee_cents', z.fee_cents,
        'sort', z.sort
      ) order by z.sort), '[]'::jsonb)
      from public.delivery_zones z
      where z.store_id = v_store.id and z.active
    ),
    'hours', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'dow', h.dow,
        'opens', h.opens,
        'closes', h.closes,
        'active', h.active
      ) order by h.dow), '[]'::jsonb)
      from public.store_hours h
      where h.store_id = v_store.id
    )
  );
end;
$$;

revoke all on function public.get_menu(text, text, boolean) from public;
grant execute on function public.get_menu(text, text, boolean) to anon, authenticated, service_role;
