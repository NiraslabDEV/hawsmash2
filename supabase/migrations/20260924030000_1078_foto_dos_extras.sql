-- 1078 — a foto de cada extra.
--
-- Pedido do dono (24 Set): no passo Extras do balcão, cada botão (queijo,
-- bacon, carne, jalapeño, picles) leva a foto do ingrediente. Reconhece-se de
-- relance, que é o que um ecrã de balcão precisa.
--
-- A foto é do adicional (`menu_addons.photo_url`), escolhida no painel do
-- Cardápio. É dado, não código (§18.2): o produto traz uma galeria de fotos
-- genéricas de ingredientes, mas qual delas vai para qual extra decide-o a loja.
--
-- O get_menu passa a devolver `photo_url` em cada adicional. Faz-se como na
-- 1060: o get_menu anterior fica em private e este acrescenta a foto por cima,
-- sem reescrever o cardápio. Idempotente.

alter table public.menu_addons
  add column if not exists photo_url text null;

comment on column public.menu_addons.photo_url is
  'Foto do extra no botão do POS (1078). Caminho público, ex. /assets/storefront/extras/queijo.webp. Null = botão só com texto.';

do $$
begin
  if to_regprocedure('private.get_menu_before_addon_photos(text,text,boolean)') is null then
    alter function public.get_menu(text, text, boolean) set schema private;
    alter function private.get_menu(text, text, boolean) rename to get_menu_before_addon_photos;
  end if;
end;
$$;

revoke all on function private.get_menu_before_addon_photos(text, text, boolean)
  from public, anon, authenticated;

create or replace function public.get_menu(
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
  v_menu jsonb;
  v_categories jsonb := '[]'::jsonb;
  v_category jsonb;
  v_items jsonb;
  v_item jsonb;
  v_addons jsonb;
  v_addon jsonb;
begin
  v_menu := private.get_menu_before_addon_photos(p_store_slug, p_channel, p_include_unavailable);

  for v_category in select value from jsonb_array_elements(coalesce(v_menu -> 'categories', '[]'::jsonb))
  loop
    v_items := '[]'::jsonb;
    for v_item in select value from jsonb_array_elements(coalesce(v_category -> 'items', '[]'::jsonb))
    loop
      if jsonb_typeof(v_item -> 'addons') = 'array' and jsonb_array_length(v_item -> 'addons') > 0 then
        v_addons := '[]'::jsonb;
        for v_addon in select value from jsonb_array_elements(v_item -> 'addons')
        loop
          v_addons := v_addons || jsonb_build_array(v_addon || jsonb_build_object(
            'photo_url',
            (select a.photo_url from public.menu_addons a where a.id::text = v_addon ->> 'id')
          ));
        end loop;
        v_item := v_item || jsonb_build_object('addons', v_addons);
      end if;
      v_items := v_items || jsonb_build_array(v_item);
    end loop;
    v_categories := v_categories || jsonb_build_array(v_category || jsonb_build_object('items', v_items));
  end loop;

  return v_menu || jsonb_build_object('categories', v_categories);
end;
$$;

revoke all on function public.get_menu(text, text, boolean) from public;
grant execute on function public.get_menu(text, text, boolean) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
