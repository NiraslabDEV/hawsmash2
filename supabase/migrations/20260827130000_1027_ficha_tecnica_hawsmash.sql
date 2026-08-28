-- HAWSMASH 2.0 — 1027: os ingredientes e a ficha técnica que o HAWSMASH usa.
--
-- Dados, não estrutura. É o retrato do que o Ridwan quer controlar hoje:
-- as duas carnes, o queijo em fatias, o bacon em fatias e o brisket à porção.
-- Tudo o resto (pão, molho, pickles, cebola, jalapeño) fica de fora até haver
-- contagem e custo reais — meter um custo inventado seria pior do que não ter
-- custo nenhum, porque a margem passaria a mentir com ar de certa.
--
-- Idempotente: corre-se as vezes que forem precisas. Os custos e as fichas
-- passam a editar-se no painel; esta migration só garante o ponto de partida.

do $$
declare
  v_carne_raw uuid;
  v_carne_wagyu uuid;
  v_queijo uuid;
  v_bacon uuid;
  v_brisket uuid;
  v_item record;
  v_variant record;
begin
  -- ---------------------------------------------------------------------
  -- Ingredientes. Custo por unidade, em centavos.
  -- Confirmados pelo cliente: carne RAW 75 MT, carne WAGYU 100 MT.
  -- Por confirmar (ficam a 0 e aparecem no painel como "custo por preencher"):
  -- queijo, bacon e brisket.
  -- BLOQUEIO: B-020
  -- ---------------------------------------------------------------------
  insert into public.ingredients (name, unit, cost_cents, sort)
  values
    ('Carne RAW',            'un', 7500,  1),
    ('Carne WAGYU',          'un', 10000, 2),
    ('Brisket (porção)',     'un', 0,     3),
    ('Queijo cheddar (fatia)', 'un', 0,   4),
    ('Bacon (fatia)',        'un', 0,     5)
  on conflict (name) do nothing;

  select id into v_carne_raw   from public.ingredients where name = 'Carne RAW';
  select id into v_carne_wagyu from public.ingredients where name = 'Carne WAGYU';
  select id into v_brisket     from public.ingredients where name = 'Brisket (porção)';
  select id into v_queijo      from public.ingredients where name = 'Queijo cheddar (fatia)';
  select id into v_bacon       from public.ingredients where name = 'Bacon (fatia)';

  -- ---------------------------------------------------------------------
  -- Ficha técnica.
  --
  -- Linha sem variante = vale para todas (o queijo é o mesmo em HAW e WAGYU).
  -- Linha com variante = é o que separa a carne RAW da WAGYU, e é a razão de
  -- tudo isto: até aqui as duas descontavam o mesmo saldo.
  --
  -- Quantidade de carne por variante, por produto:
  --   Classic  → 1     Double → 2     Brisket → 1     Signature → 1 de cada
  -- ---------------------------------------------------------------------
  for v_item in
    select mi.id, mi.name,
      case mi.name
        when 'Classic Smash'  then 1
        when 'Double Smash'   then 2
        when 'Smoked Brisket' then 1
      end as carnes
    from public.menu_items mi
    where mi.name in ('Classic Smash', 'Double Smash', 'Smoked Brisket')
  loop
    -- Carne: por variante.
    for v_variant in
      select mv.id, mv.name
      from public.menu_item_variants mv
      where mv.menu_item_id = v_item.id
        and mv.name in ('HAW', 'WAGYU')
    loop
      insert into public.recipe_items (menu_item_id, variant_id, ingredient_id, qty)
      values (
        v_item.id,
        v_variant.id,
        case when v_variant.name = 'WAGYU' then v_carne_wagyu else v_carne_raw end,
        v_item.carnes
      )
      on conflict (
        menu_item_id, ingredient_id,
        coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
      ) do nothing;
    end loop;

    -- Queijo: o Classic e o Double levam cheddar; o Smoked Brisket, pela
    -- descrição do cardápio, não leva. Leva brisket.
    if v_item.name in ('Classic Smash', 'Double Smash') then
      insert into public.recipe_items (menu_item_id, variant_id, ingredient_id, qty)
      values (v_item.id, null, v_queijo, 1)
      on conflict (
        menu_item_id, ingredient_id,
        coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
      ) do nothing;
    else
      insert into public.recipe_items (menu_item_id, variant_id, ingredient_id, qty)
      values (v_item.id, null, v_brisket, 1)
      on conflict (
        menu_item_id, ingredient_id,
        coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
      ) do nothing;
    end if;
  end loop;

  -- Signature: sem variantes, leva uma carne de cada, brisket e cheddar.
  for v_item in
    select mi.id from public.menu_items mi where mi.name = 'Hawsmash Signature'
  loop
    insert into public.recipe_items (menu_item_id, variant_id, ingredient_id, qty)
    values
      (v_item.id, null, v_carne_raw,   1),
      (v_item.id, null, v_carne_wagyu, 1),
      (v_item.id, null, v_brisket,     1),
      (v_item.id, null, v_queijo,      1)
    on conflict (
      menu_item_id, ingredient_id,
      coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
    ) do nothing;
  end loop;

  -- O bacon (v_bacon) fica criado e contável, mas ainda sem ficha: falta saber
  -- em que produto ou adicional ele sai.
  -- BLOQUEIO: B-020

  -- Os ingredientes nascem com track = false (1024): só travam a venda depois
  -- de a loja fazer a primeira contagem e ligar o controlo no painel.
end $$;
