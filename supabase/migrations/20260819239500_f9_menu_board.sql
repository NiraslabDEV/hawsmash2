-- HAWSMASH 2.0 — F9: cardápio de parede (menu board) da loja.
--
-- A TV precisa de mostrar o esgotado a cinzento — coisa que o cardápio do site
-- esconde de propósito. Esta RPC devolve exactamente o que a parede mostra:
-- nome, preço efectivo e disponibilidade. Nada de custo, margem ou stock.

create or replace function public.get_store_board(p_store_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_store public.stores%rowtype;
begin
  select s.*
  into v_store
  from public.stores s
  where s.slug = p_store_slug
    and s.active;

  if not found then
    raise exception 'store_not_found' using errcode = 'P0404';
  end if;

  return jsonb_build_object(
    'store', jsonb_build_object('slug', v_store.slug, 'short_name', v_store.short_name),
    'updated_at', now(),
    'categories', coalesce(
      (
        select jsonb_agg(category order by category.sort, category.name)
        from (
          select
            mc.id,
            mc.name,
            mc.sort,
            (
              select coalesce(jsonb_agg(jsonb_build_object(
                'id', mi.id,
                'name', mi.name,
                'price_cents', coalesce(si.price_cents_override, mi.price_cents),
                'available', si.available
                  and (not si.track_stock or si.stock_qty > 0)
              ) order by mi.sort, mi.name), '[]'::jsonb)
              from public.store_items si
              join public.menu_items mi on mi.id = si.menu_item_id
              where si.store_id = v_store.id
                and mi.category_id = mc.id
            ) as items
          from public.menu_categories mc
          where mc.active
        ) category
        where jsonb_array_length(category.items) > 0
      ),
      '[]'::jsonb
    )
  );
end;
$$;

revoke all on function public.get_store_board(text) from public;
grant execute on function public.get_store_board(text) to anon, authenticated, service_role;
