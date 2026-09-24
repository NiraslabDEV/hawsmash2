-- 1075: dine_in é consumo na mesa, não prova criação pelo operador.
-- DECISÃO: o QR público continua online; só counter/client_sale_id identificam POS.
create or replace function private.is_pos_order(p_channel text,p_client_sale_id uuid)
returns boolean language sql immutable set search_path='' as $$
  select coalesce(p_channel='counter',false) or p_client_sale_id is not null;
$$;
revoke all on function private.is_pos_order(text,uuid) from public,anon;
grant execute on function private.is_pos_order(text,uuid) to authenticated,service_role;
notify pgrst,'reload schema';
