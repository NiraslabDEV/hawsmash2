-- F-extra: importação de cardápio em massa (formato canónico menu.json)
-- RPC chamável pelo CLI (pnpm menu:import) ou por um botão "Importar" em qualquer admin UI.
-- Idempotente: faz upsert por NOME (categoria) e (categoria, nome) (item) — re-correr atualiza,
-- não duplica. Recebe price_cents já em centavos (conversão feita em packages/core/menu-import.ts).
-- Single-tenant: staff = authenticated.

create or replace function public.import_menu(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cat   jsonb;
  v_item  jsonb;
  v_cat_id uuid;
  v_cats  int := 0;
  v_items int := 0;
begin
  if p_payload is null or jsonb_typeof(p_payload->'categories') <> 'array' then
    raise exception 'invalid_payload: esperado { categories: [...] }';
  end if;

  for v_cat in select * from jsonb_array_elements(p_payload->'categories') loop
    -- upsert categoria por nome
    select id into v_cat_id from menu_categories where name = v_cat->>'name' limit 1;
    if v_cat_id is null then
      insert into menu_categories (name, sort, station, active)
      values (
        v_cat->>'name',
        coalesce((v_cat->>'sort')::int, 0),
        coalesce(v_cat->>'station', 'kitchen'),
        coalesce((v_cat->>'active')::bool, true)
      )
      returning id into v_cat_id;
    else
      update menu_categories set
        sort    = coalesce((v_cat->>'sort')::int, sort),
        station = coalesce(v_cat->>'station', station),
        active  = coalesce((v_cat->>'active')::bool, active)
      where id = v_cat_id;
    end if;
    v_cats := v_cats + 1;

    for v_item in select * from jsonb_array_elements(v_cat->'items') loop
      if exists (select 1 from menu_items where category_id = v_cat_id and name = v_item->>'name') then
        update menu_items set
          description = nullif(v_item->>'description', ''),
          price_cents = (v_item->>'price_cents')::int,
          photo_url   = nullif(v_item->>'photo_url', ''),
          available   = coalesce((v_item->>'available')::bool, true),
          track_stock = coalesce((v_item->>'track_stock')::bool, false),
          stock_qty   = coalesce((v_item->>'stock_qty')::int, 0),
          sort        = coalesce((v_item->>'sort')::int, 0)
        where category_id = v_cat_id and name = v_item->>'name';
      else
        insert into menu_items
          (category_id, name, description, price_cents, photo_url, available, track_stock, stock_qty, sort)
        values (
          v_cat_id,
          v_item->>'name',
          nullif(v_item->>'description', ''),
          (v_item->>'price_cents')::int,
          nullif(v_item->>'photo_url', ''),
          coalesce((v_item->>'available')::bool, true),
          coalesce((v_item->>'track_stock')::bool, false),
          coalesce((v_item->>'stock_qty')::int, 0),
          coalesce((v_item->>'sort')::int, 0)
        );
      end if;
      v_items := v_items + 1;
    end loop;
  end loop;

  insert into event_log (type, payload)
  values ('menu.imported', jsonb_build_object('categories', v_cats, 'items', v_items));

  return jsonb_build_object('success', true, 'categories', v_cats, 'items', v_items);
end;
$$;

grant execute on function public.import_menu(jsonb) to authenticated;
