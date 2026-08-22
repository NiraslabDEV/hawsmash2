-- HAWSMASH 2.0 — seed local/staging.
-- Nunca é a fonte de dados comerciais de produção; a F9 importa o HAWSMASH 1.0.

do $$
declare
  v_maputo uuid := '00000000-0000-4000-8000-000000000101';
  v_matola uuid := '00000000-0000-4000-8000-000000000102';
  v_burgers uuid;
  v_sobremesas uuid;
  v_extras uuid;
  v_bebidas uuid;
  v_drink record;
  v_drink_id uuid;
  v_classic uuid;
  v_double uuid;
  v_brisket uuid;
  v_nata uuid;
begin
  insert into public.settings (
    id, open_hour, close_hour, slot_minutes, accepting_orders, payment_provider
  ) values (
    1, 10, 22, 30, true, 'manual'
  )
  on conflict (id) do nothing;

  -- DECISÃO confirmada pelo cliente em 2026-08-19: as duas lojas usam os
  -- mesmos números e titulares do HAWSMASH actual.
  update public.stores
  set accepting_orders = true,
      payment_provider = 'manual',
      mpesa_number = '847955382',
      mpesa_name = 'Soeil Nissar',
      emola_number = '870909080',
      emola_name = 'Mehzabin Ibrahim'
  where id in (v_maputo, v_matola);

  delete from public.store_hours;
  -- DECISÃO confirmada: Maputo mantém o horário actual; Matola usa os mesmos
  -- dias e fecha à mesma hora, abrindo às 12:00.
  insert into public.store_hours (store_id, dow, opens, closes, active) values
    (v_maputo, 4, '11:00', '21:30', true),
    (v_maputo, 5, '11:00', '21:30', true),
    (v_maputo, 6, '11:00', '21:30', true),
    (v_matola, 4, '12:00', '21:30', true),
    (v_matola, 5, '12:00', '21:30', true),
    (v_matola, 6, '12:00', '21:30', true);

  delete from public.delivery_zones;
  -- O 1.0 cobra uma taxa plana confirmada de 150 MT em Maputo.
  -- BLOQUEIO: B-002 — as zonas e taxas da Matola ainda não vieram do cliente.
  -- Fica uma zona PLACEHOLDER_ZONA à mesma taxa para o fluxo de entrega poder
  -- ser testado ponta a ponta; `scripts/check-placeholders.mjs` impede que
  -- sobreviva ao go-live.
  insert into public.delivery_zones (
    store_id, name, fee_cents, active, sort
  ) values
    (v_maputo, 'Maputo', 15000, true, 1),
    (v_matola, 'PLACEHOLDER_ZONA', 15000, true, 1);

  -- Remove o catálogo demonstrativo herdado do Casa do Bom Pasteleiro.
  delete from public.menu_items;
  delete from public.menu_categories;

  insert into public.menu_categories (name, station, sort, active)
  values
    ('Burgers', 'kitchen', 1, true),
    ('Bebidas', 'bar', 2, true),
    ('Acompanhamentos', 'kitchen', 3, true),
    ('Sobremesas', 'cold_kitchen', 4, true);

  select id into v_burgers
  from public.menu_categories where name = 'Burgers';
  select id into v_sobremesas
  from public.menu_categories where name = 'Sobremesas';
  select id into v_extras
  from public.menu_categories where name = 'Acompanhamentos';
  select id into v_bebidas
  from public.menu_categories where name = 'Bebidas';

  -- Descrições e fotos: as mesmas que o HAWSMASH 1.0 já vende (a lista de
  -- ingredientes é o que aparece por baixo do nome no cartão do produto).
  insert into public.menu_items (
    category_id, name, description, photo_url, price_cents, sort, available
  ) values (
    v_burgers, 'Classic Smash',
    'Pão Brioche · Carne Smash Suculenta · Queijo Cheddar · Cebola Caramelizada · Jalapeños · Pickles · Molho Hawsmash',
    '/assets/hawsmash/classic-smash.webp', 30000, 1, true
  ) returning id into v_classic;

  insert into public.menu_items (
    category_id, name, description, photo_url, price_cents, sort, available
  ) values (
    v_burgers, 'Double Smash',
    'Pão Brioche · 2 Carnes Smash Suculentas · Queijo Cheddar · Cebola Caramelizada · Jalapeños · Pickles · Molho Hawsmash',
    '/assets/hawsmash/double-smash.webp', 40000, 2, true
  ) returning id into v_double;

  insert into public.menu_items (
    category_id, name, description, photo_url, price_cents, sort, available
  ) values (
    v_burgers, 'Smoked Brisket',
    'Pão Brioche · Carne Smash Suculenta · Smoked Brisket · Cebola Caramelizada · Jalapeños · Pickles · Molho Hawsmash',
    '/assets/hawsmash/smoked-brisket.webp', 45000, 3, true
  ) returning id into v_brisket;

  insert into public.menu_items (
    category_id, name, description, photo_url, price_cents, sort, available
  ) values
    (v_burgers, 'Hawsmash Signature',
     'Pão Brioche · Carne Hawsmash Suculenta · Carne Wagyu · Smoked Brisket · Queijo Cheddar · Cebola Caramelizada · Jalapeños · Pickles · Molho Hawsmash',
     '/assets/hawsmash/hawsmash-signature.webp', 60000, 4, true),
    (v_sobremesas, 'Pastéis de Nata',
     'Massa folhada estaladiça · Creme de ovos · Canela',
     '/assets/hawsmash/pasteis-de-nata.webp', 9000, 1, true),
    (v_extras, 'Joe''s Chips',
     'Batata frita estaladiça · Sal marinho',
     '/assets/hawsmash/joes-chips.webp', 15000, 1, true);

  insert into public.menu_item_variants (
    menu_item_id, name, price_cents, sort, is_default, active
  ) values
    (v_classic, 'HAW', 30000, 1, true, true),
    (v_classic, 'WAGYU', 40000, 2, false, true),
    (v_double, 'HAW', 40000, 1, true, true),
    (v_double, 'WAGYU', 50000, 2, false, true),
    (v_brisket, 'HAW', 45000, 1, true, true),
    (v_brisket, 'WAGYU', 50000, 2, false, true);

  select id into v_nata
  from public.menu_items where name = 'Pastéis de Nata';

  insert into public.menu_item_variants (
    menu_item_id, name, price_cents, sort, is_default, active
  ) values
    (v_nata, '1 unidade', 9000, 1, true, true),
    (v_nata, '6 unidades', 50000, 2, false, true);

  -- Bebidas herdadas do HAWSMASH 1.0: cada bebida é um item com sabores, e cada
  -- sabor tem a sua foto (a foto do cartão troca com o sabor escolhido).
  -- Todas nascem marcadas para o upsell — são o que se oferece no fim do pedido.
  for v_drink in
    select *
    from (values
      ('Coca-Cola',        10000, 1, '/assets/hawsmash/bebidas/coca-normal.webp'),
      ('Sprite',           10000, 2, '/assets/hawsmash/bebidas/sprite.webp'),
      ('Fanta',            10000, 3, '/assets/hawsmash/bebidas/fanta-laranja.webp'),
      ('Schweppes',        10000, 4, '/assets/hawsmash/bebidas/schweppes-pomegranate.webp'),
      ('Sparletta',        10000, 5, '/assets/hawsmash/bebidas/sparletta-morango.webp'),
      ('Red Bull',         15000, 6, '/assets/hawsmash/bebidas/redbull-normal.webp'),
      ('Red Bull Edition', 15000, 7, '/assets/hawsmash/bebidas/redbull-peach.webp')
    ) as d(name, price_cents, sort, photo_url)
  loop
    insert into public.menu_items (
      category_id, name, description, photo_url, price_cents, sort, available, is_upsell
    ) values (
      v_bebidas, v_drink.name, 'Bebida gelada.', v_drink.photo_url,
      v_drink.price_cents, v_drink.sort, true, true
    )
    returning id into v_drink_id;

    insert into public.menu_item_variants (
      menu_item_id, name, price_cents, sort, is_default, active, photo_url
    )
    select v_drink_id, f.name, v_drink.price_cents, f.sort, f.sort = 1, true, f.photo_url
    from (values
      ('Coca-Cola',        'Normal',      1, '/assets/hawsmash/bebidas/coca-normal.webp'),
      ('Coca-Cola',        'Zero',        2, '/assets/hawsmash/bebidas/coca-zero.webp'),
      ('Fanta',            'Laranja',     1, '/assets/hawsmash/bebidas/fanta-laranja.webp'),
      ('Fanta',            'Uva',         2, '/assets/hawsmash/bebidas/fanta-uva.webp'),
      ('Fanta',            'Ananás',      3, '/assets/hawsmash/bebidas/fanta-ananas.webp'),
      ('Schweppes',        'Pomegranate', 1, '/assets/hawsmash/bebidas/schweppes-pomegranate.webp'),
      ('Schweppes',        'Pineapple',   2, '/assets/hawsmash/bebidas/schweppes-pineapple.webp'),
      ('Schweppes',        'Tangerine',   3, '/assets/hawsmash/bebidas/schweppes-tangerine.webp'),
      ('Schweppes',        'Ginger Ale',  4, '/assets/hawsmash/bebidas/schweppes-ginger.webp'),
      ('Sparletta',        'Morango',     1, '/assets/hawsmash/bebidas/sparletta-morango.webp'),
      ('Sparletta',        'Creme Soda',  2, '/assets/hawsmash/bebidas/sparletta-creme-soda.webp'),
      ('Red Bull',         'Normal',      1, '/assets/hawsmash/bebidas/redbull-normal.webp'),
      ('Red Bull',         'Zero',        2, '/assets/hawsmash/bebidas/redbull-zero.webp'),
      ('Red Bull Edition', 'Peach',       1, '/assets/hawsmash/bebidas/redbull-peach.webp'),
      ('Red Bull Edition', 'Tangerine',   2, '/assets/hawsmash/bebidas/redbull-tangerine.webp'),
      ('Red Bull Edition', 'Watermelon',  3, '/assets/hawsmash/bebidas/redbull-watermelon.webp'),
      ('Red Bull Edition', 'Yellow',      4, '/assets/hawsmash/bebidas/redbull-yellow.webp')
    ) as f(item_name, name, sort, photo_url)
    where f.item_name = v_drink.name;
  end loop;

  -- Acompanhamentos que também entram no upsell.
  update public.menu_items
  set is_upsell = true
  where name in ('Joe''s Chips', 'Pastéis de Nata');

  -- DECISÃO confirmada: preços iguais nas duas lojas via override NULL.
  update public.store_items set price_cents_override = null;

  -- O singleton conserva apenas configuração global usada pelo motor herdado.
  update public.settings
  set mpesa_number = null,
      mpesa_name = null,
      emola_number = null,
      emola_name = null,
      pickup_address = null,
      pickup_maps_url = null,
      accepting_orders = true,
      payment_provider = 'manual'
  where id = 1;
end $$;
