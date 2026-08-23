-- 1017 — dinheiro é visível por PERFIL, não só por loja.
--
-- As políticas de leitura de caixa e pagamentos gateavam só por
-- `private.auth_can_store(store_id)`. Isso cumpre a Regra 3 (isolamento entre
-- lojas) mas não cumpre o `CLAUDE.md §6`, que é explícito quanto ao perfil
-- `kitchen`: "ver pedidos e avançar estado. Não vê dinheiro."
--
-- Medido em staging antes desta migration: a conta de cozinha lia
-- `cash_sessions` com `expected_cash_cents` e `payments` com `amount_cents`.
--
-- A cozinha continua a ver `orders` — precisa deles para cozinhar. O que deixa
-- de ver é a decomposição do dinheiro.
--
-- Forward-only e idempotente: cada policy é largada antes de recriada.

-- Caixa: sessões do turno
drop policy if exists cash_sessions_store_select on public.cash_sessions;
create policy cash_sessions_store_select on public.cash_sessions
for select to authenticated
using (
  (select private.auth_can_store(store_id))
  and (select private.auth_role()) in ('owner', 'manager', 'cashier')
);

-- Caixa: sangrias, reforços, despesas
drop policy if exists cash_movements_store_select on public.cash_movements;
create policy cash_movements_store_select on public.cash_movements
for select to authenticated
using (
  (select private.auth_can_store(store_id))
  and (select private.auth_role()) in ('owner', 'manager', 'cashier')
);

-- Pagamentos: método e valor de cada recebimento
drop policy if exists payments_store_select on public.payments;
create policy payments_store_select on public.payments
for select to authenticated
using (
  (select private.auth_can_store(store_id))
  and (select private.auth_role()) in ('owner', 'manager', 'cashier')
);

comment on policy cash_sessions_store_select on public.cash_sessions is
  'Loja + perfil. A cozinha nao ve dinheiro (CLAUDE.md 6).';
comment on policy cash_movements_store_select on public.cash_movements is
  'Loja + perfil. A cozinha nao ve dinheiro (CLAUDE.md 6).';
comment on policy payments_store_select on public.payments is
  'Loja + perfil. A cozinha nao ve dinheiro (CLAUDE.md 6).';
