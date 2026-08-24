-- ============================================================================
-- 1019 — corrige "permission denied for view funnel_rates" na aba Análise.
--
-- Causa: 1004_staff_rls.sql (20260819144028) fez `revoke all on all tables
-- in schema public from public, anon` — isto atinge tabelas E views — e depois
-- re-concedeu select a `authenticated` só numa lista de tabelas. As views
-- `funnel_rates` e `funnel_by_source` (criadas em 20260614000017) ficaram de
-- fora da lista. get_funnel_metrics() é security invoker desde essa mesma
-- migration (linha 501), por isso corre com os privilégios de quem chama —
-- e o staff autenticado deixou de conseguir ler as views.
-- ============================================================================

grant select on public.funnel_rates, public.funnel_by_source to authenticated;
