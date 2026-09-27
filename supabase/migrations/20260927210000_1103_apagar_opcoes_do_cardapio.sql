-- 1103 — Apagar tamanhos, adicionais e modificadores no painel.
--
-- A 1004 criou `catalog_manager_delete` (owner/manager) nas tabelas do
-- catálogo, mas o GRANT só deu insert/update ao `authenticated`. Sem o
-- privilégio de tabela a policy nunca chega a ser avaliada e o ✕ do painel
-- falhava com "permission denied for table menu_item_variants" — até ao dono.
--
-- Quem pode apagar continua a ser decidido pela policy (owner/manager); este
-- grant só deixa a policy trabalhar. Cozinha e caixa continuam sem apagar.

grant delete on public.menu_categories, public.menu_items, public.menu_item_variants,
  public.menu_addons, public.menu_modifier_groups, public.menu_modifier_options
to authenticated;
