-- ============================================================================
-- Casa do Bom Pasteleiro — fotos dos pratos existentes + 2 novos cortes nobres
-- (Tomahawk 500gr, Rib Eye Swiss Butter) com o mesmo combo de acompanhamentos
-- + molho grátis já usado nos outros Pratos Principais.
-- ============================================================================

do $$
declare
  v_cat_pratos uuid;
  v_item       uuid;
  v_group      uuid;

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

  v_new_dishes text[] := array['Tomahawk 500 gr', 'Rib Eye Swiss Butter'];
  v_name       text;
begin
  -- ── Fotos dos itens já existentes ──────────────────────────────────────────
  update menu_items set photo_url = '/assets/casa-do-bom-pasteleiro/bacalhau-assado.png' where name = 'Bacalhau Assado';
  update menu_items set photo_url = '/assets/casa-do-bom-pasteleiro/bacalhau-com-natas.png' where name = 'Bacalhau com Natas';
  update menu_items set photo_url = '/assets/casa-do-bom-pasteleiro/bitoque.png' where name = 'Bitoque';
  update menu_items set photo_url = '/assets/casa-do-bom-pasteleiro/fillet-de-carne.png' where name = 'Fillet de Carne';
  update menu_items set photo_url = '/assets/casa-do-bom-pasteleiro/fillet-de-peixe-grelhado.png' where name = 'Fillet de Peixe Grelhado';
  update menu_items set photo_url = '/assets/casa-do-bom-pasteleiro/picanha-grelhada.png' where name = 'Picanha Grelhada';
  update menu_items set photo_url = '/assets/casa-do-bom-pasteleiro/camarao-grelhado.png' where name = 'Camarão Grelhado';
  update menu_items set photo_url = '/assets/casa-do-bom-pasteleiro/camarao-alinho.png' where name = 'Camarão Alinho';
  update menu_items set photo_url = '/assets/casa-do-bom-pasteleiro/estrogonofe.png' where name = 'Strogonoff de Carne com Arroz';
  update menu_items set photo_url = '/assets/casa-do-bom-pasteleiro/penne-alfredo.png' where name = 'Penne Alfredo';
  update menu_items set photo_url = '/assets/casa-do-bom-pasteleiro/tagliatelle-camarao.png' where name = 'Tagliatelle com Camarão';
  update menu_items set photo_url = '/assets/casa-do-bom-pasteleiro/smash-single.png' where name = 'Smash Single Burguer';
  update menu_items set photo_url = '/assets/casa-do-bom-pasteleiro/smash-burguer-ovo.png' where name = 'Smash Burguer c/ Ovo';
  update menu_items set photo_url = '/assets/casa-do-bom-pasteleiro/smash-duplo.png' where name = 'Smash Duplo';
  update menu_items set photo_url = '/assets/casa-do-bom-pasteleiro/smoked-brisket-smash.png' where name = 'Smoked Brisket Smash Burguer';
  update menu_items set photo_url = '/assets/casa-do-bom-pasteleiro/tosta-pao-agua.png' where name = 'Tosta Pão de Água';
  update menu_items set photo_url = '/assets/casa-do-bom-pasteleiro/prego-no-pao.png' where name = 'Prego no Pão';
  update menu_items set photo_url = '/assets/casa-do-bom-pasteleiro/tosta-mista.png' where name = 'Tosta Mista';
  update menu_items set photo_url = '/assets/casa-do-bom-pasteleiro/tosta-queijo-pastrami.png' where name = 'Tosta de Queijo Cheddar com Pastrami';
  update menu_items set photo_url = '/assets/casa-do-bom-pasteleiro/salada-caesar.png' where name = 'Salada Caesar';
  update menu_items set photo_url = '/assets/casa-do-bom-pasteleiro/salada-grega.png' where name = 'Salada Grega';
  update menu_items set photo_url = '/assets/casa-do-bom-pasteleiro/salada-frango-atum.png' where name = 'Salada de Frango ou Atum';
  -- 'Pequeno-Almoço Casa do Bom Pasteleiro' fica sem foto (não há asset correspondente).

  -- ── Novos cortes nobres em Pratos Principais ───────────────────────────────
  select id into v_cat_pratos from menu_categories where name = 'Pratos Principais';

  insert into menu_items (category_id, name, description, price_cents, photo_url, sort) values
    (v_cat_pratos, 'Tomahawk 500 gr', 'Grelhado com temperos especiais, legumes e manteiga de ervas.', 120000, '/assets/casa-do-bom-pasteleiro/tomahawk.jpg', 9),
    (v_cat_pratos, 'Rib Eye Swiss Butter', 'Suculento rib eye grelhado, molho cremoso de manteiga e ervas. Batata, salada e pão.', 120000, '/assets/casa-do-bom-pasteleiro/rib-aye.jpg', 10);

  -- ── Combo "2 acompanhamentos + 1 molho grátis" também nos novos cortes ─────
  foreach v_name in array v_new_dishes
  loop
    select id into v_item from menu_items where category_id = v_cat_pratos and name = v_name;

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
end $$;
