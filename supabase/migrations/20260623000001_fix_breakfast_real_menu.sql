-- ============================================================================
-- Corrige o Pequeno-Almoço com o cartaz real do cliente ("Breakfast à Sua
-- Maneira", 495 MT): tipos de ovo, tipo de pão e a lista real de
-- acompanhamentos (bem diferente da lista genérica usada como placeholder).
-- ============================================================================

do $$
declare
  v_egg_group   uuid;
  v_bread_group uuid;
  v_sides_group uuid;
  v_side text;
  v_sort int;
  v_sides text[] := array[
    'Feijão Doce', 'Cogumelos', 'Tomate Grelhado', 'Batata Frita', 'Batata Doce',
    'Pastrami (2 fatias)', 'Corned Beef (2 fatias)', 'Bacon (2 fatias)',
    'Salame (4 fatias)', 'Chili French Polony (2 fatias)', 'French Polony (2 fatias)',
    'Salsicha Russian (1 unid)', 'Viena (1 unid)', 'Salsicha Picante (1 unid)',
    'Hambúrguer (1 unid)'
  ];
begin
  select g.id into v_egg_group from menu_modifier_groups g
    join menu_items i on i.id = g.menu_item_id
    where i.name = 'Pequeno-Almoço Casa do Bom Pasteleiro' and g.name = 'Tipo de Ovo';

  select g.id into v_bread_group from menu_modifier_groups g
    join menu_items i on i.id = g.menu_item_id
    where i.name = 'Pequeno-Almoço Casa do Bom Pasteleiro' and g.name = 'Pão ou Torrada';

  select g.id into v_sides_group from menu_modifier_groups g
    join menu_items i on i.id = g.menu_item_id
    where i.name = 'Pequeno-Almoço Casa do Bom Pasteleiro' and g.name = 'Acompanhamentos';

  -- Ovos: 5 opções reais do cartaz.
  delete from menu_modifier_options where group_id = v_egg_group;
  insert into menu_modifier_options (group_id, name, sort) values
    (v_egg_group, 'Estrelado (2 Unid)', 0),
    (v_egg_group, 'Omolete Simples', 1),
    (v_egg_group, 'Omolete c/ Queijo', 2),
    (v_egg_group, 'Omolette Mista', 3),
    (v_egg_group, 'Ovos Mexidos', 4);

  -- Pão: passa a ser tipo de pão (Normal/Integral/Água), não "pão vs torrada".
  update menu_modifier_groups set name = 'Pão' where id = v_bread_group;
  delete from menu_modifier_options where group_id = v_bread_group;
  insert into menu_modifier_options (group_id, name, sort) values
    (v_bread_group, 'Normal', 0),
    (v_bread_group, 'Integral', 1),
    (v_bread_group, 'Água', 2);

  -- Acompanhamentos: lista real do cartaz (15 opções). Mantém a regra de
  -- negócio já combinada — até 5 grátis, 60 MT cada extra.
  update menu_modifier_groups
    set max_select = array_length(v_sides, 1)
    where id = v_sides_group;
  delete from menu_modifier_options where group_id = v_sides_group;
  v_sort := 0;
  foreach v_side in array v_sides loop
    insert into menu_modifier_options (group_id, name, sort) values (v_sides_group, v_side, v_sort);
    v_sort := v_sort + 1;
  end loop;
end $$;
