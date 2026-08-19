-- ============================================================================
-- Hardening: fechar RPCs de gestão ao anon
-- O Supabase concede EXECUTE a PUBLIC por defeito nas funções do schema public,
-- e o anon herda de PUBLIC. As RPCs de gestão (0003/0005) só faziam `grant to
-- authenticated`, deixando a grant PUBLIC ativa → anon conseguia chamá-las.
-- advance_order/get_orders/get_order_stats NÃO têm check de auth.uid() →
-- exposição real. Revogamos de PUBLIC (o grant explícito a authenticated mantém-se).
--
-- anon mantém-se SÓ nas RPCs públicas da loja:
--   get_menu, create_order, get_order_status, attach_payment_proof,
--   submit_feedback, join_waitlist
-- ============================================================================

revoke execute on function public.advance_order(uuid, text, text)  from public;
revoke execute on function public.get_orders(jsonb)                from public;
revoke execute on function public.get_order_stats()                from public;
revoke execute on function public.open_cash_session()              from public;
revoke execute on function public.close_cash_session(int, text)    from public;
revoke execute on function public.get_cash_dashboard()             from public;

-- Re-garantir o staff autenticado (idempotente).
grant execute on function public.advance_order(uuid, text, text)   to authenticated;
grant execute on function public.get_orders(jsonb)                 to authenticated;
grant execute on function public.get_order_stats()                 to authenticated;
grant execute on function public.open_cash_session()               to authenticated;
grant execute on function public.close_cash_session(int, text)     to authenticated;
grant execute on function public.get_cash_dashboard()              to authenticated;

-- Helper interno: não chamável via API por ninguém
-- (as RPCs SECURITY DEFINER que o usam correm como owner, não são afetadas).
revoke execute on function public._confirmed_orders_in_period(timestamptz, timestamptz) from public;

-- Bucket público menu-photos: objetos servidos por URL não precisam de policy
-- de SELECT; remover evita listagem de todos os ficheiros pelo anon.
drop policy if exists "menu_photos_anon_select" on storage.objects;
