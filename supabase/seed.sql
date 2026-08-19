-- HAWSMASH 2.0 — seed local/staging.
-- Nunca é a fonte de dados comerciais de produção; a F9 importa o HAWSMASH 1.0.

do $$
declare
  v_maputo uuid := '00000000-0000-4000-8000-000000000101';
  v_matola uuid := '00000000-0000-4000-8000-000000000102';
  v_burgers uuid;
  v_sobremesas uuid;
  v_extras uuid;
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
  insert into public.delivery_zones (
    store_id, name, fee_cents, active, sort
  ) values (
    v_maputo, 'Maputo', 15000, true, 1
  );

  -- Remove o catálogo demonstrativo herdado do Casa do Bom Pasteleiro.
  delete from public.menu_items;
  delete from public.menu_categories;

  insert into public.menu_categories (name, station, sort, active)
  values
    ('Burgers', 'kitchen', 1, true),
    ('Sobremesas', 'cold_kitchen', 2, true),
    ('Extras', 'kitchen', 3, true);

  select id into v_burgers
  from public.menu_categories where name = 'Burgers';
  select id into v_sobremesas
  from public.menu_categories where name = 'Sobremesas';
  select id into v_extras
  from public.menu_categories where name = 'Extras';

  insert into public.menu_items (
    category_id, name, description, price_cents, sort, available
  ) values (
    v_burgers, 'Classic Smash', 'Smash burger artesanal HAWSMASH.', 30000, 1, true
  ) returning id into v_classic;

  insert into public.menu_items (
    category_id, name, description, price_cents, sort, available
  ) values (
    v_burgers, 'Double Smash', 'Double smash burger artesanal HAWSMASH.', 40000, 2, true
  ) returning id into v_double;

  insert into public.menu_items (
    category_id, name, description, price_cents, sort, available
  ) values (
    v_burgers, 'Smoked Brisket', 'Smash burger com brisket fumado.', 45000, 3, true
  ) returning id into v_brisket;

  insert into public.menu_items (
    category_id, name, description, price_cents, sort, available
  ) values
    (v_burgers, 'Hawsmash Signature', 'Burger assinatura HAWSMASH.', 60000, 4, true),
    (v_sobremesas, 'Pastéis de Nata', 'Pastéis de nata.', 9000, 1, true),
    (v_extras, 'Joe''s Chips', 'Batata frita Joe''s Chips.', 15000, 1, true);

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
