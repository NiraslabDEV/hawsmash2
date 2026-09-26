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

**Ordem:** F0 → F1 → (F2 ‖ F3) → F4 → F5 → F6 → F7 → F8 → F9 → **F10**.
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
- [x] ⏳ **Entrada pelo cartão da pessoa** (1049): grelha da equipa da loja + PIN no teclado do ecrã,
      em vez de email/palavra-passe. Bloquear devolve a mesma grelha (render turno é um toque).
      Validar 1049 e a abertura de sessão em staging — B-110
- [x] Testes Vitest: idempotência (mesma `client_sale_id` 2× → 1 pedido), troco, esgotado, anulação
- [x] Playwright: venda ponta a ponta (dinheiro com troco) e anulação com motivo
- [x] **Tirar no upsell o que se pôs no upsell** — cada cartão do funil tem `−` / `+` e há caminho de volta
      ao carrinho. Antes, um toque a mais no ecrã da oferta só se desfazia depois de pagar
- [x] **Guião do pagamento móvel no ecrã** — ao escolher M-Pesa/e-Mola aparece o número **da loja**
      (`stores.mpesa_number`), o titular, o valor e os passos do USSD. Loja sem número diz o que falta
      em vez de mostrar um campo vazio. Guardado em `localStorage` para funcionar offline
- [x] **Resumo do pedido no ecrã de pagamento** — itens, quantidades e total ao lado das formas de
      pagamento; conferir deixa de obrigar a voltar ao carrinho

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
- [x] **Visor do cliente** (`POST /display`): o POS manda a trama a cada passo da venda — artigo, total,
      número do M-Pesa, troco, senha — e o bridge escreve nas duas linhas. Ocioso: o nome da casa a andar,
      mantido pelo bridge para continuar mesmo com o POS fechado. CD5220 e Epson DM-D, sem módulo nativo
      (o binding do `serialport` partiria o `.exe` SEA)
- [~] B-006 **Validação física** com a XP-T80Q e a gaveta reais (o cliente envia o equipamento)
- [~] B-018 **Visor do cliente no equipamento real** — falta a porta COM, a velocidade e qual dos dois
      protocolos fala. Desligado por omissão; `CUSTOMER_DISPLAY_PORT=sim` escreve na consola

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
- [x] Playwright com rede desligada (offline emulation) na venda de balcão

**PROMPT:** *"Executa a F4: modo offline do POS conforme `CLAUDE.md §7.5`. PWA + IndexedDB + impressão pela LAN + sincronização idempotente + conciliação. Testes de reinício e de reenvio. Offline o operador nunca escreve um preço."*

---

## F5 🔴 Caixa por loja

- [x] Migration `1007_cash.sql`: `store_id` + `shift_label` + `opening_float_cents` em `cash_sessions`;
      nova `cash_movements` (sangria/reforço/despesa)
- [x] `open_cash_session(p_store, p_float)` · `close_cash_session(p_store, p_counted, p_reason)` ·
      `add_cash_movement(...)` — todas com perfil e `event_log`
- [x] Esperado = fundo + dinheiro − sangrias + reforços − despesas; móvel/cartão em linhas separadas
- [x] Fecho: impressão do fecho + PDF + email ao dono; diferença acima da tolerância exige motivo
- [x] Painel Caixa por loja + consolidado das duas
- [x] Testes: cálculo do esperado com movimentos; fecho com diferença; período desde o último fecho

**PROMPT:** *"Executa a F5: caixa por loja e por turno conforme `CLAUDE.md §9`. Migration 1007, RPCs com perfil e auditoria, fecho com contagem, PDF e email. Testa o cálculo do esperado com sangrias e reforços e o período desde o último fecho (nunca desde a meia-noite UTC)."*

---

## F6 🟡 Estoque por loja

- [x] Migration `1008_stock.sql`: `stock_movements` + índices; `low_stock_qty` em `store_items` (já vinha da 1003)
- [x] Baixa atómica na mesma transação da venda (balcão e online); reposição na anulação
- [x] Esgotado → indisponível no site e no POS **daquela loja**, automaticamente
- [x] Aba **Estoque** no painel: contagem, entrada, quebra, histórico de movimentos por item
- [x] Alerta de stock crítico (§11.5) — evento `stock.low`/`stock.out` + destaque no painel; envio por email/WhatsApp na F8
- [x] Testes: venda concorrente do último item (só uma passa), anulação repõe, movimento sempre gravado

**PROMPT:** *"Executa a F6: estoque por loja conforme `CLAUDE.md §10`. Migration 1008, baixa atómica, movimentos auditáveis, aba Estoque e alerta de rotura. Testa a corrida do último item."*

### F6.1 🟡 Matéria-prima, ficha técnica e CMV *(pedido do cliente em 2026-08-27)*

O estoque de produto final não descreve a cozinha: o que acaba é a carne, não o "Classic Smash".

- [x] Migration `1024`: `ingredients` · `store_ingredients` · `ingredient_movements` · `recipe_items`
      (ficha por **(produto, variante)**) + `order_items.cost_cents`
- [x] Migration `1025`: consumo na venda de balcão, no pedido online e reposição na anulação —
      sempre na mesma transacção, com `out_of_ingredient:<nome>` a reverter a venda inteira
- [x] Migration `1026`: RPCs do painel (ingredientes, custo, ficha técnica, contagem, histórico) +
      `report_cmv` — custo é do `owner`, contagem é do `manager`
- [x] Migration `1027`: ingredientes e fichas do HAWSMASH (carnes, queijo, bacon, brisket) —
      custos por confirmar em **B-020**
- [x] Testes: HAW não desconta WAGYU · Double leva duas carnes · falta de carne reverte a venda ·
      anulação repõe uma só vez · custo congelado na linha · isolamento entre lojas
- [x] Aba **Estoque** com separadores **Produtos · Ingredientes · Ficha técnica · Custos (CMV)** —
      contagem, entrada, quebra e histórico de matéria-prima; custo e ficha só para o `owner`
- [ ] Esgotado por **variante** no site e no POS (hoje a falta trava a venda, mas o WAGYU não fica
      cinzento antes de o operador tentar)

**PROMPT:** *"Executa a F6.1: ingredientes e ficha técnica conforme `CLAUDE.md §10.1`. Ecrã de gestão no painel, CMV por produto e esgotado por variante. Testa que o HAW não desconta a carne WAGYU."*

---

## F7 🔴 Site com escolha de loja + delivery por loja

- [x] Página de entrada com **escolha de loja** → cookie `hs_store` + rotas `/l/[slug]`
- [x] Trocar de loja limpa o carrinho (aviso claro)
- [x] `delivery_zones` e `store_hours` por loja; agendamento pelos horários da loja escolhida — zonas da Matola em `PLACEHOLDER_ZONA` (B-002)
- [x] Checkout mostra os números M-Pesa/e-Mola **da loja** e encaminha o pedido para a cozinha certa
- [x] `order-status` por pedido; email transacional com identificação da loja
- [x] Tracking com `store` como dimensão; `purchase` só em `paid`/`approved`
- [x] `stores.accepting_orders` como kill switch por loja (testado)
- [x] Playwright: pedido em Maputo e pedido na Matola caem em lojas diferentes

**PROMPT:** *"Executa a F7: site multi-loja conforme `CLAUDE.md §13`. Entrada com escolha de loja, zonas/horários/pagamentos por loja, encaminhamento para a cozinha certa e kill switch por loja. Playwright a provar o encaminhamento."*

---

## F8 🔴 Equipa, permissões, painel Sistema e backups

- [x] Aba **Equipa**: criar/desactivar contas, atribuir perfil e loja(s), definir PIN
- [x] Remoção de acesso imediata (compromisso da proposta) + registo em `event_log`
- [x] Aba **Sistema**: semáforo por loja (POS, bridge, impressora, último pedido, fila de impressão)
- [x] Alertas automáticos (email + WhatsApp deep link) da lista de `CLAUDE.md §11.5` — `/api/cron/alerts`, com arrefecimento de 30 min
- [x] Digest diário ao dono — `/api/cron/digest` + `get_daily_digest`
- [~] B-014 `pg_dump` nocturno (script pronto e ensaiado; destino externo B-008) + **teste de restauro** por correr
- [x] ⏳ B-013 Sentry (web + bridge) ligado — inerte até haver DSN

**PROMPT:** *"Executa a F8: equipa/permissões, painel Sistema com semáforos, alertas automáticos, digest diário e backups com teste de restauro. Segue `CLAUDE.md §6 e §11.5/11.6` e regista o restauro no RUNBOOK."*

---

## F9 🔴 Migração, ensaio e go-live

- [x] `scripts/import-hawsmash-1.ts` com **dry-run** e relatório de contagens (CLAUDE §15) — mapeamento testado em `scripts/__tests__/import-mapping.test.ts`
- [~] B-009 Importação real para staging → conferência dos totais com o 1.0 (falta a chave de leitura do projecto antigo)
- [x] ⏳ **TVs**: `/tv/[store]/menu` e `/tv/[store]/senhas` — rotas prontas; falta apontar os ecrãs físicos (B-011)
  - [x] ⏳ **Aba TVs no painel (1090, 24 Set):** 2 TVs por loja + adicionar/duplicar/apagar; modo senhas + vídeos,
        só senhas, só vídeos ou cardápio; títulos e tempos das senhas, rotação, tamanho, lista de vídeos; biblioteca
        de vídeos partilhada com cache na TV (toca sem internet); "Ligada / sem sinal" por TV. `docs/TVS.md`.
        Gates: `apps/web/lib/tv/__tests__` (24) verdes; `packages/db/tests/tvs.test.ts` por correr nesta máquina (sem Docker).
  - [ ] Aplicar 1090 no staging; carregar um vídeo real e ver a box Android a tocá-lo e a manter com a rede desligada.
  - [ ] Confirmar o tecto de upload do projecto Supabase (B-113) antes de o dono carregar vídeos grandes.
- [~] B-006 **Ensaio geral** por loja: 20 vendas de balcão, 5 delivery, 1 fecho de caixa, 1 falha de rede simulada,
      1 falha de impressora simulada
- [x] ⏳ Manuais PT (`docs/manual-caixa.md`, `docs/manual-cozinha.md`, `docs/manual-dono.md`) — escritos; formação presencial por dar
- [x] ⏳ Checklist de abertura (`docs/RUNBOOK.md` §7) + guião do ensaio geral (§6) — por assinar no dia
- [~] B-010 Cutover: DNS para o 2.0, 1.0 em read-only, acompanhamento reforçado nos primeiros dias

**PROMPT:** *"Executa a F9: migração do HAWSMASH 1.0 (dry-run primeiro), ecrãs de TV, ensaio geral guiado, manuais em português e checklist de abertura. Nada é apagado no 1.0."*

---

## F10 🔴 Aba Lojas — configurar a operação sem tocar na base de dados

> **Porquê depois da F9:** a corrida F0→F9 deixou a configuração das lojas (horário, zonas, números de
> pagamento, rodapé) só acessível por SQL, e o interruptor "Aceitando pedidos" das Definições escreve em
> `settings`, que o checkout multi-loja **ignora** — ou seja, hoje **não há forma de fechar uma loja pelo
> painel**. Isso é operação do dia a dia, não configuração de instalação. Ver `CLAUDE.md §5.6`.

- [x] Migration `1011_stores_admin.sql`: RPCs `save_store`, `set_store_hours`, `save_delivery_zone`,
      `delete_delivery_zone`, `set_store_accepting_orders`, `get_store_admin` — dono para tudo, gerente só
      para o kill switch da sua loja
- [x] `slug` e `order_prefix` imutáveis depois de criados (histórico de pedidos e `.env` do bridge dependem deles)
- [x] Segredos do Paysuite deixam de ser legíveis pelo cliente autenticado (grant por coluna em `stores`)
- [x] Aba **Lojas** no painel: criar loja, editar contactos/pagamento/rodapé/canais, horário por dia,
      zonas e taxas, kill switch com motivo
- [x] Definições deixa de mostrar um interruptor que não fecha nada; aponta para a aba Lojas
- [x] Testes: só o dono cria/edita; gerente fecha a **sua** loja e não a outra; `slug`/`order_prefix` recusam
      alteração; horário inválido recusado; zona em uso desactiva em vez de apagar; tudo auditado
      (`packages/db/tests/stores-admin.test.ts` + `e2e/lojas.spec.ts`)
- [x] Loja nova nasce utilizável: `store_items` para todo o cardápio e aviso do que falta antes de abrir

### Corrigido pelo caminho (apanhado pelos testes da F10)

- **O painel podia fechar a loja errada** — o interruptor "Aceitando pedidos" agia sobre a ficha
  **carregada**, não sobre a loja **escolhida**. Entre clicar noutra loja e a ficha chegar do servidor,
  um clique rápido em "Fechar loja agora" fechava a anterior. Agora nenhuma acção de escrita corre
  enquanto a ficha não for da loja seleccionada (`stale`), e os botões ficam desligados até lá.
  Apanhado pelo `e2e/lojas.spec.ts` ao correr com o resto da suite.

- **`order_number` repetia na viragem do dia** — era gerado a partir do contador diário, que reinicia todos os
  dias, contra uma coluna `unique`. Na manhã seguinte à abertura, **nenhuma venda entrava** (online ou balcão).
  Migrations `1012` e `1013`: sequência contínua por loja (`store_order_sequences`) para o `order_number`,
  contador diário só para o `daily_number`, e o pedido online passa também a receber número do dia — sem ele
  nunca aparecia na TV de senhas.

**PROMPT:** *"Executa a F10: aba Lojas conforme `CLAUDE.md §5.6`. Migration 1011 com RPCs auditadas, ecrã de
gestão no painel e o kill switch por loja onde faz sentido. Testa perfil, imutabilidade do slug/prefixo e
isolamento entre lojas."*

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
| G8 🟢 | **Criar loja copiando outra** — "copiar configuração de: Maputo · Matola" na aba Lojas. Nunca copia segredos do Paysuite | [ADR 0002](docs/decisions/0002-criar-loja-a-partir-de-outra.md) |
| G9 🟢 | **Atendimento no site** — bolha de conversa com **dúvidas em botão e resposta escrita de antemão** (com indicador de escrita), e escalada para uma **gaveta de conversas no POS** que empilha por tempo de espera. Perguntas e respostas em `chat_topics`, editáveis no painel — nunca em código | [CLAUDE.md §19](CLAUDE.md) · [~] [B-021](BLOQUEIOS.md) |

---

## A1 🟢 Canal de encomendas por agente *(produto · 2026-09-14)*

- [x] MCP público `/api/mcp` e WebMCP no funil público, com serviço comum para
      `list_stores`, `get_menu`, `quote_order` e `prepare_checkout`; preços/loja/opções
      validados, dados filtrados e checkout final com revisão humana.
- [x] Pacote de plugin reutilizável por instalação, gerador e documentação;
      flag desligada por omissão. Testes unitários, cliente SDK MCP e ensaio de browser
      com RPC simulado; WebMCP nativo observado em Chrome 152 experimental.
- [~] B-103 Activar no domínio HTTPS da instalação e validar o percurso em staging
      com dados/configuração dessa instalação, antes de o expor ao público.
- [~] B-104 Ligar o pacote à conta destinatária e completar validação/publicação
      no ChatGPT com identidade e política de privacidade da instalação.

**Âmbito verificado:** implementação e ensaio local isolado. Não implica activação em produção
nem publicação no ChatGPT. Ver [`docs/MCP.md`](docs/MCP.md) e
[`CLAUDE.md §13.1`](CLAUDE.md).

---

## V1 — Preparação do delivery para volume *(produto · 2026-09-14)*

- [x] Conferência de extractos normalizados por loja, em centavos, sem alterar pagamentos.
- [x] Reconciliação de estados por loja, paginada, cancelável e autenticada.
- [x] ⏳ Paginação real de pedidos na BD/painel e deliveries activos no POS, com fallback de actualização e testes além de 100 pedidos; validar staging em B-105.
- [~] B-105 Aplicar e validar a migration 1045 na BD de staging antes do deploy do painel.
- [~] B-106 Configurar scheduler, segredo e contas; validar reconciliação por loja no ambiente de ensaio.
- [~] B-107 Validar o formato e as referências do extracto real antes de criar o adaptador diário.

Plano V2–V6, matriz de lacunas e cenários de carga em
[`docs/PREPARACAO-VOLUME.md`](docs/PREPARACAO-VOLUME.md). Esta passagem prepara a base;
não declara os 1.500 pedidos/dia, 30 pedidos/minuto ou 96.000 pedidos/ano já ensaiados.
O KDS completo é uma evolução separada. Não executar integrações reais por inferência da proposta.

---

## V1.1 — Caminho de e-Mola online *(produto · 2026-09-14)*

- [x] ⏳ Escolha de e-Mola por loja, coexistência com M-Pesa directo, configuração auditada
      pelo dono e guardas na BD; aplicar/validar 1046/1047 em staging antes de publicar.
- [x] Checkout por método, confirmação assinada pela conta correcta, verificação e
      reconciliação por loja/método, protecção de pagamento pendente e simulador.
- [x] Identificador estável antes do envio, deduplicação transaccional e uma única
      iniciação de pagamento por tentativa, com recuperação do checkout existente.
- [~] B-108 Validar migrations 1046/1047, permissões e percurso integrado em staging.
- [~] B-109 Integração directa Movitel e ensaio acompanhados em V1.2 (orientação actual).

Ver [`docs/EMOLA-ONLINE.md`](docs/EMOLA-ONLINE.md). Preparação local, sem activação real.

## V1.2 — e-Mola directo Movitel *(produto · 2026-09-14)*

- [x] ⏳ Caminho directo independente por loja, simulador sem rede, telefone próprio,
      confirmação pelo método gravado e consulta por referência persistida; guarda
      impede API/RPC reais sem contrato e simulador em produção. Validar 1048 em B-108.
- [~] B-108 Validar 1046/1047/1048, permissões e percurso completo no staging Supabase.
- [~] B-109 Obter contrato/conta Movitel, implementar o adaptador directo e ensaiar.

V1.2 orienta a instalação para ligação directa; a compatibilidade de V1.1 com
Paysuite permanece no motor. Nenhuma cobrança real ou adesão a fornecedor foi feita.

# DEPOIS (produto próprio — sem compromisso com o cliente)

O HAWSMASH 2.0 é a **primeira instância multi-unidade** do Restaurant OS. O caminho para produto:
1. Consolidar este motor (uma empresa, N lojas) — é o que esta fase entrega.
2. Extrair a instanciação (`config/brand.ts` + seed + `stores`) num onboarding self-service.
3. Só depois discutir multi-tenant real (`tenant_id` + RLS por inquilino) — **com ADR** e sem tocar neste cliente.

## Campanhas automáticas por loja — 2026-09-23

- [x] Reajuste auditado e idempotente por loja; desconto por unidade com data final; banner e preços de tabela/campanha.
- [x] Ensaio SQL local transaccional: arredondamento, retry, isolamento, expiração e total do pedido.
- [x] ⏳ Validar checkout público completo e activar apenas depois de staging (ver docs/CAMPANHAS.md).


## Definições do POS por loja — 2026-09-23

Aba **POS** no painel (`/definicoes-pos`): cada loja configura o seu balcão sem deploy.
Contrato e checklist para levar a outros projectos: [`docs/POS-DEFINICOES.md`](docs/POS-DEFINICOES.md) ·
[ADR 0006](docs/decisions/0006-definicoes-do-pos-por-loja.md).

- [x] `store_pos_settings` (1067): RLS por loja, escrita só por RPC, `event_log` com as secções mudadas.
- [x] Frases do upsell e notas rápidas desta casa saem do código para dados (1068); fábrica neutra.
- [x] POS lê as definições (cache offline, relê a cada 2 min): pagamentos, misto, upsell por passo,
      notas rápidas, tipo de pedido ao abrir, nome/telefone no balcão, confirmação, som.
- [x] Painel: editar por loja, repor fábrica, descartar, copiar para outra loja.
- [x] Testes: contrato (`settings.test.ts`), isolamento entre lojas (`pos-settings.test.ts`), e2e local.
- [x] 1067/1068 aplicadas no staging (`db push --include-all`, versões canónicas); anon recusado.
- [ ] Correr `e2e/definicoes-pos.spec.ts` contra o staging.
- [ ] Aplicar 1067/1068 no LIVE, na próxima janela (nunca em horário de loja).

## Upsell por loja e modelos do talão — 2026-09-23

Aba **POS**: o dono escolhe os produtos de cada passo do upsell e como sai o papel, loja a loja.
Contrato em [`docs/POS-DEFINICOES.md`](docs/POS-DEFINICOES.md) §1 e §11 · [ADR 0007](docs/decisions/0007-modelos-do-talao.md).

- [x] Produtos por passo do upsell (lista da loja, com ordem; vazio = os do Cardápio); POS e painel.
- [x] `packages/receipt`: os formatos saem do bridge para um pacote partilhado; o de fábrica sai byte a byte igual (`talao-bytes.test.ts`, 9 formatos).
- [x] Modelos Completo / Compacto / Cozinha por via + blocos do Completo; pré-visualização no painel com o mesmo código.
- [x] Bridge lê o layout de minuto a minuto, com cópia em disco para sem rede (`print-layout.ts`).
- [x] Vias por pedido no painel (1071, dono e gerente da loja, registado).
- [x] Guarda do painel: o URL escrito à mão respeita o perfil (`lib/admin/nav.ts`).
- [ ] Aplicar 1071 no staging; gerar o `.exe` do bridge e trocá-lo nas lojas **fora do horário**; imprimir um talão de cada modelo em papel.

## Alterar morada e hora pelo balcão — 2026-09-24

Pergunta do caixa: "se o cliente quiser mudar o endereço ou o horário, eu posso?" Passa a poder, no
detalhe do pedido no quadro do POS (1072, `update_order_details`).

- [x] Morada até o pedido sair (pronto incluído), só em entregas; hora até estar pronto.
- [x] Zona só com a mesma taxa — o total não se mexe (regra 2); taxa diferente = anular e refazer com gerente.
- [x] `event_log` com antes/depois e autor (`order.address_changed`, `order.schedule_changed`).
- [x] Comanda já impressa → via **PEDIDO ALTERADO** na cozinha, com o que mudou; idempotente por `p_request_id`.
- [x] Gate `packages/db/tests/alterar-pedido.test.ts` (15): dinheiro, papel, repetição, perfis e isolamento de loja.
- [ ] Aplicar 1072 no staging; gerar o `.exe` do bridge (sem ele a via sai sem o rótulo ALTERADO).

## Análise e Aquisição — base visual do dashboard · 2026-09-24

- [x] Redesenhar Vendas e Aquisição: hierarquia, indicadores, gráficos, funil, tabelas e exportação; componentes reutilizáveis e estilos limitados à nova base.
- [x] Validar no browser: 8 cenários Playwright locais, desktop/móvel/320 px, auditoria axe A/AA da área redesenhada, teclado, filtros, falhas, estados vazios e CSV.
- [x] Corrigir períodos móveis de Aquisição, exportação no fuso de Maputo, formatação `formatMT`, respostas atrasadas e lojas autorizadas na exportação.
- [x] Documentar a base em `docs/ANALISE-DESIGN.md` para migrar as restantes páginas numa próxima etapa.
- [~] B-111 — validar em staging com sessões e dados reais antes de promover. Não foi publicado em produção nesta corrida.

## Exportação autenticada e CSV para integração · 2026-09-24

- [x] Corrigir a sessão do download: Bearer do painel, validação Auth no servidor, mesma identidade na RPC e renovação única após 401.
- [x] Paginar pagamentos com contagem exacta; recusar ficheiro parcial, parâmetros inválidos ou exportação acima dos limites explícitos.
- [x] CSV padrão/Excel, detalhe por pagamento ou resumo por pedido sem duplicar totais de pagamentos mistos; estados de devolução separados.
- [x] Testes antes da correcção para autenticação e valores; download pelo route handler real com Auth/RPC simulados, ficheiro conferido e auditoria de acessibilidade repetida.
- [~] B-112 — adaptador específico WinREST/software certificado: falta contrato de importação/API e ensaio no destino. CSV genérico pronto, compatibilidade directa não declarada.

## Origem online/POS e desempenho de upsells · 2026-09-24

- [x] Aquisição online sem vendas POS; Vendas Todos/Online/POS e vista POS própria, com filtros no servidor e comparação anterior consistente.
- [x] Rastrear ofertas/aceitações, acompanhamentos e upgrades do site e ofertas do POS; conservar atribuição na fila offline, nos retries e após alterações ao carrinho.
- [x] Receita adicional confirmada, descontos e margem bruta estimada por produto/oferta; custos desconhecidos explícitos, sem inventar histórico.
- [x] Ensaios de dinheiro/isolamento/idempotência, interfaces e acessibilidade; contrato em `docs/ANALISE-ORIGENS-UPSELL.md`.
- [x] Corrigir trigger Railway: produção acompanha `main`, staging acompanha `dev`.
- [x] Aplicar 1073/1074 em staging e reconciliar as RPCs autenticadas por leitura, sem vendas artificiais.
- [x] QR de mesa permanece online quando não tem origem POS (1075); verificação de regressão antes da correcção.
- [x] Publicar a interface no staging: deploy `59e6620` confirmado com HTTP 200 e bundles novos; revisão do QR em migration forward-only 1075.

## O mesmo produto em várias linhas do balcão — 2026-09-24

Incidente: 6 Classic (5 HAW e 1 WAGYU) e 4 batatas, pago por e-Mola, recusado duas vezes com
`duplicate_item`. Não era o e-Mola: a `create_counter_sale_unlocked` da 1023 recusava o mesmo produto em
duas linhas, e o carrinho do POS separa HAW de WAGYU e um "sem cebola" de um normal. A venda inteira
revertia — sem pedido, sem pagamento registado, sem talão — e uma destas feita sem rede nunca sincronizava (1080).

- [x] Tirar a verificação `duplicate_item`; stock, ficha técnica e anulação já contavam por linha ou por produto.
- [x] Talão completo com a variante no nome (`1x Classic Smash WAGYU`), para sair com o bridge que está nas lojas.
- [x] Remendo às duas funções que salta o que a 1077 já corrigiu: não a pisa em nenhuma ordem de aplicação. Simulado sobre o texto da 1023 e da 1064 (LF e CRLF).
- [x] ⏳ Gate `packages/db/tests/mesmo-produto-varias-linhas.test.ts` (5): o pedido real pago por e-Mola, talão, nota, stock e venda offline. Não correu nesta máquina (sem Docker) — corre no CI.
- [ ] Aplicar 1080 no staging **sem** as 1077–1079, que ainda estão em curso (`db push` a partir de uma árvore limpa), e depois no LIVE.
- [ ] Antes de sair a 1077: o talão dela manda a variante num campo à parte, que o bridge actual ignora. Sai com o `.exe` novo, ou o WAGYU volta a sair no papel como "Classic Smash".

## Mesas: balcão e QR na mesma conta — 2026-09-24

Pedido do dono: aba MESAS no POS, por baixo de Senhas. Quem está na mesa 2 pede pelo QR ou ao balcão, vai
tudo para a mesma mesa, e a mesa paga no fim, tudo junto. 6 mesas em cada loja (1081, dados na 1082).

- [x] Mesas por loja (Regra 3): o QR diz a loja da mesa, o anon deixa de ler a tabela, o painel cria mesas por loja.
- [x] Lançar na mesa pelo POS (`launch_table_order`): preço da loja, variante e extras no servidor, stock e ficha técnica na mesma transacção, idempotente; comanda da mesa (MESA em grande) com o bridge actual.
- [x] Conta da mesa (`close_table_bill`): cobra só o que o caixa viu, misto/troco/gaveta, pagamentos repartidos pelos pedidos (o fecho de caixa conta-os), talão completo da conta; duas caixas não fecham a mesma conta. A conta é o que a mesa pediu hoje (dia de Maputo) e não pagou.
- [x] QR: pedido na loja da mesa, "Mesa N" no nome, stock e ficha técnica baixam, comanda com o número da loja (saía `ENC-`); canal `dine_in` (era `pickup`).
- [x] POS: aba Mesas (conta por mesa, QR + balcão), "Mesa" no tipo de pedido, fechar conta no ecrã de pagamento.
- [x] ⏳ Gates `packages/db/tests/mesas.test.ts` (13) e `apps/web/lib/pos/__tests__/tables.test.ts` (12). O de BD não correu nesta máquina (sem Docker): SQL e PL/pgSQL validados pelo parser do Postgres 17; corre no CI.
- [ ] Aplicar 1081/1082 no staging fora do horário, sem as 1077–1079; ensaiar a mesa 1: lançar, pedir pelo QR, fechar em misto.
- [x] QR com HAW/WAGYU e extras: entram na folha de escolhas da página da mesa como grupos (a variante já marcada na do costume) e seguem como `variantId`/`addonIds`, a preço do servidor.
- [ ] Anular uma conta já fechada; avisar no fecho de caixa se houver mesas por fechar.

## Caixa no POS — 2026-09-24

Pedido do dono: abrir e fechar o caixa no POS, sem ir ao painel. Sem migration: as RPCs da F5 (1007) já
aceitavam o `cashier`, com loja, perfil e `event_log`.

- [x] Aba **Caixa** no POS (por baixo de Mesas): abrir com fundo; sangria, reforço, despesa e troco inicial com motivo; fechar com contagem, esperado e diferença ao vivo.
- [x] O fecho avisa se há vendas offline por sincronizar (entram no servidor à hora da sincronização e cairiam no turno seguinte) e mesas com conta aberta.
- [x] Talão de fecho (trigger da F5) e email ao dono, best-effort, como no painel. Manual do balcão actualizado.
- [x] Gate `apps/web/lib/pos/__tests__/caixa.test.ts` (13): teclado, só a loja do terminal, centavos inteiros, movimento, mesas, mensagens.
- [ ] Ensaiar no staging com um `cashier`: abrir, sangria, vender, fechar com diferença e ver o talão de fecho sair.

## Fecho do dia — 2026-09-25

Pedido do dono: abrir o turno → fechar o turno para trocar → a pessoa seguinte abre o dela → fecha → e,
no fim de tudo, o fecho do dia. Entrega o G1 da Fase 2 (responsável identificado, troca de turno sem fechar o dia).

- [x] Migration 1091: `cash_day_closes` por loja (RLS, sem a cozinha) e `cash_sessions.day_close_id`; cada turno entra num só fecho do dia.
- [x] `close_cash_day(p_store, p_request_id)`: soma o que os turnos congelaram (não recalcula), quem abriu e fechou cada um, diferença do dia, fundo do início e o que ficou na gaveta; trava com turno aberto; idempotente; `event_log` `cash.day_closed`.
- [x] `get_cash_day(p_store)`: o que o fecho vai juntar, antes de confirmar.
- [x] Dias anteriores à 1091 fechados na própria migration (um por loja e dia de Maputo, sem papel) — sem isso o primeiro fecho juntava o histórico. Os turnos de hoje ficam para o fecho desta noite.
- [x] Talão do dia em `@delivery/receipt` (`cash-day.ts`); na fila é um `cash_close` com `day`, e o bridge antigo imprime-o no formato do fecho de turno ("FECHO DO DIA" na linha do turno).
- [x] POS: "Fechar turno" (era "Fechar caixa"), cartão **Fim do dia?** depois do último turno, resumo do dia com os turnos e confirmação; email ao dono (`/api/emails/send-cash-day-email`).
- [x] ⏳ Gates: `packages/db/tests/cash-day.test.ts` (6), `packages/receipt/src/__tests__/cash-day.test.ts` (5), `apps/web/lib/cash/__tests__/day.test.ts` (4), `caixa.test.ts` (+4). O de BD não correu nesta máquina (Docker em baixo) — SQL e PL/pgSQL validados pelo parser do Postgres 17; corre no CI.
- [x] 1091 aplicada no staging a 26/09, 10:10, antes da abertura (`db push` a partir do commit — só a 1091). O histórico do staging ficou em 2 dias fechados (23/09 e 25/09).
- [x] Ensaio no staging numa transacção desfeita no fim (nada ficou gravado): turno do Gerente Maputo e turno da Caixa Maputo com despesa e diferença de 5 MT, pré-visualização, fecho do dia pela caixa, repetição devolve o mesmo fecho, segundo fecho recusado, Matola recusada, 1 registo de auditoria, talão do dia na fila do balcão. Talão (bridge novo e antigo) e email desenhados a partir do relatório real; o email não foi enviado — o staging manda ao email do dono.
- [x] `.exe` do bridge gerado a partir do `9be3314` (`services/print-bridge/build/hawsmash-print-bridge-9be3314.exe`, fora do git) e ensaiado sem rede: imprime o talão do dia numa impressora simulada.
- [ ] Trocar o `.exe` nas lojas (Maputo e Matola); até lá o fecho do dia sai no formato do fecho de turno.
- [ ] Aplicar a 1091 no LIVE fora do horário e fazer o primeiro fecho do dia a sério.
- [x] Painel: lista dos fechos do dia na aba Caixa (últimos 20, com os turnos, quem os fez e o PDF de cada turno).
## Mesas: nome da conta, 20 em Maputo e senha pequena — 2026-09-25

Pedido do dono: o pedido de mesa sai em duas cópias e com uma senha pequena; Maputo passa a 20 mesas, porque
as a mais servem de conta por pessoa, com o nome do cliente no cartão da mesa (1092, dados na 1093).

- [x] Comanda da mesa nas vias da loja (com 2: balcão e cozinha), do balcão e do QR; senha pequena no balcão (SENHA, MESA, nome) — formato novo do `@delivery/receipt`, que num bridge antigo cai no herdado.
- [x] Nome da conta: escrito ao lançar na mesa, herdado pelos pedidos seguintes do balcão e do QR; aparece no cartão da mesa, na escolha de mesa e no cabeçalho da conta.
- [x] Maputo com 20 mesas (1093), cada uma com o seu QR; a Matola fica com 6.
- [x] ⏳ Gates: `packages/db/tests/mesas.test.ts` (15), `packages/receipt/src/__tests__/senha.test.ts` (4), `apps/web/lib/pos/__tests__/tables.test.ts` (14). O de BD corre no CI.
- [ ] Aplicar 1092/1093 no staging.
- [ ] Gerar o `.exe` do bridge com a senha pequena e trocá-lo nas lojas; até lá a senha sai no formato herdado (nome e MESA, sem artigos).
- [ ] Imprimir e colar os QR das mesas 7–20 de Maputo e 1–6 da Matola.

## Troca de turno no POS — 2026-09-26

Pedido do dono: um botão TROCAR DE TURNO que passa o POS para o caixa seguinte, com o PIN dele — e o caixa
também: quem sai responde pelo seu dinheiro, quem entra abre o seu.

- [x] TROCAR DE TURNO no topo do POS: abre a aba Caixa já na contagem da gaveta (1 de 2); fechado o turno, "PASSAR AO PRÓXIMO CAIXA" bloqueia e mostra os cartões; quem entra põe o PIN e vai direito a abrir o seu turno com o fundo (2 de 2). Cancelar a troca não fecha nada.
- [x] O "Bloquear · trocar" fica para uma ausência curta, sem mexer no caixa.
- [ ] ⏳ Ensaiar no POS com dois caixas reais (sem teste automático: é orquestração de ecrãs sobre as RPCs do caixa, já cobertas).
