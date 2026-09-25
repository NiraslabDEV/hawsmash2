-- 1094 — Água das Pedras em garrafinha de vidro e Creme Café.
--
-- Lista do dono (25 Set), tudo a 150:
--   Água das Pedras (garrafinha de vidro): Natural, Limão, Morango, Maracujá,
--                                          Tangerina e Açaí.
--   Creme Café: café gelado.
--
-- A Água das Pedras é um produto com seis sabores (escolha única), como as
-- garrafinhas da 1079: no talão lê-se "Água das Pedras · Limão" e cada sabor tem
-- a sua foto. O Creme Café é um produto simples.
--
-- Lojas: ao contrário da 1079, o pedido não restringe a loja, e as bebidas da
-- 1079 já foram ligadas na Matola pelo painel. Fica o comportamento de sempre
-- do cardápio partilhado (§5.3): o trigger da 1003 cria store_items disponível
-- em todas as lojas. Desligar numa loja é um toque no painel.
--
-- Fotos (25 Set): de estúdio, geradas para esta lista, fundo transparente e o
-- logo da casa no canto — como as da 1079.
--
-- Idempotente: tudo guardado por nome.

do $$
declare
  v_bebidas uuid;
  v_item uuid;
  v_row record;
  v_variant record;
begin
  select id into v_bebidas from public.menu_categories where name = 'Bebidas';
  if v_bebidas is null then
    raise notice '1094: sem categoria Bebidas nesta instalação — nada a fazer';
    return;
  end if;

  for v_row in
    select *
    from (values
      ('Água das Pedras', 'Garrafinha de vidro, com gás.', 15000, 26, '/assets/storefront/bebidas/pedras-natural.webp'),
      ('Creme Café',      'Café gelado.',                  15000, 27, '/assets/storefront/bebidas/creme-cafe.webp')
    ) as t(name, description, price_cents, sort, photo_url)
  loop
    select id into v_item from public.menu_items where name = v_row.name;
    if v_item is null then
      insert into public.menu_items (
        category_id, name, description, photo_url, price_cents, sort, available
      ) values (
        v_bebidas, v_row.name, v_row.description, v_row.photo_url,
        v_row.price_cents, v_row.sort, true
      )
      returning id into v_item;
    end if;

    -- Sabores: escolha única, o preço da variante é o preço final.
    for v_variant in
      select *
      from (values
        ('Água das Pedras', 'Natural',   15000, 1, '/assets/storefront/bebidas/pedras-natural.webp'),
        ('Água das Pedras', 'Limão',     15000, 2, '/assets/storefront/bebidas/pedras-limao.webp'),
        ('Água das Pedras', 'Morango',   15000, 3, '/assets/storefront/bebidas/pedras-morango.webp'),
        ('Água das Pedras', 'Maracujá',  15000, 4, '/assets/storefront/bebidas/pedras-maracuja.webp'),
        ('Água das Pedras', 'Tangerina', 15000, 5, '/assets/storefront/bebidas/pedras-tangerina.webp'),
        ('Água das Pedras', 'Açaí',      15000, 6, '/assets/storefront/bebidas/pedras-acai.webp')
      ) as v(item_name, name, price_cents, sort, photo_url)
      where v.item_name = v_row.name
    loop
      if not exists (
        select 1 from public.menu_item_variants
        where menu_item_id = v_item and name = v_variant.name
      ) then
        insert into public.menu_item_variants (
          menu_item_id, name, price_cents, sort, is_default, active, photo_url
        ) values (
          v_item, v_variant.name, v_variant.price_cents, v_variant.sort,
          v_variant.sort = 1, true, v_variant.photo_url
        );
      end if;
    end loop;
  end loop;
end $$;
