# Migration 1045 — SQL em Postgres local

Executado em 2026-09-13T23:05:33.765Z, com PGlite 0.4.1, Postgres em memória.

PostgreSQL 17.5 on wasm32-unknown-linux-gnu, compiled by emcc (Emscripten gcc/clang-like replacement + linker emulating GNU ld) 3.1.74 (1092ec30a3fb1d46b1782ff1b4db5094d3d06ae5), 32-bit

130 pedidos sintéticos, duas lojas, um item por pedido e datas com empates. RPCs executadas como authenticated.

- RPC anterior: 2 casos passaram, 22 falharam.
- Migration 1045: 24 casos passaram, 0 falharam.
- Reaplicação da migration: passou.
- SECURITY INVOKER confirmado no catálogo; anon sem EXECUTE confirmado.

| Caso | Anterior | 1045 |
|---|---|---|
| default limit 100 em 130 pedidos | Falhou | Passou |
| primeira página de 10 e total 130 | Falhou | Passou |
| offset 100 devolve página de 10 e total 130 | Falhou | Passou |
| última página parcial de 5 | Falhou | Passou |
| página vazia preserva total 130 | Falhou | Passou |
| loja Maputo total 100 | Falhou | Passou |
| loja Matola total 30 | Falhou | Passou |
| loja inexistente total zero | Falhou | Passou |
| channel delivery total 65 | Falhou | Passou |
| statuses ready/paid total 44 exclui delivered/cancelled | Falhou | Passou |
| statuses ready/paid + channel delivery total 22 | Falhou | Passou |
| status paid total 43 | Falhou | Passou |
| loja + channel + status | Falhou | Passou |
| pesquisa número de pedido | Falhou | Passou |
| pesquisa nome de cliente case insensitive | Passou | Passou |
| pesquisa telefone | Passou | Passou |
| pesquisa sem resultados | Falhou | Passou |
| datas inclusivas + timezone Maputo | Falhou | Passou |
| flow e fulfillment type | Falhou | Passou |
| limite máximo 500 | Falhou | Passou |
| limite mínimo 1 com zero | Falhou | Passou |
| limite mínimo 1 com negativo | Falhou | Passou |
| offset mínimo zero | Falhou | Passou |
| empates created_at atravessam página | Falhou | Passou |

## Limites

- Schema mínimo sintético; não carrega as migrations da instalação.
- Não testa RLS da instalação, Supabase/PostgREST, staging, concorrência ou desempenho.
- Nenhuma credencial nem base de dados externa utilizada.

Resultados completos: pglite-1045-results.json. Script: verify-1045-pglite.mjs. Dependência instalada offline na cache TEMP indicada ao executar; sem alterações a package.json/lockfile do repositório.

Migration verificada: 20260913225235_1045_paginacao_pedidos.sql.
SHA-256: 307A42FF0CFDE51744252CE9295D6439BC3BB46D07DB2590D5B5A77AB63D25A5

O runner transitório e os resultados completos ficaram em output/orders nesta sessão (artefactos ignorados pelo Git). O ensaio reproduzível da instalação está em supabase/tests/orders_pagination.sql e continua por executar no stack completo.
