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

## 1. MODO DE TRABALHO — corrida contínua

> **Não pares para perguntar.** Avança até ao fim do `ROADMAP.md`. O que não der para fechar,
> **regista em [`BLOQUEIOS.md`](BLOQUEIOS.md), contorna, e continua.** No fim entregas a corrida completa
> **mais** a lista do que ficou pelo caminho, agrupada por quem a desbloqueia. É essa lista que se ataca de uma
> vez só — não uma pergunta de cada vez, ao longo de dias.

### 1.1 O ciclo, por item do ROADMAP

1. **Ler antes de escrever:** `CLAUDE.md` inteiro (uma vez por corrida) + o item que vais fazer.
2. **Testes primeiro** em tudo o que seja domínio: dinheiro, estado do pedido, RLS, idempotência, stock, caixa.
   Nenhuma lógica destas entra sem um teste escrito **antes**, que falhe primeiro.
3. **Implementar o mínimo** que faz o teste passar e serve o item. Nada de features de fases futuras.
4. **Fechar o item:** `pnpm lint && pnpm test` verdes → marcar no ROADMAP → **commit** convencional em
   português (`feat(pos): …`, `fix(caixa): …`, `chore(db): …`).
5. **Item seguinte.** Sem pausa, sem relatório intermédio, sem pedir confirmação.

**Marcadores no ROADMAP:** `[ ]` por fazer · `[x]` feito · `[x] ⏳` feito, falta validar em runtime/hardware ·
`[~] B-0NN` bloqueado e registado.

### 1.2 Bloqueio ou decisão tua? (o teste dos 3 segundos)

Antes de registar um bloqueio, pergunta: **"se eu escolher mal, o que custa corrigir?"**

| Custa… | Então | Exemplo |
|---|---|---|
| **Editar um dado** (preço, número, horário, texto, cor) | **Não é bloqueio.** Põe um `PLACEHOLDER_*` óbvio, regista `B-0NN` e segue | zona de entrega da Matola |
| **Trocar uma configuração** (env, flag, chave) | **Não é bloqueio.** Deixa a env vazia com fallback seguro, regista e segue | chave do Resend |
| **Reescrever código ou schema** | **Decide tu** pela opção **mais reversível**, isola atrás de interface/flag, comenta `// DECISÃO:` e regista | uma conta Paysuite vs várias |
| **Nada — falta acesso/segredo/hardware** | Constrói contra **mock/simulador**, testa contra o mock, regista `B-0NN` | gaveta física, BD do 1.0 |
| **Perder dados, gastar dinheiro real, expor segredo** | **PARA.** Escreve em `BLOQUEIOS.md → PARAGENS REAIS` e termina a corrida | correr o import contra produção |

Na dúvida entre duas opções igualmente defensáveis: escolhe a **mais simples de desfazer**, escreve porquê
com `// DECISÃO:`, e segue. Uma decisão registada vale mais do que uma pergunta pendente.

### 1.3 As três paragens reais (e só estas)

- **Destrutivo/irreversível:** apagar dados, correr migrations contra a BD do HAWSMASH 1.0, `--force` em produção.
- **Dinheiro real:** qualquer chamada que cobre, transfira ou subscreva.
- **Segurança:** algo que exponha service key, chave de pagamento ou dados de clientes.

Fora destes três, **não existe motivo para parar**. Falta de resposta não é motivo. Ambiguidade não é motivo.

### 1.4 A árvore fica sempre verde

Um bloqueio **nunca** deixa o repositório partido:
- código dependente do que falta fica atrás de **flag** ou **stub** com comportamento seguro e definido;
- o teste que precisa da resposta fica `it.skip('B-0NN: …')` — com o ID no nome, para se voltar a ligar;
- `pnpm lint && pnpm test` continuam verdes ao fim de **cada commit**. Sem excepção.

Se um item bloqueado partiria a árvore, não o metas pela metade: regista, **reverte o que ficou pendurado** e
passa ao seguinte.

### 1.5 Placeholders são detectáveis, nunca plausíveis

Dado inventado leva prefixo **`PLACEHOLDER_`** (`PLACEHOLDER_ZONA`, `PLACEHOLDER_RODAPE`).
Nunca inventes algo que **pareça real** — um número M-Pesa plausível chega à produção sem ninguém notar; um
`PLACEHOLDER_` não. Escreve um teste/guard que **falha se algum `PLACEHOLDER_` sobreviver ao build de produção**.

### 1.6 Ritmo

- Um **commit por item** fechado. Nada de um commit gigante no fim.
- Actualiza `ROADMAP.md` e `BLOQUEIOS.md` **no mesmo commit** do trabalho a que dizem respeito.
- Nunca `push` para `main`. Trabalha em `dev`.

### 1.7 Segunda passagem

Chegado ao fim do ROADMAP, **volta ao topo do `BLOQUEIOS.md`**: algum ficou desbloqueado entretanto (por
trabalho posterior, não por resposta humana)? Fecha esses. Só depois escreves o relatório.

### 1.8 Relatório final (o entregável da corrida)

Preenche a secção **PACOTE FINAL** do `BLOQUEIOS.md`:
- perguntas **para o cliente**, redigidas em português simples, numeradas, prontas a copiar para uma mensagem;
- decisões e acessos **para o Gabriel** (custo, credenciais, contas);
- o que só se valida **com hardware**, e quanto tempo demora;
- tabela **ordenada por impacto na abertura**: sem isto, o que é que a loja não consegue fazer no dia 1.

E na resposta final: o que ficou a funcionar ponta a ponta, o que está feito mas por validar, e o número de
bloqueios abertos por categoria. **Sem floreados e sem dar por concluído o que não foi verificado.**

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
- **Durante a corrida não se pergunta nada** — dúvida vira entrada em `BLOQUEIOS.md` (§1.2) e o trabalho segue.
- No fim da corrida, dizer com clareza: o que ficou a funcionar, o que está feito mas por validar, e quantos
  bloqueios ficaram abertos por categoria. **Não declarar concluído o que não foi verificado.**
- Decisão tomada por falta de resposta → comentar no código com `// DECISÃO:` e listar no relatório final.

---

## 6. Nunca

Ver a lista completa em `CLAUDE.md §17`. Os cinco que partem o negócio:

- ❌ Bloquear uma venda por causa de impressora, rede, email ou pixel.
- ❌ Criar venda no POS sem `client_sale_id`.
- ❌ Policy sem filtro de loja.
- ❌ SQL manual em produção, ou merge em `main` sem passar por staging com testes verdes.
- ❌ Apagar registo de venda, anulação ou movimento de caixa.

E o que trava a corrida:

- ❌ **Parar para perguntar** algo que cabe numa entrada de `BLOQUEIOS.md`.
- ❌ Deixar a árvore vermelha, ou trabalho meio-feito pendurado, por causa de um bloqueio.
- ❌ Inventar um dado **plausível** em vez de um `PLACEHOLDER_` detectável.
