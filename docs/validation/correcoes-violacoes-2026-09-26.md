# 1097–1099 — correcção das violações da auditoria de 26/09

Data: 2026-09-26. Branch: `fix/violacoes-spec`. Auditoria: [AUDITORIA-DOCUMENTACAO §5.1](../AUDITORIA-DOCUMENTACAO.md).

SHA-256 do SQL em UTF-8, com finais de linha LF:

| Migration | SHA-256 |
|---|---|
| `20260926180000_1097_estado_e_pagamento_por_perfil.sql` | `c57a2ce5f7f64571b61ae22e7fb909c97bf63128438c5043021f8013a28e6699` |
| `20260926180100_1098_sangria_idempotente.sql` | `e8945189d38e548a4fc0afdb2ec740541379688e538d155c41fa89fa015da8e6` |
| `20260926180200_1099_isolamento_de_dados.sql` | `f4eedc5ff77f4770cb018c850542100a0fedffcd24b2c1eb6880be70876182d7` |

## Onde correu

PostgreSQL através de **PGlite 0.3.16**, numa pasta temporária — sem Docker (o motor local
estava em erro) e **sem tocar em nenhuma base remota**. Um bootstrap mínimo reproduz o que as
migrations esperam do Supabase: papéis `anon`/`authenticated`/`service_role`, a tabela de utilizadores do Auth,
`auth.uid()`/`auth.jwt()` a partir de `request.jwt.claims`, as tabelas de buckets e objectos do
Storage com RLS, `pgcrypto` e `uuid-ossp` em `extensions`. Correram as **152 migrations** da árvore
local e o `supabase/seed.sql`. Cada cenário corre com `set local role` e as claims do
utilizador, como o PostgREST faria.

Os scripts e os logs ficaram na pasta output/violacoes (artefactos locais ignorados pelo Git):
db.mjs, fixtures.mjs, scen-1097.mjs, regress.mjs, stores-read.mjs, vermelho.log, verde.log e
regressao.log. Correr: `node scen-1097.mjs` (com as correcções) ou `node scen-1097.mjs --sem-correcao`.

## Resultado

| Corrida | Resultado |
|---|---|
| Cenários **sem** 1097–1099 (schema antigo) | **22 falhas** em 42 — cada violação reproduzida |
| Cenários **com** 1097–1099 | **42/42** |
| Reaplicar as três migrations por cima | sem erro (idempotentes) |
| Fluxos vizinhos: abrir turno, venda, despesa com chave, fechar turno, fecho do dia, esgotado pela RPC, chamar senha, aprovação com comanda da casa | **11/11** |
| Equipa (4 perfis) lê `short_name`/`accepting_orders` das lojas; gerente lê as definições da empresa | **5/5** |

A primeira corrida vermelha mostrou 23 falhas; uma era do próprio cenário (entregar uma venda
paga sem passar por "pronto") e foi corrigida no teste, não no SQL.

Foi verificado:

- **V-14** — cozinha não aprova nem recusa; caixa aprova e recusa pedido por aprovar; caixa não
  cancela pedido aprovado nem venda paga; gerente cancela e `void_sale` continua a funcionar;
  cozinha põe em preparo e marca pronto; caixa chama a senha e entrega; Matola não toca em
  Maputo; `service_role` mantém todos os eventos.
- **V-15** — gerente e caixa não chamam `confirm_payment`; `service_role` confirma.
- **V-16** — com `enqueue_kitchen_tickets` a lançar erro, aprovação e confirmação gravam; fica
  `print.enqueue_failed` no `event_log` e a comanda antiga na fila.
- **V-13** — a mesma chave duas vezes devolve o mesmo movimento (uma linha); mesma chave com
  outro valor → `request_id_reused`; sem chave funciona como antes.
- **V-01** — `anon` não chama `identify_customer` nem `get_customer_orders`; o caixa chama.
- **V-02** — caixa de Maputo lê o comprovativo de Maputo; caixa da Matola e cozinha não; dono
  lê todos; ninguém da equipa apaga; `anon` e equipa continuam a enviar.
- **V-04** — gerente não muda `stock_qty`, dono não muda `price_cents_override` por UPDATE;
  gerente marca esgotado; gerente da Matola não mexe em Maputo; `adjust_store_stock` funciona.
- **V-05** — caixa não lê atribuição sem loja; dono lê.

## O que isto não prova

- **Não** correu contra o Supabase real: PostgREST, Storage API e GoTrue foram substituídos por
  SQL directo com as mesmas claims. O gate em supabase-js
  (`packages/db/tests/permissoes-e-isolamento.test.ts`) cobre os mesmos casos e **ainda não
  correu** — precisa de `supabase start` ou de uma base de ensaio sem bridge viva.
- **Não** foi aplicada em staging nem em produção. O staging é usado pela loja de Maputo: aplicar
  fora do horário (§18.4), primeiro a migration, depois o deploy do código.
- O caminho `createSignedUrl` do Storage foi aproximado por um `select` na tabela de objectos do
  Storage, que é o que a Storage API verifica.
