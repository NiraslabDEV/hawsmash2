-- 1035 — grants das tabelas da conta do cliente.
--
-- A 1034 criou `customer_addresses`, `customer_devices` e
-- `customer_login_codes` com RLS ligada, mas sem grants: no staging nem o
-- `service_role` as lia (`permission denied`, 42501). A aplicação nunca deu
-- por isso — fala com elas só por RPCs SECURITY DEFINER, que correm como dono
-- e não passam por grant nenhum. Quem deu por isso foi o teste de integração,
-- ao tentar confirmar que o token é guardado em hash.
--
-- Aproveita-se para apertar o que a 1034 tinha deixado largo:
--
-- A policy `staff_read` em `customer_addresses` sai. Foi escrita a pensar em
-- "a equipa precisa da morada para entregar" — e não precisa: a morada da
-- entrega vive em `orders.address`, congelada no momento do pedido, que é a
-- que interessa ao estafeta. O livro de moradas do cliente é dele. Menos um
-- sítio por onde a morada de alguém pode sair.
--
-- Fica só `service_role` com leitura, porque é o que corre do lado do
-- servidor e nos testes. `anon` e `authenticated` não têm nada em nenhuma das
-- três — o browser chega às moradas pela RPC com token, e mais nada.

drop policy if exists "staff_read" on public.customer_addresses;

revoke all on table public.customer_addresses   from anon, authenticated;
revoke all on table public.customer_devices     from anon, authenticated;
revoke all on table public.customer_login_codes from anon, authenticated;

grant select on table public.customer_addresses   to service_role;
grant select on table public.customer_devices     to service_role;
grant select on table public.customer_login_codes to service_role;
