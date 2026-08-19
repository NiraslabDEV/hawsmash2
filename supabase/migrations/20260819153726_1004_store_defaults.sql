-- Decisão do cliente (2026-08-19): as duas lojas usam os mesmos números e
-- preços. Maputo conserva o horário actual; Matola abre uma hora mais tarde.
do $$
declare
  v_maputo uuid;
  v_matola uuid;
begin
  select id into strict v_maputo from public.stores where slug = 'maputo';
  select id into strict v_matola from public.stores where slug = 'matola';

  update public.stores
  set accepting_orders = true,
      payment_provider = 'manual',
      mpesa_number = '847955382',
      mpesa_name = 'Soeil Nissar',
      emola_number = '870909080',
      emola_name = 'Mehzabin Ibrahim'
  where id in (v_maputo, v_matola);

  delete from public.store_hours
  where store_id in (v_maputo, v_matola);

  insert into public.store_hours (store_id, dow, opens, closes, active) values
    (v_maputo, 4, '11:00', '21:30', true),
    (v_maputo, 5, '11:00', '21:30', true),
    (v_maputo, 6, '11:00', '21:30', true),
    (v_matola, 4, '12:00', '21:30', true),
    (v_matola, 5, '12:00', '21:30', true),
    (v_matola, 6, '12:00', '21:30', true);

  update public.store_items
  set price_cents_override = null
  where store_id in (v_maputo, v_matola);
end $$;
