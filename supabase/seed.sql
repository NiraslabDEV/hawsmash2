-- Seed demo para o Delivery OS (pnpm db:seed / supabase db reset)
-- Dados de exemplo para o restaurante "Restaurante Demo" em Maputo.

do $$
declare
  v_cat_pratos   uuid;
  v_cat_bebidas  uuid;
  v_cat_sobrem   uuid;
begin

  -- Settings (singleton)
  insert into settings (
    id, mpesa_number, mpesa_name, emola_number, emola_name,
    pickup_address, pickup_maps_url, owner_email,
    open_hour, close_hour, slot_minutes,
    accepting_orders, payment_provider
  ) values (
    1,
    '84 123 4567', 'Demo Restaurante',
    '86 123 4567', 'Demo Restaurante',
    'Av. Julius Nyerere, 1234, Maputo',
    'https://maps.google.com/?q=-25.9653,32.5892',
    'dono@demo.mz',
    10, 22, 30,
    true, 'manual'
  ) on conflict (id) do update set
    mpesa_number     = excluded.mpesa_number,
    accepting_orders = excluded.accepting_orders;

  -- Categorias
  insert into menu_categories (name, station, sort) values
    ('Pratos Principais', 'kitchen',      1),
    ('Bebidas',           'bar',          2),
    ('Sobremesas',        'cold_kitchen', 3)
  on conflict do nothing;

  select id into v_cat_pratos  from menu_categories where name = 'Pratos Principais';
  select id into v_cat_bebidas from menu_categories where name = 'Bebidas';
  select id into v_cat_sobrem  from menu_categories where name = 'Sobremesas';

  -- Itens (~8 em centavos MZN)
  insert into menu_items (category_id, name, description, price_cents, sort) values
    (v_cat_pratos,  'Frango Grelhado',       'Frango inteiro grelhado com batata e salada',     45000, 1),
    (v_cat_pratos,  'Caril de Camarao',      'Camarao em caril com arroz e coco',               65000, 2),
    (v_cat_pratos,  'Moamba de Galinha',     'Galinha com mandioca, ginguba e farofa',           55000, 3),
    (v_cat_pratos,  'Pescado Grelhado',      'Peixe fresco grelhado com legumes da epoca',       50000, 4),
    (v_cat_bebidas, 'Cerveja Nacional 500ml','Gelada',                                           8000,  1),
    (v_cat_bebidas, 'Suco Natural',          'Laranja, maracuja ou manga',                       6000,  2),
    (v_cat_bebidas, 'Agua Mineral 500ml',    '',                                                  3000,  3),
    (v_cat_sobrem,  'Pudim de Leite',        'Com calda de caramelo',                            12000, 1)
  on conflict do nothing;

  -- Zonas de entrega
  insert into delivery_zones (name, fee_cents, sort) values
    ('Polana / Sommerschield',  5000, 1),
    ('Miramar / Alto Mae',      7000, 2),
    ('Matola',                 15000, 3)
  on conflict do nothing;

end $$;
