# AGENTS.md — regras de trabalho no HAWSMASH 2.0

> Para qualquer agente de código (Codex, Claude Code, outro) que trabalhe neste repositório.
> **A spec do produto é o [`CLAUDE.md`](CLAUDE.md). O plano é o [`ROADMAP.md`](ROADMAP.md).**
> Este ficheiro diz **como** trabalhar. Não repete a spec — se houver divergência, manda o `CLAUDE.md`.

---

## 0. O que está em jogo

Este sistema vai cobrar ao balcão de **duas lojas** que abrem no mesmo dia, receber delivery, imprimir na
cozinha, controlar estoque e fechar caixa. **Uma venda perdida é dinheiro real perdido do cliente.** Um bug de
RLS mistura o dinheiro de duas lojas. Um pedido duplicado cobra duas vezes a uma pessoa que está no balcão.
Trabalha com esse peso: preferir sempre a opção **mais simples e mais verificável**.

---

## 1. Ciclo de trabalho (obrigatório)

1. **Ler antes de escrever:** `CLAUDE.md` inteiro + a fase actual do `ROADMAP.md`.
2. **Declarar o plano:** antes de tocar em código, listar (a) ficheiros a criar/alterar, (b) migrations,
   (c) testes que vais escrever. Se houver ambiguidade de âmbito, **perguntar** — não inventar.
3. **Testes primeiro** em tudo o que seja domínio: dinheiro, estado do pedido, RLS, idempotência, stock, caixa.
   Nenhuma lógica destas entra sem um teste escrito **antes** que falhe primeiro.
4. **Implementar o mínimo** que faz o teste passar e serve a fase. Nada de features da fase seguinte.
5. **Fechar:** `pnpm lint && pnpm test` verdes + checklist da fase marcado + commit convencional
   (`feat(pos): …`, `fix(caixa): …`, `chore(db): …`) em português.
6. **Uma fase por sessão.** Não juntar fases.

---

## 2. Invariantes — verificar em cada mudança

Antes de dar uma tarefa por concluída, percorrer esta lista. Se alguma falhar, a tarefa não está feita.

- [ ] **Dinheiro:** centavos inteiros; nenhum float; toda a formatação por `packages/core/src/money.ts` (`formatMT`).
- [ ] **Preço do servidor:** nenhum caminho aceita preço, taxa, desconto ou troco vindos do cliente/POS.
- [ ] **Loja:** toda a linha nova tem `store_id`; toda a query nova é filtrada por loja; nenhuma policy `using (true)`.
- [ ] **Idempotência:** operação que cria dinheiro ou papel tem chave única e é segura em retry.
- [ ] **Best-effort:** impressora, email, tracking, CAPI e realtime nunca bloqueiam nem revertem uma venda.
- [ ] **Auditoria:** acção sensível (aprovar, anular, gaveta, sangria, fecho, preço, stock manual) grava
      `event_log` com `actor_user_id` + `store_id`.
- [ ] **Estado do pedido:** só muda por `advance_order`; nunca `update orders set status = …` no cliente.
- [ ] **Segredos:** nada de service key, chave Paysuite, CAPI ou Resend em código que chega ao browser.
- [ ] **Fuso:** guardar UTC, apresentar Africa/Maputo.
- [ ] **Migrations:** versionada, idempotente, forward-only, uma por assunto, aplicada primeiro em staging.

---

## 3. Onde mexer (mapa rápido)

| Preciso de… | Vai a |
|---|---|
| regra de dinheiro / estado / validação | `packages/core/src/` (+ testes em `__tests__`) |
| schema, RPC, RLS | `supabase/migrations/1NNN_*.sql` (+ `packages/db/tests/rls.test.ts`) |
| POS | `apps/web/app/(pos)/pos/` |
| painel | `apps/web/app/(admin)/` |
| loja pública | `apps/web/app/(public)/` |
| TVs / KDS | `apps/web/app/(tv)/` |
| impressão, gaveta, bridge | `services/print-bridge/src/` |
| pagamento automático | `packages/paysuite/` + `apps/web/lib/payments/` |
| tracking | `apps/web/lib/analytics/track.ts` (**único** sítio que toca `dataLayer`/`fbq`/`gtag`) |

**Reaproveitar antes de inventar.** O motor herdado está descrito em `docs/engine/DELIVERY-OS-CLAUDE.md` e o
HAWSMASH 1.0 (a correr em produção há meses) em `docs/legacy/`. Antes de escrever algo de raiz, procurar lá:
máquina de estados, money, Paysuite, print-bridge, fecho de caixa, talão ESC/POS validado em papel, empacotamento
`.exe` da impressora.

---

## 4. Erros que este produto já cometeu (não repetir)

Cada um custou uma sessão de debug em produção. Estão aqui para não voltarem.

1. **Realtime a construir estado** → pedidos apareciam sem itens. O evento só dispara `refetch()`.
2. **Caixa desde a meia-noite UTC** → o fecho não batia. Contar sempre **desde o último fecho**, no fuso da loja.
3. **API a cortar às 1000 linhas em silêncio** → relatórios errados. Paginar sempre, explicitamente.
4. **Preço hardcoded em dois sítios** (frontend e função) → divergiram. Preço vive só na BD.
5. **Bucket privado acedido por URL pública** → 400. Só `createSignedUrl`.
6. **Um só Supabase para staging e produção** → toda a migration ia a live. No 2.0 são dois projectos.
7. **`select *` em RPC pública** → risco de expor colunas novas (custo, margem). Listar colunas sempre.

---

## 5. Comunicação

- **Português (pt-PT)** em UI, mensagens de erro, emails, talões, commits e documentação.
- Moeda **MT** (`formatMT`), nunca `MTn` do `Intl` com `currency: 'MZN'`.
- Ao terminar uma tarefa, dizer com clareza: o que ficou feito, o que ficou por fazer, o que precisa de
  validação com hardware ou com o cliente. **Não declarar concluído o que não foi verificado.**
- Decisão tomada por falta de resposta → comentar no código com `// DECISÃO:` e listar na resposta final.

---

## 6. Nunca

Ver a lista completa em `CLAUDE.md §17`. Os cinco que partem o negócio:

- ❌ Bloquear uma venda por causa de impressora, rede, email ou pixel.
- ❌ Criar venda no POS sem `client_sale_id`.
- ❌ Policy sem filtro de loja.
- ❌ SQL manual em produção, ou merge em `main` sem passar por staging com testes verdes.
- ❌ Apagar registo de venda, anulação ou movimento de caixa.
