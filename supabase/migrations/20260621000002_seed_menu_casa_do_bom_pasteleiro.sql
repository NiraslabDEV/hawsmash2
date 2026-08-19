-- ============================================================================
-- Casa do Bom Pasteleiro — cardápio inicial (a partir das fotos do cliente).
--
-- Acompanhamentos/molhos: nos Pratos Principais o cliente tem direito a
-- escolher 2 acompanhamentos + 1 molho SEM custo extra (regra do cardápio
-- físico: "NB. O cliente tem direito a escolher dois (2) acompanhantes e
-- um (1) molho"). No Pequeno-Almoço as regras são outras: tipo de ovo
-- (obrigatório, grátis), pão OU torrada (obrigatório, grátis), e até 5
-- acompanhamentos incluídos — a partir do 6º cobra-se um valor extra fixo
-- por unidade (definido em menu_modifier_groups.extra_price_cents).
--
-- photo_url fica NULL — as fotos do cliente estão em Cardapio-fotos/ na raiz
-- do repo; falta subi-las para o Storage do Supabase (ou /public/assets) e
-- atualizar aqui com a URL definitiva.
-- ============================================================================

do $$
declare
  v_cat_breakfast uuid;
  v_cat_pratos    uuid;
  v_cat_massas    uuid;
  v_cat_burgers   uuid;
  v_cat_tostas    uuid;
  v_cat_saladas   uuid;

  v_item          uuid;
  v_group         uuid;

  -- acompanhamentos partilhados (nomes) — cada prato principal tem o seu
  -- próprio conjunto de menu_modifier_options (não são globais na BD).
  v_sides text[] := array[
    'Salada', 'Vegetais Cozidos', 'Arroz Branco', 'Feijão Preto',
    'Batata Frita', 'Batata Cozida', 'Puré de Batata',
    'Puré de Batata Doce', 'Puré de Abóbora'
  ];
  v_sauces text[] := array[
    'Molho de Manteiga', 'Molho de Manteiga Picante',
    'Molho de Natas e Cogumelos', 'Molho de Azeite Alho Frito'
  ];
  v_side  text;
  v_sauce text;
  v_sort  int;

  -- pratos principais que levam o combo "2 acompanhamentos + 1 molho grátis"
  v_main_dishes text[] := array[
    'Bacalhau Assado', 'Bacalhau com Natas', 'Bitoque',
    'Fillet de Carne', 'Fillet de Peixe Grelhado', 'Picanha Grelhada',
    'Camarão Grelhado', 'Camarão Alinho', 'Strogonoff de Carne com Arroz'
  ];
  v_main_name text;
begin
  -- ── Categorias ────────────────────────────────────────────────────────────
  insert into menu_categories (name, sort, station) values ('Pequeno-Almoço', 0, 'kitchen') returning id into v_cat_breakfast;
  insert into menu_categories (name, sort, station) values ('Pratos Principais', 1, 'kitchen') returning id into v_cat_pratos;
  insert into menu_categories (name, sort, station) values ('Massas', 2, 'kitchen') returning id into v_cat_massas;
  insert into menu_categories (name, sort, station) values ('Hambúrgueres', 3, 'kitchen') returning id into v_cat_burgers;
  insert into menu_categories (name, sort, station) values ('Tostas & Sandes', 4, 'kitchen') returning id into v_cat_tostas;
  insert into menu_categories (name, sort, station) values ('Saladas', 5, 'cold_kitchen') returning id into v_cat_saladas;

  -- ── Pratos Principais ─────────────────────────────────────────────────────
  insert into menu_items (category_id, name, price_cents, sort) values
    (v_cat_pratos, 'Bacalhau Assado', 180000, 0),
    (v_cat_pratos, 'Bacalhau com Natas', 110000, 1),
    (v_cat_pratos, 'Bitoque', 75000, 2),
    (v_cat_pratos, 'Fillet de Carne', 120000, 3),
    (v_cat_pratos, 'Fillet de Peixe Grelhado', 120000, 4),
    (v_cat_pratos, 'Picanha Grelhada', 100000, 5),
    (v_cat_pratos, 'Camarão Grelhado', 120000, 6),
    (v_cat_pratos, 'Camarão Alinho', 59000, 7),
    (v_cat_pratos, 'Strogonoff de Carne com Arroz', 70000, 8);

  -- ── Massas ────────────────────────────────────────────────────────────────
  insert into menu_items (category_id, name, price_cents, sort) values
    (v_cat_massas, 'Penne Alfredo', 80000, 0),
    (v_cat_massas, 'Tagliatelle com Camarão', 80000, 1);

  -- ── Hambúrgueres ──────────────────────────────────────────────────────────
  insert into menu_items (category_id, name, price_cents, sort) values
    (v_cat_burgers, 'Smash Single Burguer', 50000, 0),
    (v_cat_burgers, 'Smash Burguer c/ Ovo', 40000, 1),
    (v_cat_burgers, 'Smash Duplo', 60000, 2),
    (v_cat_burgers, 'Smoked Brisket Smash Burguer', 60000, 3);

  -- ── Tostas & Sandes ───────────────────────────────────────────────────────
  insert into menu_items (category_id, name, price_cents, sort) values
    (v_cat_tostas, 'Tosta Pão de Água', 15000, 0),
    (v_cat_tostas, 'Prego no Pão', 40000, 1),
    (v_cat_tostas, 'Tosta Mista', 35000, 2),
    (v_cat_tostas, 'Tosta de Queijo Cheddar com Pastrami', 45000, 3);

  -- ── Saladas ───────────────────────────────────────────────────────────────
  insert into menu_items (category_id, name, price_cents, sort) values
    (v_cat_saladas, 'Salada Caesar', 35000, 0),
    (v_cat_saladas, 'Salada Grega', 35000, 1),
    (v_cat_saladas, 'Salada de Frango ou Atum', 45000, 2);

  -- ── Combo "2 acompanhamentos + 1 molho grátis" em cada prato principal ────
  foreach v_main_name in array v_main_dishes
  loop
    select id into v_item from menu_items where category_id = v_cat_pratos and name = v_main_name;

    insert into menu_modifier_groups (menu_item_id, name, selection_type, min_select, max_select, free_quantity, extra_price_cents, sort)
    values (v_item, 'Acompanhamentos', 'multi', 2, 2, 2, 0, 0)
    returning id into v_group;
    v_sort := 0;
    foreach v_side in array v_sides loop
      insert into menu_modifier_options (group_id, name, sort) values (v_group, v_side, v_sort);
      v_sort := v_sort + 1;
    end loop;

    insert into menu_modifier_groups (menu_item_id, name, selection_type, min_select, max_select, free_quantity, extra_price_cents, sort)
    values (v_item, 'Molho', 'single', 1, 1, 1, 0, 1)
    returning id into v_group;
    v_sort := 0;
    foreach v_sauce in array v_sauces loop
      insert into menu_modifier_options (group_id, name, sort) values (v_group, v_sauce, v_sort);
      v_sort := v_sort + 1;
    end loop;
  end loop;

  -- ── Pequeno-Almoço ────────────────────────────────────────────────────────
  -- Preço base é um valor de referência — ajustar no admin conforme o dono definir.
  insert into menu_items (category_id, name, description, price_cents, sort)
  values (
    v_cat_breakfast,
    'Pequeno-Almoço Casa do Bom Pasteleiro',
    'Escolha o tipo de ovo, pão ou torrada, e até 5 acompanhamentos incluídos. Acompanhamentos extra a partir do 6º cobram um valor adicional.',
    35000,
    0
  )
  returning id into v_item;

  -- Tipo de ovo — obrigatório, escolha única, sem custo.
  insert into menu_modifier_groups (menu_item_id, name, selection_type, min_select, max_select, free_quantity, extra_price_cents, sort)
  values (v_item, 'Tipo de Ovo', 'single', 1, 1, 1, 0, 0)
  returning id into v_group;
  insert into menu_modifier_options (group_id, name, sort) values
    (v_group, 'Estrelado', 0),
    (v_group, 'Mexido', 1),
    (v_group, 'Cozido', 2),
    (v_group, 'Escalfado', 3);

  -- Pão ou torrada — obrigatório, escolha única, sem custo.
  insert into menu_modifier_groups (menu_item_id, name, selection_type, min_select, max_select, free_quantity, extra_price_cents, sort)
  values (v_item, 'Pão ou Torrada', 'single', 1, 1, 1, 0, 1)
  returning id into v_group;
  insert into menu_modifier_options (group_id, name, sort) values
    (v_group, 'Pão', 0),
    (v_group, 'Torrada', 1);

  -- Acompanhamentos — até 5 grátis; a partir do 6º, 60 MT cada (valor equilibrado
  -- face ao preço base do pequeno-almoço). Máximo 9 (todos os acompanhamentos).
  insert into menu_modifier_groups (menu_item_id, name, selection_type, min_select, max_select, free_quantity, extra_price_cents, sort)
  values (v_item, 'Acompanhamentos', 'multi', 0, 9, 5, 6000, 2)
  returning id into v_group;
  v_sort := 0;
  foreach v_side in array v_sides loop
    insert into menu_modifier_options (group_id, name, sort) values (v_group, v_side, v_sort);
    v_sort := v_sort + 1;
  end loop;
end $$;
