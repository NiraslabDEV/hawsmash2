-- ============================================================================
-- Fix: adjust_stock() grava menu_items.updated_at, mas a coluna nunca existiu
-- na tabela (só em orders/cash_sessions). Descoberto ao correr
-- packages/db/tests/stock.test.ts (e) contra Supabase local pela 1ª vez.
-- ============================================================================

alter table public.menu_items
  add column if not exists updated_at timestamptz not null default now();
