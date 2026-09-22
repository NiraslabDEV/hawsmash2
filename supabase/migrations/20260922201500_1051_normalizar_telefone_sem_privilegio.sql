-- HAWSMASH 2.0 — 1051: normalizar o telefone deixa de exigir privilégio a quem escreve.
--
-- A 1038 pôs o telefone canónico (só dígitos, os últimos 9) em duas triggers
-- alojadas em `private`. Ficaram `security invoker`, e por isso quem escreve
-- precisa de `usage` no schema `private` — que só o `authenticated` alguma vez
-- teve (a 1001 revoga-o a todos, a 1004 concede-o a esse). Qualquer escrita
-- directa em `orders` ou `customers` com a chave de serviço morre em
-- `42501 permission denied for schema private`.
--
-- O site não sente isto: todas as escritas passam por RPC `security definer`,
-- que corre como o dono. Quem sente é o `scripts/import-hawsmash-1.ts`, que
-- insere `orders` e `customers` directamente — o script do cutover do §15. Uma
-- falha ali é uma falha no dia em que o 1.0 passa o testemunho ao 2.0.
--
-- A correcção é pôr as duas triggers a correr como dono, e não alargar o
-- `private` a mais ninguém. É deliberado: dar `usage` ao service_role abriria-
-- -lhe a caixa inteira de ajudantes de RLS (`auth_can_store`,
-- `auth_default_store_id`) só para acertar o formato de um telefone. Estas duas
-- funções reescrevem uma coluna de texto da linha que está a ser gravada — não
-- lêem nem escrevem mais nada, e por isso ser `definer` não amplia o que
-- ninguém alcança.

create or replace function private.normalize_orders_customer_phone()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.customer_phone := private.normalize_phone(new.customer_phone);
  return new;
end;
$$;

create or replace function private.normalize_customers_phone()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.phone := private.normalize_phone(new.phone);
  return new;
end;
$$;

-- As triggers já existem desde a 1038 e continuam a apontar para estas mesmas
-- funções; o `create or replace` acima basta. Ficam aqui recriadas à mesma para
-- que aplicar esta migration num projecto novo, do zero, dê o mesmo resultado.
drop trigger if exists orders_normalize_customer_phone on public.orders;
create trigger orders_normalize_customer_phone
before insert or update of customer_phone on public.orders
for each row execute function private.normalize_orders_customer_phone();

drop trigger if exists customers_normalize_phone on public.customers;
create trigger customers_normalize_phone
before insert or update of phone on public.customers
for each row execute function private.normalize_customers_phone();
