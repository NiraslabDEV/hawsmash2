-- ============================================================================
-- 1031 — Ingredientes e ficha tecnica: leitura da EQUIPA, nao de "autenticado"
--
-- A 1024 abriu `ingredients` e `recipe_items` com `for select to authenticated
-- using (true)`. Enquanto o unico login do sistema for o da equipa isso passa
-- despercebido, porque "autenticado" e "equipa" sao o mesmo conjunto. Deixam
-- de ser no momento em que existir conta de cliente (login social ou nao): a
-- sessao do cliente chega ao Postgres com o mesmo papel `authenticated` e
-- levava consigo o custo de cada ingrediente e a ficha tecnica completa de
-- todos os produtos — o CMV da casa, numa chamada.
--
-- Esta migration existe para as instalacoes onde a 1024 ja correu; o ficheiro
-- da 1024 tambem foi corrigido para quem instalar de raiz (§11.7: forward-only
-- e idempotente, logo correr as duas em sequencia e seguro).
--
-- A chave passa a ser ter perfil activo em `staff_profiles` — o mesmo idioma
-- do `catalog_staff_select` da 1004 para o catalogo partilhado.
-- ============================================================================

drop policy if exists ingredients_select on public.ingredients;
create policy ingredients_select on public.ingredients
  for select to authenticated using ((select private.auth_role()) is not null);

drop policy if exists recipe_items_select on public.recipe_items;
create policy recipe_items_select on public.recipe_items
  for select to authenticated using ((select private.auth_role()) is not null);

-- `list_recipes()` era SECURITY DEFINER sem guarda nenhuma e com grant a
-- `authenticated` — contornava a RLS acima e devolvia o livro de receitas
-- inteiro com custo por linha. Nao precisa de privilegio proprio: le apenas
-- tabelas que a equipa ja pode ler. Passa a INVOKER e sao as policies a
-- filtrar, exactamente como a 1004 fez aos relatorios de leitura.
alter function public.list_recipes() security invoker;

revoke all on function public.list_recipes() from public, anon;
grant execute on function public.list_recipes() to authenticated;

-- ---------------------------------------------------------------------------
-- Guardrail: esta falha nao se apanha a ler codigo, apanha-se a interrogar o
-- catalogo. `using (true)` numa policy de `authenticated` e sempre um bug de
-- isolamento a espera de um segundo tipo de utilizador (§17). A funcao lista
-- as infractoras; o teste em packages/db/tests/rls-permissive.test.ts falha o
-- CI se a lista deixar de estar vazia.
--
-- So `service_role`: e ferramenta de auditoria, nao de aplicacao.
-- ---------------------------------------------------------------------------
create or replace function public.audit_permissive_policies()
returns table (table_name text, policy_name text, cmd text, roles text[])
language sql
stable
security definer
set search_path = ''
as $$
  select p.tablename::text, p.policyname::text, p.cmd::text, p.roles::text[]
  from pg_catalog.pg_policies p
  where p.schemaname = 'public'
    and p.roles::text[] && array['authenticated', 'public']
    and p.cmd <> 'INSERT'                        -- INSERT filtra por with_check
    and coalesce(btrim(p.qual), 'true') = 'true'
  order by p.tablename, p.policyname;
$$;

revoke all on function public.audit_permissive_policies() from public, anon, authenticated;
grant execute on function public.audit_permissive_policies() to service_role;
