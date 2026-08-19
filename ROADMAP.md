# ROADMAP.md — HAWSMASH 2.0 · execução por fases

> **Como usar — corrida contínua.** O agente percorre este ficheiro **de cima a baixo sem parar**.
> O que não der para fechar vai para [`BLOQUEIOS.md`](BLOQUEIOS.md) e o trabalho **continua no item seguinte**.
> Regras completas em [`AGENTS.md §1`](AGENTS.md). Nada de perguntar a meio; nada de esperar por respostas.

## PROMPT ÚNICO — colar uma vez e deixar correr

```
Lê CLAUDE.md, AGENTS.md e BLOQUEIOS.md.

Executa o ROADMAP.md de cima a baixo, sem parar, começando no primeiro item por fazer.

Para cada item: testes primeiro no que for domínio (dinheiro, estado, RLS, idempotência,
stock, caixa), implementação mínima, `pnpm lint && pnpm test` verdes, marcar no ROADMAP,
commit convencional em português. Depois passa imediatamente ao item seguinte.

Se algo não der para fechar (falta resposta do cliente, acesso, segredo ou hardware):
aplica o teste dos 3 segundos do AGENTS.md §1.2 — decide tu o que for reversível,
usa PLACEHOLDER_* para dados, isola atrás de flag/stub o que depender de terceiros,
regista uma entrada B-0NN em BLOQUEIOS.md, marca o item [~] B-0NN, e CONTINUA.

Só paras se algo for destrutivo, gastar dinheiro real ou expor um segredo — nesse caso
escreve em BLOQUEIOS.md > PARAGENS REAIS e termina.

No fim: segunda passagem aos bloqueios (fecha os que já ficaram resolvidos por trabalho
posterior) e preenche a secção PACOTE FINAL do BLOQUEIOS.md.
```

*(Os PROMPTs por fase, mais abaixo, servem para repetir ou retomar uma fase isolada — não para a corrida.)*

**Legenda:** 🔴 bloqueia a abertura · 🟡 bloqueia a operação confortável · 🟢 melhoria
**Estado:** `[ ]` por fazer · `[x]` feito · `[x] ⏳` feito, falta validar em runtime/hardware · `[~] B-0NN` bloqueado (ver `BLOQUEIOS.md`)

**Ordem:** F0 → F1 → (F2 ‖ F3) → F4 → F5 → F6 → F7 → F8 → F9.
**F1 bloqueia tudo** — mexer no POS antes de o `store_id` existir é retrabalho garantido.
Um item `[~]` **nunca** trava a fase: se o resto da fase estiver verde, a fase avança e o bloqueio fica registado.

---

## MAPA DA CORRIDA (Fase 1 do contrato — até à abertura)

_Os dias são referência de calendário, não paragens: a corrida não pára entre fases._

| Dia | Fase | Entrega |
|---|---|---|
| 1 | **F0** | Repo, marca, Supabase novo (prod+staging), CI, deploy staging |
| 2–3 | **F1** | Multi-unidade no schema + RLS por loja + seed das 2 lojas |
| 4–6 | **F2** | POS de balcão a vender (online) |
| 5–7 | **F3** | Impressão nas 2 cozinhas + talão + **gaveta** |
| 7–8 | **F4** | POS **offline** (PWA + fila + conciliação) |
| 8–9 | **F5** | Caixa por loja (abertura, sangria/reforço, fecho com contagem) |
| 9–10 | **F6** | Estoque por loja (baixa automática, esgotado, alertas) |
| 10–12 | **F7** | Site com escolha de loja + delivery/zonas/horários por loja |
| 12–13 | **F8** | Equipa e permissões + painel **Sistema** + alertas + backups |
| 13–15 | **F9** | Migração do 1.0, ensaio geral, formação, go-live |

> Se o calendário apertar, a **prioridade absoluta** é a da proposta: **balcão a cobrar + cozinha a imprimir**
> (F1→F2→F3). Tudo o resto entra com as lojas já abertas.

---

## F0 🔴 Fundação

**Objectivo:** repo a compilar, ambientes separados, deploy de staging vivo, CI a travar merge.

- [x] `git init` + branch `dev` (default) e `main`; `.gitignore` já cobre `node_modules`, `.env*`, `.next`
- [x] `pnpm install` verde; `pnpm lint && pnpm test` verdes (motor herdado já tem testes)
- [x] `config/brand.ts` → identidade HAWSMASH (nome, dourado `#e5a93c`, fundo escuro, logo, redes)
- [x] **Dois projectos Supabase novos**: `hawsmash2` (Pro) e `hawsmash2-staging` (Free). Nunca reutilizar o do 1.0
- [x] `.env.example` actualizado (web + print-bridge) — sem um único segredo real commitado
- [x] Deploy staging no Railway a partir de `dev`; healthcheck `/api/health` a responder
- [~] B-007 CI (GitHub Actions): runs verdes; **protecção de branch** em `main` requer GitHub Pro
- [x] `docs/decisions/0001-multi-unidade.md` — ADR a fixar `store_id` ≠ `tenant_id`

**PROMPT:** *"Lê `CLAUDE.md` e `AGENTS.md`. Executa a F0 do ROADMAP: bootstrap do repo HAWSMASH 2.0 a partir do motor herdado, marca HAWSMASH em `config/brand.ts`, `.env.example`, CI com lint+test, healthcheck e ADR 0001. Não toques em schema. Lista os ficheiros que vais alterar antes de começar."*

---

## F1 🔴 Multi-unidade no schema (BLOQUEIA TUDO)

**Objectivo:** toda a linha operacional tem dono. Um utilizador de uma loja não alcança a outra.

- [x] Migration `1001_stores.sql`: `stores`, `store_hours`, `order_counters` (CLAUDE §5.1/5.4)
- [x] Migration `1002_store_scope.sql`: `store_id not null` em `orders`, `order_items`, `payments`,
      `print_jobs`, `delivery_zones`, `cash_sessions`, `analytics_events` (nullable) + índices
- [x] Migration `1003_store_items.sql`: `store_items` + triggers de preenchimento determinístico (§5.3)
- [x] Migration `1004_staff_rls.sql`: `staff_profiles`, `staff_stores`, helpers `auth_role()`,
      `auth_is_owner()`, `auth_can_store()` e **substituição de todas as policies `staff_all`**
- [x] `get_menu(p_store_slug)`, `create_order` e todas as RPC públicas passam a receber/derivar a loja
- [x] `event_log` ganha `store_id` + `actor_user_id`
- [x] ⏳ **Seed**: lojas `maputo` e `matola` (prefixos `MPT`/`MTL`), horários, números de pagamento, zonas — horários, números e preços confirmados; **zonas da Matola: `PLACEHOLDER_ZONA` → B-002**
- [x] **`packages/db/tests/rls.test.ts`**: utilizador da Matola falha a ler/escrever Maputo; `owner` lê ambas —
      **este teste é o gate da fase**
- [x] `pnpm db:types` regenerado; app compila com os tipos novos

**PROMPT:** *"Executa a F1: multi-unidade. Migrations 1001–1004 conforme `CLAUDE.md §5 e §6`, RPCs com loja, seed das duas lojas e testes de RLS de isolamento entre lojas em `packages/db/tests/rls.test.ts`. Escreve os testes de RLS ANTES das policies. Nenhuma policy pode ficar `using (true)`."*

---

## F2 🔴 POS de balcão (online)

**Objectivo:** vender ao balcão em menos de 15 segundos, com o preço do servidor.

- [x] Migration `1005_pos.sql`: `orders.client_sale_id uuid unique`, `daily_number`, `cash_received_cents`,
      `change_cents`, `needs_review bool`, `channel='counter'`, `devices`
- [x] RPC `create_counter_sale(p_payload jsonb)` — transacional e **idempotente** (CLAUDE §7.2)
- [x] RPC `void_sale(p_order_id, p_reason)` com perfil ≥ manager e reposição de stock
- [x] `/pos`: grelha touch, carrinho, teclado numérico, troco, 4 formas de pagamento, pagamento misto
- [x] Vinculação do dispositivo à loja (`devices`) + sessão longa + bloqueio de ecrã com PIN
- [x] Testes Vitest: idempotência (mesma `client_sale_id` 2× → 1 pedido), troco, esgotado, anulação
- [x] Playwright: venda ponta a ponta (dinheiro com troco) e anulação com motivo

**PROMPT:** *"Executa a F2: POS de balcão online. Migration 1005 + `create_counter_sale` idempotente + `void_sale` + a rota `/pos` (touch, sem hover, alvos ≥64px). Testes ANTES do código para idempotência, troco, stock esgotado e anulação. O POS nunca envia preços — só ids, quantidades e `client_sale_id`."*

---

## F3 🔴 Impressão nas duas cozinhas + gaveta

- [x] Migration `1006_print_jobs.sql`: `store_id`, `kind`, `reprint_seq`, unique `(order_id,station,kind,reprint_seq)`
- [x] `print-bridge` por loja: `STORE_ID` no `.env`, poll só da sua loja, duas impressoras (cozinha + balcão)
- [x] **Servidor HTTP local** (`POST /print`, `POST /drawer`, `GET /health`) autenticado por `LOCAL_TOKEN`
- [x] **Gaveta**: pulso `1B 70 00 19 FA`; abertura fora de venda exige perfil e grava `event_log`
- [x] Talões: comanda de cozinha (nº do dia grande, sem preços) + talão do cliente (com troco)
- [x] Reimpressão pelo painel e pelo POS (`reprint`), sempre logada
- [x] `heartbeat` de 60 s + watchdog + arranque automático no Windows + `.exe` (SEA, herdado do 1.0)
- [x] Testes do render ESC/POS (snapshot) + integração com o simulador
- [~] B-006 **Validação física** com a XP-T80Q e a gaveta reais (o cliente envia o equipamento)

**PROMPT:** *"Executa a F3: impressão multi-loja + gaveta. Estende `services/print-bridge` conforme `CLAUDE.md §8`, incluindo o servidor HTTP local na LAN e o pulso da gaveta. Testes de snapshot dos dois talões contra o simulador. A falha de impressão nunca pode bloquear nem esconder o pedido."*

---

## F4 🔴 POS offline (PWA + fila + conciliação)

**Objectivo:** a loja vende com a internet em baixo. É esta fase que evita o telefonema de sábado.

- [x] PWA do POS: manifest, service worker, instalação no PC touch, arranque em modo kiosk
- [x] Cache do menu (IndexedDB) refrescada a cada 2 min — **única fonte de preço offline**
- [x] Fila de vendas offline com `client_sale_id`; impressão imediata pelo HTTP local do bridge
- [x] Sincronização automática ao voltar a ligação, com backoff; zero duplicados (idempotência da F2)
- [x] Divergência de preço na sincronização → `needs_review` + lista **Conciliação** no painel
- [x] Banner de estado (`SEM LIGAÇÃO · N por sincronizar`) e confirmação verde ao sincronizar
- [x] Testes: fila persiste a reinício do browser; 3 vendas offline → 3 pedidos; reenvio → nenhum duplicado
- [ ] Playwright com rede desligada (offline emulation) na venda de balcão

**PROMPT:** *"Executa a F4: modo offline do POS conforme `CLAUDE.md §7.5`. PWA + IndexedDB + impressão pela LAN + sincronização idempotente + conciliação. Testes de reinício e de reenvio. Offline o operador nunca escreve um preço."*

---

## F5 🔴 Caixa por loja

- [ ] Migration `1007_cash.sql`: `store_id` + `shift_label` + `opening_float_cents` em `cash_sessions`;
      nova `cash_movements` (sangria/reforço/despesa)
- [ ] `open_cash_session(p_store, p_float)` · `close_cash_session(p_store, p_counted, p_reason)` ·
      `add_cash_movement(...)` — todas com perfil e `event_log`
- [ ] Esperado = fundo + dinheiro − sangrias + reforços − despesas; móvel/cartão em linhas separadas
- [ ] Fecho: impressão do fecho + PDF + email ao dono; diferença acima da tolerância exige motivo
- [ ] Painel Caixa por loja + consolidado das duas
- [ ] Testes: cálculo do esperado com movimentos; fecho com diferença; período desde o último fecho

**PROMPT:** *"Executa a F5: caixa por loja e por turno conforme `CLAUDE.md §9`. Migration 1007, RPCs com perfil e auditoria, fecho com contagem, PDF e email. Testa o cálculo do esperado com sangrias e reforços e o período desde o último fecho (nunca desde a meia-noite UTC)."*

---

## F6 🟡 Estoque por loja

- [ ] Migration `1008_stock.sql`: `stock_movements` + índices; `low_stock_qty` em `store_items`
- [ ] Baixa atómica na mesma transação da venda (balcão e online); reposição na anulação
- [ ] Esgotado → indisponível no site e no POS **daquela loja**, automaticamente
- [ ] Aba **Estoque** no painel: contagem, entrada, quebra, histórico de movimentos por item
- [ ] Alerta de stock crítico (§11.5)
- [ ] Testes: venda concorrente do último item (só uma passa), anulação repõe, movimento sempre gravado

**PROMPT:** *"Executa a F6: estoque por loja conforme `CLAUDE.md §10`. Migration 1008, baixa atómica, movimentos auditáveis, aba Estoque e alerta de rotura. Testa a corrida do último item."*

---

## F7 🔴 Site com escolha de loja + delivery por loja

- [ ] Página de entrada com **escolha de loja** → cookie `hs_store` + rotas `/l/[slug]`
- [ ] Trocar de loja limpa o carrinho (aviso claro)
- [ ] `delivery_zones` e `store_hours` por loja; agendamento pelos horários da loja escolhida
- [ ] Checkout mostra os números M-Pesa/e-Mola **da loja** e encaminha o pedido para a cozinha certa
- [ ] `order-status` por pedido; email transacional com identificação da loja
- [ ] Tracking com `store` como dimensão; `purchase` só em `paid`/`approved`
- [ ] `stores.accepting_orders` como kill switch por loja (testado)
- [ ] Playwright: pedido em Maputo e pedido na Matola caem em lojas diferentes

**PROMPT:** *"Executa a F7: site multi-loja conforme `CLAUDE.md §13`. Entrada com escolha de loja, zonas/horários/pagamentos por loja, encaminhamento para a cozinha certa e kill switch por loja. Playwright a provar o encaminhamento."*

---

## F8 🔴 Equipa, permissões, painel Sistema e backups

- [ ] Aba **Equipa**: criar/desactivar contas, atribuir perfil e loja(s), definir PIN
- [ ] Remoção de acesso imediata (compromisso da proposta) + registo em `event_log`
- [ ] Aba **Sistema**: semáforo por loja (POS, bridge, impressora, último pedido, fila de impressão)
- [ ] Alertas automáticos (email + WhatsApp deep link) da lista de `CLAUDE.md §11.5`
- [ ] Digest diário ao dono
- [ ] `pg_dump` nocturno para armazenamento externo + primeiro **teste de restauro** registado em `docs/RUNBOOK.md`
- [ ] Sentry (web + bridge) ligado

**PROMPT:** *"Executa a F8: equipa/permissões, painel Sistema com semáforos, alertas automáticos, digest diário e backups com teste de restauro. Segue `CLAUDE.md §6 e §11.5/11.6` e regista o restauro no RUNBOOK."*

---

## F9 🔴 Migração, ensaio e go-live

- [ ] `scripts/import-hawsmash-1.ts` com **dry-run** e relatório de contagens (CLAUDE §15)
- [ ] Importação real para staging → conferência dos totais com o 1.0 (facturado por mês bate)
- [ ] **TVs**: `/tv/[store]/menu` e `/tv/[store]/senhas` a correr nos ecrãs
- [ ] **Ensaio geral** por loja: 20 vendas de balcão, 5 delivery, 1 fecho de caixa, 1 falha de rede simulada,
      1 falha de impressora simulada
- [ ] Manuais PT (`docs/manual-caixa.md`, `docs/manual-cozinha.md`, `docs/manual-dono.md`) + formação das equipas
- [ ] Checklist de abertura assinada (`docs/RUNBOOK.md`) — equipamento, rede, contas, impressoras, gavetas
- [ ] Cutover: DNS para o 2.0, 1.0 em read-only, acompanhamento reforçado nos primeiros dias

**PROMPT:** *"Executa a F9: migração do HAWSMASH 1.0 (dry-run primeiro), ecrãs de TV, ensaio geral guiado, manuais em português e checklist de abertura. Nada é apagado no 1.0."*

---

# FASE 2 DO CONTRATO (semanas 3–6, com as lojas já a operar)

| # | Entrega | Nota |
|---|---|---|
| G1 🟡 | **Caixa por turno completa** — responsável identificado, troca de turno sem fechar o dia | refina a F5 |
| G2 🟡 | **KDS** `/kds/[store]` — colunas, temporizador, som | motor V.2 |
| G3 🟡 | **Afinação do delivery** — zonas e taxas reais depois dos primeiros dias | dados reais |
| G4 🟡 | **Fidelização + CRM** — ficha de cliente, indicação, ligação balcão↔online | motor §17/§20 |
| G5 🟢 | **Relatórios consolidados** — margem por produto, comparativo entre lojas, horas de pico | motor §16.9 |
| G6 🟢 | **Paysuite por loja** + CAPI server-side + tracking por unidade | depende da §16 P1 |
| G7 🟢 | **PWA do painel + push** — campainha de pedido novo no telemóvel do dono | motor F9.2 |

---

# DEPOIS (produto próprio — sem compromisso com o cliente)

O HAWSMASH 2.0 é a **primeira instância multi-unidade** do Restaurant OS. O caminho para produto:
1. Consolidar este motor (uma empresa, N lojas) — é o que esta fase entrega.
2. Extrair a instanciação (`config/brand.ts` + seed + `stores`) num onboarding self-service.
3. Só depois discutir multi-tenant real (`tenant_id` + RLS por inquilino) — **com ADR** e sem tocar neste cliente.
