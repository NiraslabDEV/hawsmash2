-- 1079 — pizzas, sandes e bebidas novas, à venda em Maputo.
--
-- Lista do dono (24 Set):
--   Bebidas:  Água 300 ml 30 · Água 1,5 L 90 · Compal Laranja 125 · Capi 300 ml 90
--             Garrafinha 50: Coca-Cola (Normal e Zero), Fanta e Sparletta.
--             Lata continua a 100 (já estava).
--   Pizzas:   todas a 600 — Margherita, Margherita Picante (piri-piri),
--             Cheese & Macon, Smoked Brisket.
--   Sandes:   Prego 500.
--
-- O cardápio é um só para a empresa (§5.3). O trigger da 1003 cria a linha de
-- store_items em todas as lojas; aqui os produtos NOVOS ficam desligados nas
-- outras lojas — "no Maputo" foi o pedido. Ligar na Matola é um toque no
-- painel (Cardápio / disponibilidade), não outra migration.
--
-- As garrafinhas são produtos próprios, não sabores da lata: preço diferente,
-- e no talão tem de se ler "Coca-Cola Garrafinha" — a cozinha tira do
-- frigorífico a garrafa, não a lata. Os sabores da Fanta e da Sparletta
-- espelham os da lata; o que não houver em garrafinha tira-se no painel.
--
-- Fotos (24 Set): de estúdio, geradas para esta lista, fundo transparente e o
-- logo da casa no canto — como as do resto do cardápio. Garrafinhas e água têm
-- foto por sabor/tamanho (a do cartão troca quando se escolhe).
--
-- Idempotente: tudo guardado por nome. Só os produtos criados nesta corrida são
-- desligados fora de Maputo — uma segunda corrida não desfaz o que o dono
-- entretanto ligou.

do $$
declare
  v_maputo uuid;
  v_bebidas uuid;
  v_pizzas uuid;
  v_sandes uuid;
  v_item uuid;
  v_row record;
  v_variant record;
  v_novos uuid[] := array[]::uuid[];
  v_sort int;
begin
  select id into v_maputo from public.stores where slug = 'maputo';
  if v_maputo is null then
    raise notice '1079: sem loja maputo nesta instalação — nada a fazer';
    return;
  end if;

  -- Categorias ---------------------------------------------------------------
  select id into v_bebidas from public.menu_categories where name = 'Bebidas';
  if v_bebidas is null then
    raise exception '1079: categoria Bebidas em falta';
  end if;

  select coalesce(max(sort), 0) into v_sort from public.menu_categories;

  select id into v_pizzas from public.menu_categories where name = 'Pizzas';
  if v_pizzas is null then
    insert into public.menu_categories (name, station, sort, active)
    values ('Pizzas', 'kitchen', v_sort + 1, true)
    returning id into v_pizzas;
  end if;

  select id into v_sandes from public.menu_categories where name = 'Sandes';
  if v_sandes is null then
    insert into public.menu_categories (name, station, sort, active)
    values ('Sandes', 'kitchen', v_sort + 2, true)
    returning id into v_sandes;
  end if;

  -- Produtos -----------------------------------------------------------------
  for v_row in
    select *
    from (values
      ('bebidas', 'Água',                 null::text,         3000, 20, '/assets/storefront/bebidas/agua-300.webp'),
      ('bebidas', 'Compal Laranja',       null,              12500, 21, '/assets/storefront/bebidas/compal-laranja.webp'),
      ('bebidas', 'Capi',                 '300 ml.',          9000, 22, '/assets/storefront/bebidas/capi.webp'),
      ('bebidas', 'Coca-Cola Garrafinha', 'Garrafa pequena.', 5000, 23, '/assets/storefront/bebidas/garrafinha-coca-normal.webp'),
      ('bebidas', 'Fanta Garrafinha',     'Garrafa pequena.', 5000, 24, '/assets/storefront/bebidas/garrafinha-fanta-laranja.webp'),
      ('bebidas', 'Sparletta Garrafinha', 'Garrafa pequena.', 5000, 25, '/assets/storefront/bebidas/garrafinha-sparletta-morango.webp'),
      ('pizzas',  'Pizza Margherita',         null,          60000, 1, '/assets/storefront/pizzas/margherita.webp'),
      ('pizzas',  'Pizza Margherita Picante', 'Com piri-piri.', 60000, 2, '/assets/storefront/pizzas/margherita-picante.webp'),
      ('pizzas',  'Pizza Cheese & Macon',     null,          60000, 3, '/assets/storefront/pizzas/cheese-macon.webp'),
      ('pizzas',  'Pizza Smoked Brisket',     null,          60000, 4, '/assets/storefront/pizzas/smoked-brisket.webp'),
      ('sandes',  'Prego',                    null,          50000, 1, '/assets/storefront/sandes/prego.webp')
    ) as t(categoria, name, description, price_cents, sort, photo_url)
  loop
    select id into v_item from public.menu_items where name = v_row.name;
    if v_item is null then
      insert into public.menu_items (
        category_id, name, description, photo_url, price_cents, sort, available
      ) values (
        case v_row.categoria when 'bebidas' then v_bebidas when 'pizzas' then v_pizzas else v_sandes end,
        v_row.name, v_row.description, v_row.photo_url, v_row.price_cents, v_row.sort, true
      )
      returning id into v_item;
      v_novos := array_append(v_novos, v_item);
    end if;

    -- Tamanhos e sabores: escolha única, o preço da variante é o preço final.
    for v_variant in
      select *
      from (values
        ('Água',                 '300 ml',     3000, 1, '/assets/storefront/bebidas/agua-300.webp'),
        ('Água',                 '1,5 L',      9000, 2, '/assets/storefront/bebidas/agua-1500.webp'),
        ('Coca-Cola Garrafinha', 'Normal',     5000, 1, '/assets/storefront/bebidas/garrafinha-coca-normal.webp'),
        ('Coca-Cola Garrafinha', 'Zero',       5000, 2, '/assets/storefront/bebidas/garrafinha-coca-zero.webp'),
        ('Fanta Garrafinha',     'Laranja',    5000, 1, '/assets/storefront/bebidas/garrafinha-fanta-laranja.webp'),
        ('Fanta Garrafinha',     'Uva',        5000, 2, '/assets/storefront/bebidas/garrafinha-fanta-uva.webp'),
        ('Fanta Garrafinha',     'Ananás',     5000, 3, '/assets/storefront/bebidas/garrafinha-fanta-ananas.webp'),
        ('Sparletta Garrafinha', 'Morango',    5000, 1, '/assets/storefront/bebidas/garrafinha-sparletta-morango.webp'),
        ('Sparletta Garrafinha', 'Creme Soda', 5000, 2, '/assets/storefront/bebidas/garrafinha-sparletta-creme-soda.webp')
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

  -- Só em Maputo: os produtos criados agora ficam desligados nas outras lojas.
  if array_length(v_novos, 1) > 0 then
    update public.store_items
    set available = false
    where menu_item_id = any(v_novos)
      and store_id <> v_maputo;

    update public.store_items
    set available = true
    where menu_item_id = any(v_novos)
      and store_id = v_maputo;
  end if;
end $$;
