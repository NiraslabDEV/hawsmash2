-- ============================================================================
-- Fix: apps/web/app/(admin)/menu-section.tsx já usa `parent_id` (categoria-mãe
-- → subcategorias) e @delivery/core.buildCategoryTree/findNode/collectDescendantIds
-- para renderizar a árvore, mas a coluna nunca foi criada em nenhuma migration
-- anterior (regressão introduzida antes de 20260619000001_promo_categories.sql,
-- nunca detectada porque o build de `web` não estava a correr em CI/deploy).
-- ============================================================================

alter table public.menu_categories
  add column if not exists parent_id uuid references public.menu_categories(id) on delete set null;

create index if not exists menu_categories_parent_id_idx on public.menu_categories(parent_id);
