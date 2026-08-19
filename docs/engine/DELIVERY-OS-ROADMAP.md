# ROADMAP.md — Delivery OS: Roteiro de Execução em Fases

> **Como usar:** abrir o Claude Code na raiz do repo. Colar o PROMPT da fase atual, exatamente como está.
> Uma fase por sessão. A fase só está concluída quando TODO o checklist de DoD estiver verde.
> Nunca avançar com testes a falhar. Nunca deixar o agente "adiantar" a fase seguinte.

Legenda: 🔴 bloqueia tudo · 🟡 bloqueia a entrega ao 1º cliente · 🟢 melhoria
DoD: `[x]` feito (código + gate/commit) · `[x] ⏳` código pronto, falta confirmar em runtime com Supabase local · `[ ]` por fazer

> **Estado atual (2026-06-16): FASES 0–4 + extras IMPLEMENTADAS; Paysuite EM PRODUÇÃO.** `pnpm test` → **127 testes** · `pnpm lint` → 0 erros · deploy Railway ativo.
>
> Feito: F0 completa (monorepo, schema, loja, painel Pedidos, emails); F1 completa (ADD PRODUTOS, Caixa, Análise, Feedback + Lista de Espera);
> F2.1 (Paysuite mock + webhook HMAC + reconciliação cron); F2.2 (print-bridge ESC/POS formato PRAIA SHOPPING, cupom delivery, simulator);
> F2.3 (stock atómico, heartbeats impressora/admin); **F3.1 (turnkey: `pnpm setup:client` + `.env.example`/`brand.example.ts` + README de onboarding + contrato do backend para fronts + checklist).** F4 (tracking).
>
> **Correções de painel (2026-06-15, migration `...016_dashboard_fixes.sql`):**
> - Painel **Pedidos**: linha expansível com comprovativo **inline** (signed URL) + Aprovar/Negar/avançar trilha ali mesmo; botões **Iniciar preparo → Marcar pronto → Entregue(balcão)/Enviado(delivery)** (RPC `advance_order` já tinha os eventos) na Lista **e** no Calendário; ícone 👁 para ocultar Total Faturado (persistido em localStorage).
> - **Decisão fechada:** "venda confirmada" = `status in ('approved','paid','in_preparation','ready','delivered')`. `get_order_stats.ativos` passa a incluir approved/paid; `get_dashboard_metrics` (Análise) conta confirmados (não só `delivered`); `get_cash_dashboard` mostra desde o **último fecho** (não meia-noite UTC).
> - **Definições** saiu de dentro de Cardápio → tab própria (`/definicoes`). Nav admin com `flex-wrap` (a tab **Marketing** estava cortada). Cardápio mantém só Cardápio + Zonas.
> - Feedback do cliente (`/order-status`) aparece quando o pedido fica `delivered` — agora alcançável via os botões de avançar trilha.
> - Adicionada dependência `zod` em `apps/web` (faltava à rota `/api/track` da F4).
>
> **Hotfix cloud (2026-06-15, projeto `deliverysgab`):** a BD cloud tinha só migrations até `0012`. Aplicadas (via Supabase) as `0013`–`0018` em falta → resolveu o erro "function `get_funnel_metrics` not found" (Análise) e a Caixa a 0. **Migration `...018_cash_period_since_last_close.sql`:** corrige o `get_cash_dashboard` para contar SEMPRE desde o último fecho (a 0016 usava `opened_at` da sessão aberta, escondendo pedidos criados antes de abrir a caixa — furo num delivery 24/7). Validado: 3 pedidos `approved` (2340 MT) agora aparecem em Análise e Caixa.
>
> **🟢 GO-LIVE PAYSUITE + RESKIN iFood (2026-06-16):** `pnpm test` → **127 testes** · lint/build verdes · deploy Railway (`web-production-a4de0.up.railway.app`).
> - **Paysuite REAL validado com pagamento M-Pesa** (pedido → checkout → pago → `paid` → `payments` + `print_job`). Provider configurável no **admin** (Definições → Paysuite, chaves mascaradas em `settings`, migration `0019`); rotas leem `settings`→`.env` (`lib/payments/config.ts`).
> - **Bugs reais corrigidos** (descobertos contra a API): `reference` tem de ser alfanumérico (`lib/payments/reference.ts`); `return_url`/`callback_url` precisam de esquema (`resolvePublicBase`); `create_order` usava `v_menu_item.station` mas `station` vive em `menu_categories` (migration `0020`, join).
> - **Verificação ATIVA do pagamento** (`/api/payments/verify`, chamada pela `/payment/return`) — confirma `paid` **sem depender do webhook/cron** (o webhook do Paysuite aponta para outro projeto e o cron não corre no Railway). É o que evita o pedido ficar preso em "A processar".
> - **Reskin iFood do painel** (migration `0021` KPIs): novo `layout.tsx` (sidebar vertical + topbar + drawer mobile, tema vermelho `#EA1D2C`); `pedidos/page.tsx` com 6 KPIs (faturado/pedidos hoje, em preparo, prontos, cancelados, avaliação média), abas de status, tabela (desktop) + cards (mobile). `order-status` com labels PT + verde para `paid`. `MTn`→`MT` (formatMT) em menu/checkout/order-status/painel.
> - **Skill `/connect-paysuite`** (`.claude/skills/`) com o runbook + gotchas para ligar o gateway num cliente novo.
> - **Migrations aplicadas na cloud:** `0013`–`0021` (a cloud está à frente do `supabase db reset` local; ver nota de drift abaixo).
>
> **Pendente de verificação com Supabase real:** `supabase db reset` local (a cloud foi migrada via MCP — versões diferem das locais; migrations são idempotentes) + `packages/db/tests/rls.test.ts` + XPrinter físico + configurar o webhook do Paysuite no painel deles (opcional — a verificação ativa cobre) + cron de reconciliação no Railway (opcional).
> **Próximo passo:** CHECKPOINT 1 (demo ao 1º cliente); estender o reskin iFood às outras tabs; **F10 — Layout da Loja** (formato visual + mini banners, spec em `(public)/CLAUDE.md §10` + `(public)/ROADMAP.md F10`); FASE 5 (referral) se quiser.

> **Disciplina:** ler `CLAUDE.md` inteiro + a fase. Antes de codar, listar ficheiros a criar/alterar e plano de testes.
> Reaproveitar do QR MESAS (CLAUDE.md secção 13) em vez de reescrever. Single-tenant: zero `tenant_id`, zero planos.

---

## FASE 0 — Fundação + Demo de pagamento manual (1º marco)

🎯 Objetivo do checkpoint: **cliente faz pedido no site → escolhe levantamento/entrega + horário → "paga" via M-Pesa/e-Mola e envia comprovativo → dono recebe email + vê no painel → Aprova/Nega → cliente recebe email.** Sem Paysuite, sem impressora.

### F0.1 🔴 Esqueleto do monorepo + reaproveitamento

**PROMPT:**
> Lê o `CLAUDE.md` (secções 2, 3, 13, ⚡). Cria o esqueleto: pnpm workspaces + Turborepo com `apps/web` (Next.js 14 App Router + TS + Tailwind + shadcn/ui), `packages/core`, `packages/db`, `packages/paysuite`, `services/print-bridge`, e `config/brand.ts`. **Porta do QR MESAS** (`C:\Users\Gabriel\Desktop\QR MESAS`): `packages/core/src/money.ts` e `order-machine.ts` (intactos), `packages/paysuite/src/*` (intacto), `services/print-bridge/src/*` (remove `TENANT_ID`). **NÃO** portar `plans.ts`. Cria `config/brand.ts` com os tokens do tema HawSmash (`--gold #e5a93c`, fundo escuro, fontes) mapeados para o Tailwind. Configura Vitest, ESLint, tsconfig partilhado e os scripts da secção 10 (os que ainda não funcionam apontam para `echo TODO`). Não implementes lógica de domínio nova. 1 teste trivial por package a provar que o Vitest corre.

**DoD:**
- [x] `pnpm install && pnpm lint && pnpm test && pnpm dev` funcionam (lint/test/build verdes)
- [x] `apps/web` abre com o tema escuro/dourado
- [x] `money.ts`, `order-machine.ts` e `packages/paysuite` portados, testes a passar (47), **sem** `tenant_id`/planos
- [x] Commit `chore: monorepo skeleton + reuse core/paysuite/print-bridge` (`1cef5f3`)

### F0.2 🔴 Banco single-tenant + RLS + RPCs públicas

**PROMPT:**
> Lê o `CLAUDE.md` (secções 4, 7, 12, 14). Cria `packages/db/migrations/0001_core.sql`: tabelas `settings` (singleton), `menu_categories`, `menu_items`, `delivery_zones`, `orders`, `order_items`, `event_log` (DDL da secção 4); RLS em TODAS (template 14.1 — `anon` sem policy); RPCs `SECURITY DEFINER` `get_menu()`, `get_order_status(p_order_id)` e `create_order(p_payload jsonb)`. O `create_order` valida itens contra `menu_items` (**preço do BANCO**), valida a zona e calcula `delivery_fee_cents`, valida o `scheduled_for` (slot futuro dentro de `open_hour`–`close_hour` ou null=AGORA), cria o pedido em `awaiting_approval` (flow `manual`), grava snapshots e `event_log`, gera `order_number`, retorna `order_id`. Cria `seed.sql` (settings demo, 3 categorias, ~8 itens em centavos, 3 zonas) e `tests/rls.test.ts` (Vitest contra Supabase local): (a) anon não lê tabela nenhuma; (b) `get_menu` devolve menu+zonas; (c) preço/taxa adulterados no payload não afetam o total; (d) horário inválido é rejeitado.

**DoD:**
- [x] ⏳ `supabase db reset` aplica migration + seed (migrations escritas; não corridas aqui — sem Supabase local)
- [x] ⏳ Testes de RLS/RPC (`packages/db/tests/rls.test.ts` escritos; requerem `supabase start`)
- [ ] `pnpm db:types` gera tipos (requer Supabase local)
- [x] Commit `feat(db): single-tenant core schema + public RPCs` (`0974015`)

### F0.3 🔴 Loja do cliente (cardápio → carrinho → checkout manual → status)

**PROMPT:**
> Lê o `CLAUDE.md` (secções 6.1, 7, 14.2). Implementa a rota pública `/`: `get_menu()`, cardápio por categoria (foto, preço com `formatMT`), carrinho client-side (TanStack Query + estado local), e `/checkout`: nome + telefone, **Levantamento ou Entrega** (se entrega: escolher zona → taxa somada, morada obrigatória), **agendamento** (Agora ou slots de 30 min do dia), escolha **M-Pesa/e-Mola**. Ao enviar → `create_order` → pedido `awaiting_approval`. Ecrã de pagamento manual: mostra número+nome do `settings`, instruções, e **upload do comprovativo** para o bucket privado `payment-proofs` (guarda `payment_proof_path`). Cria a migration `0002_storage.sql` (bucket privado + policies). Página `/order-status/[orderId]` faz polling de `get_order_status`. Mobile-first (360px).

**DoD:**
- [x] ⏳ Menu → carrinho → entrega+zona+horário → criar pedido (carrinho completo: `useCart` + Adicionar/stepper + drawer no `/menu` → `/checkout`; falta run com BD)
- [x] ⏳ Comprovativo no bucket privado + `attach_payment_proof` → `payment_proof_path`; pedido em `awaiting_approval`
- [x] Total = subtotal + taxa da zona (recalculado no servidor em `create_order`)
- [x] Commit `feat(web): storefront + manual checkout with proof upload` (`a133a02`)

### F0.4 🔴 Painel: tab Pedidos + emails transacionais

**PROMPT:**
> Lê o `CLAUDE.md` (secções 5, 8). Implementa o painel admin (auth Supabase) com o shell de tabs (**Pedidos · Caixa · Análise · Feedback · Lista de Espera**) no visual HawSmash — só a tab **Pedidos** funcional nesta fase. Pedidos: cards de stat no topo, busca, filtros, vista **Lista** e **Calendário** (agrupar por dia/horário). Botões **Aprovar** (RPC `advance_order` APPROVE → `approved`) e **Negar** (`CANCEL` com motivo → `cancelled`), **Ver comprovativo** (`createSignedUrl`). Route handlers de email (Resend): em `create_order` → email ao `OWNER_EMAIL` ("novo pedido + comprovativo"); em Aprovar → email ao cliente ("pagamento confirmado"); em Negar → email ao cliente ("pagamento não confirmado"). Reaproveita o padrão de `orders-section.tsx` do QR MESAS (sem gating por plano).

**DoD:**
- [x] ⏳ Login do dono (`/login`) → tab Pedidos com lista e calendário (falta run com BD)
- [x] "Ver comprovativo" gera signed URL do bucket privado (`createSignedUrl`)
- [x] ⏳ Aprovar/Negar via `advance_order` + emails (dono no comprovativo; cliente na aprovação/recusa, se deu email)
- [x] `kitchen` não acede ao painel (`role=kitchen` → redirect); `authenticated` acede
- [x] Commit `feat(admin): orders tab (list+calendar), approve/deny, transactional emails` (`76f01b8`)

🎉 **CHECKPOINT 1: demo de pagamento manual ponta-a-ponta. Já dá para mostrar/vender. Marcar conversas com restaurantes ANTES de continuar.**

---

## FASE 1 — Painel completo (ADD PRODUTOS, Caixa, Análise, Feedback)

### F1.1 🟡 ADD PRODUTOS — gestão de cardápio + zonas + settings

**PROMPT:**
> Lê o `CLAUDE.md` (secção 8). Implementa a gestão de cardápio: CRUD de `menu_categories` e `menu_items` (nome, descrição, **preço MT→centavos no submit**, foto via Storage, toggle `available`, e os campos de **estoque** `track_stock`/`stock_qty` já no formulário). CRUD de `delivery_zones` (nome, taxa). Edição de `settings` (números/nomes M-Pesa/e-Mola, morada, horários `open_hour`/`close_hour`/`slot_minutes`, `accepting_orders`). Reaproveita `menu-section.tsx` do QR MESAS, sem gating por plano. Migration aditiva se faltar coluna.

**DoD:**
- [x] ⏳ Dono cria item com foto/preço/descrição → aparece na loja imediatamente (código implementado; falta run com Supabase real)
- [x] ⏳ Dono cria/edita zona de entrega → reflete no checkout
- [x] ⏳ Dono fecha a loja (`accepting_orders=false`) → checkout bloqueado com aviso
- [x] Commit `feat(admin): menu CRUD, delivery zones, settings` (`4e82668`)

### F1.2 🟡 Caixa (fecho do dia)

**PROMPT:**
> Lê o `CLAUDE.md` (secção 8). Migration `cash_sessions` + RPCs `open_cash_session()` / `close_cash_session(p_counted_cents, p_notes)` (SECURITY DEFINER; o fecho calcula o esperado a partir dos pagamentos confirmados do período, congela snapshot imutável em `report`, grava `event_log`). Tab **Caixa**: painel ao vivo (total pedidos, faturado, entregues, por fechar, vendido por unidade — como na screenshot), botão **Fechar caixa**, notas, **histórico**, **download PDF** e **email** do fecho. Reaproveita o desenho de fecho de caixa do QR MESAS.

**DoD:**
- [x] ⏳ Dia com pedidos: "Fechar caixa" mostra o esperado certo e regista o fecho (código implementado; falta run com Supabase real)
- [x] ⏳ Fecho gera PDF e envia email; histórico lista fechos anteriores
- [x] ⏳ Fecho de ontem não muda quando entram pedidos hoje (imutável — snapshot em `report`)
- [x] Commit `feat(admin): cash session close with PDF + email` (`6bcd0d3`)

### F1.3 🟢 Análise (dashboard)

**PROMPT:**
> Lê o `CLAUDE.md` (secção 8). Migration com views de métricas (faturação dia/semana/mês, ticket médio, top itens, **Como recebem: Levantamento vs Entrega**, horários de pico/heatmap, clientes que mais compraram) — adapta `0010_dashboard_views.sql` do QR MESAS para single-tenant. Tab **Análise** (Recharts) com filtros 7 dias / 30 dias / tudo, igual à screenshot. Teste: views batem com um seed conhecido.

**DoD:**
- [x] ⏳ Métricas batem com o seed (views SQL implementadas; falta run com Supabase real)
- [x] ⏳ Split Levantamento/Entrega visível; heatmap de horários; top clientes
- [x] Commit `feat(admin): analytics dashboard` (incluído em `c19be80`)

### F1.4 🟢 Feedback + Lista de Espera

**PROMPT:**
> Lê o `CLAUDE.md` (secção 8). Tabelas `order_feedback` e `waitlist` (INSERT anon **com rate-limit no DB**, ler só `authenticated`). UI pública: pedir feedback após entrega; captar contacto quando a loja está fechada (`accepting_orders=false`). Tabs **Feedback** e **Lista de Espera** no painel.

**DoD:**
- [x] ⏳ Cliente envia feedback → aparece na tab Feedback (código implementado; falta run com Supabase real)
- [x] ⏳ Loja fechada → captura na Lista de Espera; rate-limit testado
- [x] Commit `feat(admin): feedback + waitlist` (incluído em `c19be80`)

---

## FASE 2 — Pagamento automático (Paysuite) + Impressora térmica

### F2.1 🟡 Paysuite (fluxo digital)

**PROMPT:**
> Lê o `CLAUDE.md` (secção 6.2/6.4) e a secção 6 do CLAUDE do QR MESAS. Liga o `PaysuiteProvider` (já portado): `/api/payments` cria checkout e redireciona para `checkout_url`; `/api/webhooks/paysuite` (HMAC do raw body, idempotência por `data.reference`, eventos `payment.success`/`payment.failed`); `confirm_payment` (RPC transacional, validações da secção 6.4); `/payment/return` faz polling; cron `/api/cron/reconcile` a cada 5 min para pendências > 5 min. No checkout, opção "Pagar automático" cria o pedido em `awaiting_payment` (flow `digital`). Chaves via env (single-tenant, **sem** encriptação por-tenant). Emails em sucesso/falha. Mensagens de erro em PT.

**DoD:**
- [x] ⏳ Fluxo com `PAYMENT_PROVIDER=mock`: pedido → redirect → "paga" → webhook → `paid` → aparece no painel (código + testes mock; falta run e2e)
- [x] ⏳ Webhook duplicado (mesmo `reference`) → 200 sem efeito; assinatura inválida → 401
- [x] ⏳ Reconciliação corrige webhook perdido em ≤ 5 min
- [x] **Paysuite configurável no admin** (tab Definições → secção Paysuite, padrão masked): `payment_provider` + `paysuite_api_key` + `paysuite_webhook_secret` em `settings` (migration `0019`); rotas leem settings→env (`lib/payments/config.ts`).
- [x] **Token real validado** contra `paysuite.tech/api/v1/payments` → HTTP 201 + checkout_url.
- [x] **Bugfix crítico:** Paysuite exige `reference` **só alfanumérico** (devolvia 422 com `order_<uuid>`). `lib/payments/reference.ts` (`orderToReference`/`referenceToOrderId`, 4 testes) usado em checkout/webhook/reconciliação com idempotência consistente.
- [ ] (E2E real no deploy: pagar via checkout_url → webhook → `paid` — pendente de push + webhook URL no painel Paysuite)
- [x] Commit `feat(payments): Paysuite digital flow, HMAC webhook, reconciliation` (`5e20d48`) + fix (`cabb21b`) + admin config & reference fix

### F2.2 🟡 Impressora térmica (print-bridge 24/7)

**PROMPT:**
> Lê o `CLAUDE.md` (secção 9) e o `README.md` (secção "Formato do Cupom Térmico"). Liga o `print-bridge` (já portado, sem `TENANT_ID`) com estas três tarefas:
>
> **(1) Payload completo no print_job** — os RPCs `confirm_payment` (pedido `paid`) e `advance_order APPROVE` (pedido `approved`) devem criar o `print_job` com payload completo:
> ```ts
> { order_number, customer_name, customer_phone,
>   fulfillment_type, delivery_zone, address, scheduled_for,
>   items: [{ name, qty, notes }],
>   payment_method, payment_status,
>   subtotal_cents, delivery_fee_cents, total_cents, created_at }
> ```
> Se o payload já existia mas era mínimo (v. migration 0009), adiciona migration aditiva para não quebrar dados.
>
> **(2) Actualizar `services/print-bridge/src/escpos.ts`** para o formato padrão moçambicano (ref: PRAIA SHOPPING LDA, Maputo). Papel **58 mm (~48 chars/linha, codepage CP1252)**:
>
> ```
> ================================================
>       NOME DO RESTAURANTE (brand.ts)
>       www.restaurante.co.mz
> ================================================
> PEDIDO: ENC-0042         14/06/2026  14:25
> ================================================
> CLIENTE: MARIA ALBERTINA       ← double-height bold
> TEL:     +258 84 123 456
> ================================================
> ** ENTREGA **   (ou  ** LEVANTAMENTO **)  ← bold, centrado
> Zona:    Sommerschield
> Morada:  Av. Julius Nyerere, 100
> HORARIO: 14:30  (ou  HORARIO: AGORA)
> ================================================
> Descricao              Qty       Total
> ------------------------------------------------
> Caril de Camarao        x2    130.00 MT
>   > bem apimentado
> Sumo de Manga           x1     25.00 MT
> ================================================
> Subtotal:                     155.00 MT
> Taxa de entrega:               20.00 MT   ← omitir se pickup
> ================================================
> TOTAL:                        175.00 MT   ← double-height bold
> ================================================
> [ PAGO VIA M-PESA ]                       ← bold, centrado
> (ou: [ PAGAR NA ENTREGA ] / [ PAGAR NO LEVANTAMENTO ])
> ================================================
> Obrigado! Bom apetite!                    ← centrado
> 14/06/2026  14:25:33                      ← centrado
> ================================================
>                                           ← feed 3 linhas + GS V 0x00 (corte)
> ```
>
> Regras de layout: nome do item truncado a 22 chars; qty `xN` alinhado à col 23; total em MT alinhado à direita; nota do item começa com `  > `; taxa de entrega só aparece se `delivery_fee_cents > 0`; `payment_status='paid'` → `PAGO VIA <MÉTODO>`, senão `PAGAR NA ENTREGA/LEVANTAMENTO`.
>
> **(3) Bridge poll** — `print_jobs.queued` (3 s) → ESC/POS → TCP `ip:9100` → `printed`; retry 3× com backoff exponencial (1 s, 3 s, 9 s) → `failed` + `event_log`. Falha de impressão NUNCA bloqueia o pedido no painel. Mantém `printer-sim` para `pnpm bridge:dev` (decode CP1252 → console legível).

**DoD:**
- [x] `pnpm bridge:dev` mostra o cupom decodificado no console ao aprovar/pagar pedido — **7 testes escpos + 15 testes integração verdes**
- [x] Cupom segue o formato PRAIA SHOPPING: separadores `=`, itens com qty+total alinhados, TOTAL double-height
- [x] Taxa de entrega só aparece em pedidos de entrega; campo omitido em levantamento
- [x] Falha de impressão NÃO esconde o pedido no painel (job → `failed` + event_log)
- [ ] (XPrinter real via LAN — pendente de hardware)
- [x] Commit incluído em `feat(ops): atomic stock + device heartbeats` (`86d6be2`)

### F2.3 🟢 Estoque + heartbeats

**PROMPT:**
> Lê o `CLAUDE.md` (secções 8, 9, 14.4). Dedução atómica de `stock_qty` no `confirm_payment`/aprovação (padrão 14.4), trigger `stock_qty=0 → available=false`, ajustes manuais logados no admin. Heartbeat do print-bridge/admin (`device_heartbeats`, upsert 60s) com indicador online/offline no painel. Testes: pedido com item esgotado → rollback total; 2 pedidos a disputar o último item → só 1 confirma.

**DoD:**
- [x] Rollback total quando item esgota dentro da transação (teste verde) — **testes de stock passam**
- [x] ⏳ Concorrência: só 1 dos 2 pedidos confirma o último item (lógica implementada; teste de concorrência real requer BD)
- [x] ⏳ Painel mostra impressora online/offline (heartbeat implementado; falta run com BD)
- [x] Commit `feat(ops): atomic stock + device heartbeats` (`86d6be2`) + fix (`cabb21b`)

---

## FASE 3 — Empacotar para revenda (turnkey)

### F3.1 🟡 Onboarding self-service do template

**PROMPT:**
> Lê o `CLAUDE.md` (secção 15). Cria `.env.example`, `config/brand.example.ts`, e um `README.md` "Como instalar para um cliente novo" (clonar → editar `brand.ts` + assets → `.env` → `pnpm db:migrate && db:seed` → configurar settings/menu/zonas no admin → deploy Vercel → opcional print-bridge). Script `pnpm setup:client` que valida `.env` e `brand.ts` e corre as migrations. Checklist de entrega por cliente.

**DoD:**
- [x] Um restaurante novo fica operacional em < 30 min seguindo o README (`.env.example` + `config/brand.example.ts` + README turnkey + checklist `docs/onboarding-checklist.md`), sem editar lógica
- [x] `pnpm setup:client` falha com mensagem clara se faltar env/brand (validado: sem `.env` → erro + exit 1; `PAYMENT_PROVIDER=paysuite` sem chaves → erro; placeholders rejeitados) — **12 testes Vitest verdes**
- [x] Commit `docs(template): client onboarding + setup script`

---

## Extras (pós-roadmap)

### EX.1 🟢 Importação de cardápio (formato canónico `menu.json`)

Padrão aceito para carregar produtos em massa (ex.: "organiza os produtos do site X" → ficheiro → loja).
Agnóstico de design: alimenta a BD; qualquer front lê via `get_menu()`.

- Formato + spec: [`docs/menu-format.md`](docs/menu-format.md) + [`examples/menu.example.json`](examples/menu.example.json)
- Schema/validação + conversão de preço (centavos via money.ts): `packages/core/src/menu-import.ts`
- Absorvedor reutilizável: RPC `import_menu(p_payload jsonb)` (idempotente, `authenticated`) — migration `0013`
- CLI: `pnpm menu:import <ficheiro.json> [--dry-run]`

**DoD:**
- [x] `pnpm menu:import … --dry-run` valida e mostra resumo (preços convertidos) — testado
- [x] Erro claro com nome do item em preço/JSON inválido — testado; **9 testes Vitest (menu-import)**
- [x] ⏳ RPC `import_menu` aplica upsert idempotente por nome (migration escrita; falta run com Supabase real)
- [x] Commit `feat(admin): canonical menu import (menu.json) + import_menu RPC + CLI`

### EX.2 🟡 Paysuite go-live (config no admin + verificação ativa)

Pagamento automático Paysuite ligado e **validado com pagamento real M-Pesa** em produção (Railway).

- Provider configurável no admin: Definições → Paysuite (`paysuite_section.tsx`), chaves em `settings` (migration `0019`, segredos B), `lib/payments/config.ts` lê settings→env.
- `lib/payments/reference.ts` — `reference` alfanumérico (`ord`+hex); `resolvePublicBase` — URLs com esquema.
- `/api/payments/verify` — verificação ativa na página de retorno (não depende do webhook/cron).
- Skill [`/connect-paysuite`](.claude/skills/connect-paysuite/SKILL.md).

**DoD:**
- [x] Pagamento real M-Pesa → `paid` + `payments` + `print_job` (validado contra a API real)
- [x] Chaves no admin (mascaradas); rotas leem settings→env; reference/return_url corrigidos (4 testes reference)
- [x] Página de retorno confirma sem webhook (verify); commit `feat(payments): Paysuite admin config + reference fix` + `feat(payments): active payment verification`
- [ ] (Opcional) webhook URL no painel Paysuite a apontar para este deploy + cron de reconciliação no Railway

### EX.3 🟢 Reskin iFood do painel admin (responsivo)

Painel admin reestilizado ao estilo iFood (referência do dono).

- `layout.tsx`: sidebar vertical + topbar + drawer mobile, tema vermelho `#EA1D2C`.
- `pedidos/page.tsx`: 6 KPIs (migration `0021`: faturado/pedidos hoje, em preparo, prontos, cancelados, avaliação média), abas de status, tabela (desktop) + cards (mobile). Preserva aprovar/negar/avançar/comprovativo/modal.
- `order-status`: labels PT + verde para `paid`. `MTn`→`MT` (formatMT).

**DoD:**
- [x] Layout sidebar + KPIs + tabela/cards responsivos; lint/build verdes
- [x] `get_order_stats` estendido (migration `0021`, aplicado na cloud)
- [x] Commit `feat(admin): iFood-style dashboard — sidebar layout + Pedidos KPIs/table`
- [ ] Estender o reskin às outras tabs (Caixa/Análise/Cardápio/…) — pendente

---

## FASE 4 — Marketing & Tracking (GTM + GA4 + Meta + Ads + CAPI) — spec COMPLETA

> 🎯 Funil inteiro medido em GTM/GA4/Meta Pixel/Google Ads, eventos first-party como fonte de verdade, e
> atribuição protegida contra iOS/adblock com Meta CAPI + Google Enhanced Conversions. KPIs no painel **Análise**.
> Single-tenant: config em `settings`, **sem** `tenants`/`tenant_id`. Ler `CLAUDE.md` secção 16 (completa).

### F4.1 🟢 Config de marketing 100% no admin (IDs públicos + tokens secretos)

**PROMPT:**
> Lê `CLAUDE.md` (16.2). Migration aditiva `0014_tracking.sql`: em `settings`, campos (A) públicos — `gtm_container_id`, `meta_pixel_id`, `ga4_measurement_id`, `gads_conversion_id`, `gads_conversion_label` — e (B) secretos — `meta_capi_token`, `gads_developer_token`. `get_menu()` devolve **SÓ** (A), com colunas listadas explicitamente (nunca `select *`). Os secretos (B) são lidos só server-side (service role ou RPC `get_secret_settings()` restrita a `authenticated`); precedência: `settings` (B) → fallback `.env`. Admin → tab **Marketing** (owner only): inputs com link "onde encontrar"; tokens **mascarados** (`••••1234` + "Substituir"); **botão "Testar ligação"** (valida CAPI/Ads sem expor token); **preview do `dataLayer`**. Mantém `META_CAPI_TOKEN`/`GOOGLE_ADS_DEVELOPER_TOKEN` no `.env.example` como fallback opcional.

**DoD:**
- [x] Dono cola IDs **e** tokens na tab Marketing (`/marketing`) → tudo configurado sem tocar em `.env` (migration `0014` + `marketing-section.tsx`)
- [x] ⏳ `get_menu()` devolve só os campos (A); **nenhum** token (B) sai em RPC anon (`packages/db/tests/tracking.test.ts` escrito; requer `supabase start`)
- [x] Tokens mascarados na UI (`••••1234` + "Substituir"); preview do `dataLayer` na tab _(botão "Testar ligação" fica para F4.5 quando houver chamada server-side a validar)_
- [x] `pnpm lint && pnpm test` verdes (83 testes); commit `feat(admin): marketing config in settings (public IDs + secret tokens) + tab`

### F4.2 🟢 Módulo de tracking + funil do storefront

**PROMPT:**
> Lê `CLAUDE.md` (16.1, 16.3, 16.4, 16.7). Cria `apps/web/lib/analytics/track.ts` (único lugar que toca `dataLayer`/`fbq`/`gtag`): `loadGTM`, `trackViewMenu`, `trackViewItem`, `trackAddToCart`, `trackBeginCheckout`, `trackAddPaymentInfo`, `trackLead`, `trackCouponApplied` (+ `trackPurchase` usado em F4.3). Banner de consentimento PT (cookie `dl_consent`): GTM/Pixel/Ads só carregam após "Aceitar". Instrumenta storefront/checkout nos gatilhos da tabela 16.4. NENHUM componente chama `fbq`/`gtag` direto.

**DoD:**
- [x] Eventos do funil disparam nos gatilhos certos (`view_menu`, `add_to_cart`, `begin_checkout`, `add_payment_info`, `lead`); componentes só chamam `track*()` — `fbq`/`gtag`/`dataLayer` vivem só em `lib/analytics/track.ts`
- [x] Sem consentimento (`dl_consent`) → `initTracking` não carrega script nenhum (banner em `AnalyticsProvider`)
- [x] Manual do dono em `docs/marketing-setup.md` (onde achar cada ID + FAQ) + link na tab Marketing
- [x] `pnpm lint && pnpm test` verdes (91 testes; 8 novos de tracking); commit `feat(web): tracking module + consent + funnel events`

### F4.3 🟢 `purchase` no order-status (regra crítica + items[])

**PROMPT:**
> Lê `CLAUDE.md` (16.1, 16.3, 16.5). Estende `get_order_status` para devolver `order_items(menu_item_id, name_snapshot, qty, unit_price_cents)`. Em `/order-status/[orderId]`, `trackPurchase` dispara **APENAS** quando `status ∈ {paid, approved}`, com guard `useRef` **+** `localStorage['tracked_purchase_<orderId>']`. Push na ordem: `ecommerce:null` → GA4 (`transaction_id`, `value` MT via money.ts, `currency:'MZN'`, `items[]`) → Google Ads `conversion` (`send_to`) → `fbq Purchase` com `eventID:'purchase_<orderId>'`, `content_ids`, `contents[]`. Testes: `purchase` não dispara fora de paid/approved; não re-dispara em reload (localStorage); value correto via money.ts.

**DoD:**
- [x] `purchase` só em `paid`/`approved`; nunca no submit do checkout (guard `shouldFirePurchase` + `isPurchaseStatus` — **7 testes**)
- [x] Não re-dispara em reload (ref `useRef` + `localStorage['tracked_purchase_<orderId>']`); `items[]`/`contents[]` preenchidos via `order_items` (migration `0015` estende `get_order_status`); value via money.ts
- [x] Commit `feat(analytics): purchase event with dedup + item details`

### F4.4 🟢 First-party events + KPIs no painel

**PROMPT:**
> Lê `CLAUDE.md` (16.6, 16.9). Migration `analytics_events` (aditiva, RLS 14.1). Rota `POST /api/track` (Zod + `session_id` cookie + `customer_phone` se identificado; insere via service role, **anon nunca direto**). Espelha os eventos de funil para first-party. View SQL do funil (taxas de conversão por etapa + utm). Aba **Análise**: funil + origem + ROAS aproximado. Testes: view bate com seed; anon não insere direto.

**DoD:**
- [x] `analytics_events` gravado só via `/api/track`; funil + utm visíveis na aba Análise
- [x] View do funil bate com seed conhecido (12 testes: 4 sessões seed → 75%/66.7%/100%/50%)
- [x] Commit `feat(analytics): first-party funnel + conversion KPIs`

### F4.5 🟢 Server-side: Meta CAPI + Google Enhanced Conversions

**PROMPT:**
> Lê `CLAUDE.md` (16.8). Em `confirm_payment` (digital → `paid`) e no handler de `advance_order APPROVE` (manual → `approved`), disparar **fire-and-forget** (nunca bloqueia o pedido): Meta Conversions API com `event_id:'purchase_<orderId>'` (dedup com o browser) usando `META_CAPI_TOKEN`; Google Offline/Enhanced Conversion com `transaction_id=order.id` usando `GOOGLE_ADS_DEVELOPER_TOKEN`. Falha → log em `event_log`, pedido segue. Testes: falha de envio não altera estado do pedido; event_id igual ao do browser.

**DoD:**
- [x] CAPI/Enhanced disparam na confirmação (digital e manual) com o mesmo `event_id`/`transaction_id` do browser
- [x] Falha server-side nunca afeta o pedido (log em event_log, fire-and-forget) — 7 testes verdes
- [x] Commit `feat(analytics): Meta CAPI + Google Enhanced Conversions (server-side)`

---

## FASE 5 — Indique e Ganhe + Presente/Cupom

> 🎯 Código de indicação por pessoa; amigo aplica → ganha desconto ou item grátis. Auto-resgate bloqueado,
> 1 resgate por código/cliente, tudo validado no servidor. Ler `CLAUDE.md` secção 17 + schema 19.

### F5.1 🟢 Cupom/referral no servidor

**PROMPT:**
> Lê `CLAUDE.md` (17.1, 19). Migration aditiva: `referral_codes`, `referral_redemptions`, `menu_items.is_gift`, `orders.referral_code/discount_cents/gift_item_id`. RPC `validate_referral(p_code, p_phone)` (read-only, SECURITY DEFINER → `{valid, reward_type, reward_value, gift_item}`). Estende `create_order`: aceita `referral_code` no payload, revalida (auto-resgate `owner_phone==customer_phone` → rejeita; já resgatado → rejeita; mesmo telefone repetido → rejeita; inativo/expirado → rejeita), aplica desconto/brinde **a preço 0**, no máx 1 item `is_gift`, grava `referral_redemptions` + `event_log`. Total recalculado no servidor. Testes Vitest: auto-resgate rejeitado; 2º resgate rejeitado; item `is_gift` sem cupom é recusado; desconto adulterado no payload é ignorado.

**DoD:**
- [x] Auto-resgate e resgate duplicado rejeitados (teste verde)
- [x] Item grátis só entra com cupom válido, máx 1; total recalculado no servidor
- [x] Commit `feat(referral): server-validated coupons + gift items`

### F5.2 🟢 Barra de código + categoria "SEU PRESENTE" no front

**PROMPT:**
> Lê `CLAUDE.md` (17.2). Barra abaixo da hero: "Coloque aqui o código do seu amigo" → `validate_referral` → libera categoria **SEU PRESENTE** (1 item a 0, só preview) e/ou mostra desconto previsto. O código viaja no `p_payload` do checkout; preço final só do `create_order`. Geração de código estável por cliente. `track('coupon_applied')`.

**DoD:**
- [x] Código válido libera 1 presente + mostra desconto previsto (preview); inválido dá erro PT
- [x] Preview nunca define o total — confirmado pelo servidor no `create_order`
- [x] Commit `feat(web): referral bar + SEU PRESENTE category`

---

## FASE 6 — Entrada personalizada + Gamificação

> 🎯 Tela de entrada (gate) pedindo telefone → personaliza (favoritos/últimas compras). Modo "energizado":
> carrinho cresce → site brilha; bater meta → brinde. Ler `CLAUDE.md` secção 18.

### F6.1 🟢 Gate de entrada + personalização soft

**PROMPT:**
> Lê `CLAUDE.md` (18.1, 19). Migration `customers` (aditiva). RPC `identify_customer(p_phone, p_name?)` (SECURITY DEFINER): upsert + devolve histórico LEVE (favoritos derivados, resumo das últimas compras) — **nunca** morada/comprovativo/pagamento (`// DECISÃO:` soft login sem OTP). Tela de entrada não-scrollável com imagem de `brand.ts` + campo telefone + "Entrar" (e link "ver cardápio" para pular). Cookie `dl_phone`. Favoritos com ❤️ e "Pedir de novo".

**DoD:**
- [ ] Telefone conhecido → favoritos + últimas compras; RPC não devolve PII sensível
- [ ] Gate pulável (não bloqueia venda); telefone liga aos `analytics_events`
- [ ] Commit `feat(web): entry gate + soft personalization`

### F6.2 🟢 Modo energizado + meta de brinde

**PROMPT:**
> Lê `CLAUDE.md` (18.2, 19). Aditivos `settings.gift_goal_cents`/`gift_goal_item_id`. Brilho progressivo do site/botão Finalizar derivado do subtotal (CSS `--gold`, sem libs pesadas). Barra "Faltam X MT para o seu brinde 🎁". Ao bater a meta, o **`create_order`** adiciona o item-prémio a 0 (validado no servidor, não no client). Teste: brinde concedido só quando subtotal ≥ meta no servidor; client adulterado não força brinde.

**DoD:**
- [ ] Brilho/progresso reativos ao carrinho; brinde concedido só pelo servidor ao bater a meta
- [ ] Client adulterado não força brinde (teste verde)
- [ ] Commit `feat(web): gamified cart glow + gift goal`

---

## FASE 7 — CRM, Fidelização & Email Marketing do dono

> 🎯 A `customers` (já existe na BD, sem ecrã) vira **base de clientes gerível**: CRM no admin, email/aniversário
> **opcionais** com consentimento, **presente automático no aniversário** (reusa o motor de cupom da FASE 5), e o
> dono passa a **gerir os templates de email** (com padrão editável, sem poder partir o sistema). Ler `CLAUDE.md`
> §20 e §21. Single-tenant: zero `tenant_id`, tudo em `settings`/`customers`, **consentimento obrigatório p/ marketing**.
>
> ⚠️ Correção a fazer já na F7.1: a tab "Clientes" do NAV aponta hoje para `/lista-espera` (Lista de Espera). O CRM
> real é novo (`/clientes`); a `customers` tem dados à espera de vista.

### F7.1 🟡 Tab Clientes (CRM real) + campos opcionais

**PROMPT:**
> Lê `CLAUDE.md` (§20.1, §20.3). Migration aditiva: em `customers` adiciona `email`, `birthday`, `notes`,
> `marketing_opt_in bool default false`, `tags text[] default '{}'`, `birthday_gift_issued_year int`. RPCs
> `authenticated`: `admin_list_customers(p_limit,p_offset,p_search,p_sort)` (telefone/nome/email, nº pedidos, total
> gasto, last_seen, opt-in) e `admin_update_customer(p_phone,p_patch jsonb)` (notes/tags/opt-in). Corrige o NAV em
> `apps/web/app/(admin)/layout.tsx`: adiciona `/clientes` = "Clientes" (CRM) e muda o label de `/lista-espera` para
> "Lista de Espera". Cria a página `/clientes` (lista + busca + ordenação + export CSV) no estilo iFood do painel.
> Estende `create_order` e `identify_customer` para aceitar `email`/`birthday`/`marketing_opt_in` **OPCIONAIS** e fazer
> upsert (nunca obrigatórios; vazio não apaga). Testes Vitest: anon não lê `admin_list_customers`; email/aniversário
> inválidos não bloqueiam o pedido; upsert não apaga dado existente quando o campo vem vazio.

**DoD:**
- [ ] Tab "Clientes" abre o CRM real (não a lista de espera); "Lista de Espera" tem label próprio
- [ ] `admin_list_customers` só por `authenticated`; busca/ordenação/CSV funcionam
- [ ] `create_order`/`identify_customer` gravam email/aniversário/opt-in opcionais **sem bloquear a venda**
- [ ] `pnpm lint && pnpm test` verdes; commit `feat(admin): real customer CRM + optional email/birthday/opt-in`

### F7.2 🟢 Presente de aniversário automático (reusa cupom FASE 5)

**PROMPT:**
> Lê `CLAUDE.md` (§20.2, §17). Migration aditiva em `settings`: `birthday_gift_enabled`, `birthday_reward_type`,
> `birthday_reward_value`, `birthday_gift_item_id`, `birthday_valid_days default 7`. Cron `/api/cron/birthdays`
> (protegido por `CRON_SECRET`): encontra `customers` com aniversário = hoje (mês/dia) **e** `marketing_opt_in`, emite
> para cada um um `referral_codes` pessoal (max_redemptions 1, `expires_at = hoje + birthday_valid_days`, reward =
> config) e avisa por email se houver (template `birthday_gift`). **Idempotente por ano** (`birthday_gift_issued_year`).
> Widget "Aniversários de hoje/da semana" no CRM. UI em Definições para configurar o prémio. Testes: cron não emite
> 2× no mesmo ano; só a quem deu opt-in; o código emitido resgata pelo fluxo normal de cupom (§17).

**DoD:**
- [ ] Aniversariante opt-in recebe cupom pessoal 1×/ano; resgate pelo fluxo §17
- [ ] Config do prémio no admin; widget de aniversários no CRM
- [ ] Cron idempotente (teste verde); commit `feat(crm): automatic birthday gift coupon + cron`

### F7.3 🟡 Gestor de templates de email (padrão editável)

**PROMPT:**
> Lê `CLAUDE.md` (§21). Migration `email_templates(key,subject,body_html,enabled,updated_at)` (RLS staff_all). Cria
> `apps/web/lib/email/render.ts` (substitui `{{variáveis}}` com dados do **SERVIDOR**, sanitiza) e `loadTemplate(key)`
> com fallback para os HTML padrão embutidos (extraídos dos route handlers atuais `apps/web/app/api/emails/*`). Migra
> `send-order-email`/`send-approval-email`/`send-rejection-email`/`send-cash-close-email` para `loadTemplate(key) ??
> default`. Sub-secção admin "Emails" (em Marketing): lista **todos** os templates, editar assunto/corpo com variáveis
> clicáveis, **preview**, **enviar teste** ao `owner_email`, **repor padrão** (apaga a linha → volta ao default).
> Testes: render nunca usa dados do client; apagar template → cai no default; preview não envia.

**DoD:**
- [ ] Dono edita assunto/corpo dos emails no admin; "repor padrão" volta ao default embutido
- [ ] Emails transacionais passam a `loadTemplate(key) ?? default`; variáveis renderizadas no servidor
- [ ] Enviar teste ao owner funciona; commit `feat(admin): editable email templates with default fallback`

### F7.4 🟢 (Opcional) Campanhas de email para opt-in

**PROMPT:**
> Lê `CLAUDE.md` (§21.2). Tabela `email_campaigns`. Compor email único + segmento (todos opt-in / aniversariantes do
> mês / top clientes) → `/api/emails/campaign` (authenticated, rate-limit, envio em lote via Resend, regista
> `sent_count` + event_log). **Sempre respeita `marketing_opt_in`.** Testes: nunca envia a quem não deu opt-in; rate-limit.

**DoD:**
- [ ] Campanha envia só a opt-in; segmentos corretos; `sent_count` registado
- [ ] Commit `feat(marketing): opt-in email campaigns`

---

## FASE 8 — Estúdio de Conteúdo / Social (preparar + publicar à mão)

> 🎯 O dono planeia posts (calendário) e gera legenda/imagem por IA dentro do admin, publicando **à mão**.
> Auto-publish via Meta API fica para ADR (§22.4). Ler `CLAUDE.md` §22. Single-tenant; IA por route server-side
> (chave nunca no client). Geração é **best-effort** — falha de IA nunca parte o painel.

### F8.1 🟢 Schema + Estúdio (calendário/rascunhos)

**PROMPT:**
> Lê `CLAUDE.md` (§22.1–22.3). Migration `social_posts` (RLS staff_all) + bucket Storage `social-media`. Tab admin
> "Conteúdo": calendário + lista; criar post (canais como etiquetas, legenda, imagem upload, data prevista); ações
> copiar legenda / descarregar imagem / marcar "Publicado". **Sem** integração externa. Testes: CRUD de posts; anon não lê.

**DoD:**
- [ ] Dono cria/edita/agenda posts e marca publicado; copiar legenda / descarregar imagem
- [ ] `social_posts` só por `authenticated`; commit `feat(admin): content studio (social post planner)`

### F8.2 🟢 Geração por IA (legenda + imagem) server-side

**PROMPT:**
> Lê `CLAUDE.md` (§22.1, §16.2). Config da IA no admin (`settings.ai_*`, segredo B, fallback `.env`). Routes
> `/api/social/generate-caption` (item/promo → legenda PT + hashtags) e `/api/social/generate-image` (prompt → imagem
> no bucket `social-media`). Provider-agnóstico; chave nunca no client. Botões "Gerar com IA" / "Gerar imagem" no
> estúdio. Testes: falha de IA não parte o painel; chave nunca sai em RPC anon.

**DoD:**
- [ ] "Gerar com IA" devolve legenda; "Gerar imagem" guarda no bucket; chave server-side só
- [ ] Falha de IA é best-effort (não bloqueia); commit `feat(admin): AI caption + image generation for posts`

---

## FASE 9 — WhatsApp, Alertas & Relatório Semanal

> 🎯 WhatsApp é o canal real de MZ; email é fraco. Nível 1 = deep links `wa.me` (zero API/custo). Painel vira PWA
> com push + campainha (dono nunca perde pedido). Relatório semanal automático ao dono. Ler `CLAUDE.md` §23.
> **Cloud API/envio automático de WhatsApp = V.6 (ADR), NÃO aqui.**
> _(Numeração da raiz — não confundir com F9/F10 locais do `(public)/ROADMAP.md`, que são do storefront.)_

### F9.1 🟡 WhatsApp deep links no painel e na loja

**PROMPT:**
> Lê `CLAUDE.md` (§23.1). Cria `apps/web/lib/whatsapp.ts`: `waLink(phone, message)` (wa.me, E.164 sem `+`, normaliza
> MZ: 9 dígitos começados em 8 → prefixo 258) + `waMessages` (PT: `orderApproved`, `orderOutForDelivery`,
> `orderReadyPickup`, `birthdayGift`, …). Migration aditiva: `settings.whatsapp_number text null` (campo PÚBLICO
> classe A → adicionar ao SELECT explícito do `get_menu()`). Botões wa.me: painel Pedidos (avisar cliente conforme o
> estado), CRM `/clientes` (falar com cliente), widget aniversários (enviar cupom). Loja: botão "Falar com o
> restaurante" (order-status + menu) quando `whatsapp_number` existir. Campo editável em Definições. Testes Vitest:
> normalização de número (84…→25884…, já-258 intacto, inválido → null); mensagens nunca usam texto vindo do client.

**DoD:**
- [ ] `waLink`/`waMessages` únicos pontos de construção de links (nenhum `wa.me` hardcoded em componente)
- [ ] Botões no painel (Pedidos/CRM/aniversários) e na loja; número configurável em Definições
- [ ] `get_menu()` devolve `whatsapp_number` (coluna explícita); testes de normalização verdes
- [ ] Commit `feat(whatsapp): wa.me deep links across admin + storefront`

### F9.2 🟡 PWA do painel + Web Push + campainha

**PROMPT:**
> Lê `CLAUDE.md` (§23.2). `manifest.webmanifest` (nome/ícones de `brand.ts`) + `apps/web/public/sw.js` mínimo (só
> `push` + `notificationclick` → `/pedidos`; sem cache offline). Migration: `push_subscriptions(id, endpoint unique,
> keys jsonb, user_email, created_at)` RLS staff_all + adicionar `orders` à publication do Realtime. Route
> `/api/push/subscribe` (authenticated). Envio com `web-push` (VAPID no `.env`; atualizar `.env.example`):
> fire-and-forget quando pedido entra em `awaiting_approval`/`paid`, payload SEM PII ("🔔 Novo pedido ENC-0042 —
> 350 MT"); subscrição 410 → apagar. No painel: pedir permissão + subscrever; campainha via Realtime (`bell.mp3` em
> loop até interação; mute em localStorage). Testes: payload sem PII; falha de push não afeta o pedido; 410 remove.

**DoD:**
- [ ] Painel instalável (manifest+SW); push chega com o painel fechado; campainha toca com ele aberto
- [ ] Falha de push nunca bloqueia pedido (teste verde); subscrições mortas limpas
- [ ] Commit `feat(admin): PWA + web push + new-order bell`

### F9.3 🟢 Relatório semanal automático

**PROMPT:**
> Lê `CLAUDE.md` (§23.3, §21). Cron `/api/cron/weekly-report` (CRON_SECRET): semana ISO anterior vs antecedente —
> faturado, pedidos confirmados (§4.5), ticket médio, top 3 produtos, hora de pico, split levantamento/entrega —
> derivado das views de Análise EXISTENTES. Email ao `owner_email` via motor §21 (key nova `weekly_report`, default
> embutido). Card "Resumo da semana" na aba Análise com botão partilhar no WhatsApp (`waLink` de F9.1). Idempotente:
> `event_log` `report.weekly_sent` com chave da semana. Testes: idempotência; números batem com as views num seed.

**DoD:**
- [ ] Segunda de manhã → email com o resumo; card na Análise com partilha WhatsApp
- [ ] Não reenvia na mesma semana (teste verde); métricas = views existentes
- [ ] Commit `feat(analytics): automatic weekly owner report`

---

## FASE 10 — Entregadores & "A caminho"

> 🎯 Fechar o ciclo do delivery: entidade rider, estado `out_for_delivery`, página móvel do entregador sem login
> (token por pedido, link enviado por WhatsApp F9.1), tracker do cliente com nome/telefone do entregador.
> Ler `CLAUDE.md` §24. Método Akita: testes da máquina de estados ANTES de mexer nela.

### F10.1 🟡 Riders + estado `out_for_delivery` + atribuição

**PROMPT:**
> Lê `CLAUDE.md` (§24.1, §5). PRIMEIRO: testes Vitest da máquina (`packages/core/src/order-machine.ts`) para
> `DISPATCH` (`ready → out_for_delivery`, só delivery) e `DELIVER` (`ready → delivered` pickup **e**
> `out_for_delivery → delivered`); depois implementa. Migration: `riders` (RLS staff_all); `orders.rider_id` +
> `orders.rider_token uuid unique default gen_random_uuid()`; atualizar `advance_order`; **adicionar
> `out_for_delivery` ao conjunto "venda confirmada"** em TODAS as RPCs/views que o enumeram (`get_order_stats`,
> `get_dashboard_metrics`, `get_cash_dashboard`, `identify_customer`, funil). Painel: CRUD leve de riders
> (Definições → Entregadores); pedido delivery `ready` → "Atribuir entregador" (grava rider_id + DISPATCH) + botão
> wa.me com o link `/entrega/<token>`. Testes: DISPATCH rejeitado em pickup; stats contam out_for_delivery.

**DoD:**
- [ ] Máquina com `out_for_delivery` (testes antes, verdes); pickup nunca despacha
- [ ] Atribuição no painel + wa.me ao rider; venda confirmada inclui `out_for_delivery` em stats/caixa/análise
- [ ] Commit `feat(delivery): riders + out_for_delivery dispatch`

### F10.2 🟡 Página do entregador + tracker do cliente

**PROMPT:**
> Lê `CLAUDE.md` (§24.1, §24.2). RPCs SECURITY DEFINER (grant anon): `get_delivery_job(p_token)` — devolve SÓ
> order_number, customer_name, customer_phone, morada+zona, scheduled_for, badge `PAGO`/`COBRAR X MT` (cash), status;
> token errado → vazio. `rider_mark_delivered(p_token)` — única transição `out_for_delivery → delivered` (via
> `advance_order DELIVER`, event_log actor rider). Página `(public)/entrega/[token]` mobile-first: dados do job,
> botão ligar ao cliente, mapa (link Google Maps da morada), botão grande "Entreguei ✔"; depois de delivered mostra
> só "Entregue ✔" (sem PII). `get_order_status` devolve `rider {name, phone}` APENAS em `out_for_delivery`; tracker
> da loja mapeia para "A caminho" com o nome. Testes: token inválido vazio; pós-delivered sem PII; rider não
> cancela/retrocede.

**DoD:**
- [ ] Rider abre o link, vê o job, marca entregue; nunca vê outros pedidos nem retrocede estados
- [ ] Pós-entrega a página não expõe PII; cliente vê nome/telefone do rider só em "A caminho"
- [ ] Commit `feat(delivery): rider job page by token + customer tracker`

---

## FASE 11 — Carteira/Cashback + Funil Google Reviews

> 🎯 Retenção: % da venda confirmada volta como saldo em MT preso ao telefone (ledger append-only, centavos, só
> servidor — §14.5); feedback 5★ vira convite a avaliar no Google. Ler `CLAUDE.md` §25.

### F11.1 🟡 Ledger da carteira + crédito/resgate no servidor

**PROMPT:**
> Lê `CLAUDE.md` (§25.1, §14.5). Migration: `wallet_ledger` (append-only, RLS staff_all leitura, sem UPDATE/DELETE;
> índices únicos parciais `(order_id) where reason='cashback'` e `where reason='redeem'`);
> `settings.cashback_enabled/cashback_pct (0–50)`; `orders.wallet_used_cents default 0`. Crédito na confirmação
> (`advance_order APPROVE` / `confirm_payment`, MESMA transação): `delta=(base*pct)/100` inteiro, `base = subtotal -
> discount - wallet_used` (sem taxa de entrega). Resgate: `create_order` aceita `use_wallet bool` → `wallet_used =
> min(saldo, subtotal - discount)`, ledger `redeem` negativo; total = `subtotal - discount - wallet_used +
> delivery_fee`; `CANCEL` com wallet → `redeem_refund` compensatório. `identify_customer` devolve `wallet_cents`.
> `// DECISÃO:` risco soft-login aceite (§25.1). Testes: idempotência (2× confirmação = 1 crédito); redeem > saldo
> capado; cancel devolve; client não força saldo; total nunca negativo.

**DoD:**
- [ ] Cashback creditado 1× por pedido confirmado; resgate capado ao saldo; cancel compensa
- [ ] Saldo/preview via `identify_customer`; toda a aritmética no servidor em centavos
- [ ] Commit `feat(wallet): cashback ledger + server-side redeem`

### F11.2 🟢 UI da carteira + config + funil Google Reviews

**PROMPT:**
> Lê `CLAUDE.md` (§25.1, §25.2). Checkout: "Tens X MT de saldo" + toggle "Usar saldo" (preview; verdade no
> `create_order`); Perfil da loja mostra saldo. Definições: `cashback_enabled` + `cashback_pct` (aviso recomendando
> 2–10%) + `google_review_url`. CRM: coluna saldo + ajuste manual (`adjust` com motivo → event_log). Migration:
> `settings.google_review_url` (público classe A → `get_menu()`). Feedback pós-entrega: rating = 5 → CTA "Avalia-nos
> no Google ⭐"; < 5 → obrigado normal. Testes: CTA só com 5★ e URL configurado; ajuste manual sempre logado.

**DoD:**
- [ ] Toggle de saldo no checkout (preview honesto); config no admin; ajuste manual logado
- [ ] 5★ + URL → CTA Google; 4★ ou menos → nada (feedback fica interno)
- [ ] Commit `feat(loyalty): wallet UI + cashback config + Google review funnel`

---

## FASE 12 — Aparência da Loja no admin (tema + formatos 1–5 + conteúdo)

> 🎯 O dono muda cores, formato do layout (1–5) e textos/banners da loja **sem deploy**, na tab `/layout-loja`.
> `brand.ts` = default de fábrica; `settings.storefront_*` = override (precedência §6.2/§21). **UM frontend, N
> formatos — nunca forks.** Ler `CLAUDE.md` §26 + `(public)/CLAUDE.md` §10.
> ⚠️ **Absorve a F10 do `(public)/ROADMAP.md`** (especificada, nunca implementada): a F12.2 implementa os
> formatos 1–2 + hero/banners da F10 e acrescenta 3–5. Ao concluir, marcar a F10 do (public) como absorvida.

### F12.1 🟡 Tema de cores runtime (merge + admin)

**PROMPT:**
> Lê `CLAUDE.md` (§26.1, §26.2, §26.5) e `(public)/CLAUDE.md` (§3, §4). Migration aditiva:
> `settings.storefront_theme jsonb default '{}'` + adicionar ao SELECT explícito do `get_menu()`. Schema Zod
> partilhado (`apps/web/lib/storefront-theme.ts`): só chaves `{primary, primary2, bg, card, star}`, valores hex
> `#rrggbb`; inválido → **ignorado** (nunca chega ao CSS). Merge num único sítio, `(public)/layout.tsx`:
> `{ ...brand.storefront, ...validado(theme) }` → CSS vars `--st-*` (gradiente derivado de primary+primary2);
> componentes não mudam. Admin `/layout-loja` (criar a tab se não existir): color pickers + amostra ao vivo
> (botão/card/pill com os valores escolhidos), aviso de contraste AA sobre `primary`, "Repor padrão" (grava `{}`).
> Testes Vitest: hex inválido/chave desconhecida ignorados; `{}` → tokens = brand.ts; `get_menu` devolve o tema;
> string maliciosa (`;background:url(...)`) nunca sobrevive à validação.

**DoD:**
- [ ] Dono muda `primary` no admin → loja muda sem deploy; "Repor padrão" volta ao brand.ts
- [ ] Valor inválido NUNCA renderiza (testes de CSS injection verdes); merge só no `layout.tsx`
- [ ] Commit `feat(loja): runtime color theme with brand.ts fallback`

### F12.2 🟡 Formatos 1–5 + hero/banners (absorve F10)

**PROMPT:**
> Lê `CLAUDE.md` (§26.3, §26.5) e `(public)/CLAUDE.md` (§10 — formatos 1–2 já desenhados lá). Migration: criar (se
> em falta) `settings.storefront_layout` com check `between 1 and 5`, `hero_image_url`, `banner_images`; bucket
> **público** `storefront-assets` + `POST /api/upload-storefront-asset` (authenticated); tudo no `get_menu()`
> (colunas explícitas). `menu/page.tsx`: renderizar por formato — 1 Hero clássico (atual), 2 Hero+mini banners
> (scroll-snap, sem autoplay), 3 Grid mercado (denso), 4 Lista compacta (menus longos), 5 Editorial (1 coluna, foto
> grande) — **composição dos componentes existentes, zero fork**; `banner_images` vazio não quebra; formato fora de
> 1–5 → renderiza 1. Admin `/layout-loja`: cards de preview (thumbnails estáticos em `public/`), selecionar formato,
> gerir hero + banners (até 5, sort). Marcar F10 do `(public)/ROADMAP.md` como absorvida. Testes: `get_menu` devolve
> os campos; formato inválido → 1; upload só authenticated.

**DoD:**
- [ ] Trocar formato no admin muda a loja ao vivo; 5 formatos funcionais com os mesmos componentes
- [ ] Hero/banners geridos no admin (bucket público); F10 do (public) marcada absorvida
- [ ] Commit `feat(loja): 5 storefront layouts + hero/banners manager (absorbs F10)`

### F12.3 🟢 Conteúdo editável (textos + redes)

**PROMPT:**
> Lê `CLAUDE.md` (§26.4, §26.5). Migration: `settings.storefront_content jsonb default '{}'` + `get_menu()`. Zod:
> strings texto puro com tamanho máx (`tagline`, `hero_title`, `hero_subtitle`, `footer_text`, `closed_message`) +
> `social {instagram, facebook, tiktok}` (URLs https validadas). Loja lê com **fallback por campo** ao `brand.ts`;
> render SEMPRE como texto (nunca `dangerouslySetInnerHTML`); redes no rodapé/perfil só se setadas. Admin
> `/layout-loja`: editor com preview e "repor" por campo. Testes: HTML injetado renderiza escapado; URL não-https
> rejeitada; campo vazio → fallback brand.ts.

**DoD:**
- [ ] Dono edita tagline/hero/rodapé/redes/mensagem de fecho sem deploy; vazio cai no brand.ts
- [ ] XSS impossível (teste de HTML escapado verde); URLs de redes validadas
- [ ] Commit `feat(loja): editable storefront content via settings`

---

## Visão futura (NÃO implementar sem ADR — fora do single-tenant atual)

### V.1 🟢 "Modo iFood" — app do dono recebe pedido + chat em tempo real
Ideia do dono: cada restaurante recebe pedidos num app dedicado e conversa com o cliente. **Atenção:** isto colide com
"single-tenant = um deploy" se virar marketplace multi-restaurante. Caminhos possíveis (decidir em ADR antes):
(a) **PWA do dono** sobre o painel atual (push de novo pedido + chat por pedido via Realtime) — fica single-tenant, viável; ou
(b) **agregador multi-restaurante** — exigiria `tenant_id` e quebra a regra fundadora → produto SEPARADO, não este template.
MVP recomendado se avançar: (a) — `chat_messages(order_id, sender, body, created_at)` + push web. Registar como ADR em `/docs/decisions`.

### V.2 🟢 KDS — ecrã de cozinha (o restaurante em si)
O `role=kitchen` já existe no auth (hoje só redireciona) e as `stations` (kitchen/bar/cold_kitchen) já existem nas
categorias/print_jobs. Falta o ecrã: rota `/cozinha` full-screen para tablet, cards grandes por estação
(pedido+itens+notas), toque para "pronto", Realtime, som. Transforma o produto de "site de encomendas" em
"sistema do restaurante" — reforça a mensalidade. Baixo risco de arquitetura (tudo já existe); avançar quando um
cliente tiver cozinha com tablet. ADR só para decidir escopo (1 ecrã vs 1 por estação).

### V.3 🟢 Assinatura de refeições (marmita da semana) — a aposta inovadora
Cliente/escritório pré-paga N almoços da semana via M-Pesa → o sistema gera os pedidos agendados automaticamente.
Receita previsível para o restaurante; nenhum player faz isto bem (nem fora de MZ). Exige: produto "plano"
(`meal_plans`), pré-pagamento de valor agregado (Paysuite), geração automática de `orders` agendados (cron), gestão
de pausas/faltas. É a feature mais complexa do menu — ADR obrigatório (modelo de cobrança, cancelamento, no-show).

### V.4 🟢 Social auto-publish via API agregadora (evolução da FASE 8)
O Estúdio (F8) prepara; isto publica. Duas vias sérias (decidir por ADR com nº real de clientes pagantes):
(a) **Ayrshare** — apps Meta já aprovadas, zero fricção; plano multi-cliente/white-label ≈ $499/mês → só compensa
com ~10+ clientes na mensalidade social; (b) **Postiz** (open-source, self-hosted) — custo marginal ≈ 0, 30+ redes,
mas a Niraslab tem de criar/rever a própria app Meta (investimento único; depois a margem fica toda cá).
Gatilho para o ADR: 3–5 clientes a pagar a mensalidade com o Estúdio manual.

### V.5 🟢 Console Niraslab HQ (multi-instância — produto SEPARADO)
Mini-dashboard fora deste repo que lê um endpoint de saúde de cada instância (heartbeats/stats já existem):
pedidos/dia, uptime, impressora online, versão das migrations, alertas. É o que permite gerir 10+ restaurantes sem
abrir 10 painéis. NÃO entra neste template (seria a porta para o multi-tenant que a regra fundadora proíbe) —
repo próprio da Niraslab que consome um `/api/health` público-com-segredo a criar aqui via fase pequena quando houver 3+ instâncias.

### V.6 🟢 WhatsApp Cloud API (nível 2 — envio automático)
Evolução da F9.1: mensagens automáticas (pedido novo ao dono, confirmação/estado ao cliente) via WhatsApp Business
Cloud API oficial da Meta. Custo por conversa + número de negócio + setup Meta POR restaurante → colide com o
turnkey; templates de mensagem exigem aprovação da Meta. ADR quando os deep links (F9.1) deixarem de chegar —
respeitar `marketing_opt_in` (§20) para qualquer mensagem não-transacional.

---

## Disciplina de sessão (colar no início de cada sessão do Claude Code)

```
Estamos na fase <X.Y> do ROADMAP.md. Lê o CLAUDE.md e a fase no ROADMAP.
É single-tenant: zero tenant_id, zero planos. Reaproveita do QR MESAS o que der.
Lista os ficheiros que vais criar/alterar e o plano de testes ANTES de codar.
Não toques em nada fora do escopo da fase. No fim, corre pnpm lint && pnpm test
e mostra-me o resultado + checklist de DoD.
```

---

# FASES BABALAZA (B0–B9) — instância Salvação

> **Lê a §27 do `CLAUDE.md` antes de qualquer fase B.** Estas fases assentam em cima do motor (fases 0–3 já
> construídas). Caminho crítico para o go-live vendido na proposta: **B0 → B1 → B2 → B3 → B4 → B5 → B6**.
> B7–B9 reforçam a operação/mensalidade. Disciplina, DoD e "single-tenant" continuam a valer.
> Estado: `🔴` caminho crítico · `🟡` importante · `🟢` reforço/opcional · `[ ]` por fazer.

## FASE B0 — Instanciar o motor para a Babalaza

🎯 Checkpoint: **o motor a correr como "Babalaza", com o cardápio real carregado**, em staging. Ainda só delivery/levantamento (o resto vem nas fases seguintes), mas já com a cara e o menu da casa.

### B0.1 🔴 Marca + ambiente + deploy staging

> **Estado (2026-07-24):** feito localmente; falta o que só a cloud/Vercel dão.
> - [x] `config/brand.ts` editado para Babalaza (nome, tagline, tema dourado/escuro, `storefront.*`). Assets em `public/assets/babalaza/` são **placeholder** — fotos reais pendentes da Ana (ver `CLAUDE.md §27.7`).
> - [x] `pnpm install && pnpm lint && pnpm test` verdes — **148 testes unitários**.
> - [x] `pnpm dev` verificado a servir `http://localhost:3000` com a marca "Babalaza" (curl confirmou o texto na homepage).
> - [x] **Supabase LOCAL** (`supabase start` + `pnpm db:migrate`) ligado e a aplicar as 29 migrations do motor + as 2 novas descobertas nesta sessão (ver nota "Bugs corrigidos" abaixo). `packages/db` tem `.env` local (gitignored) apontando para `http://127.0.0.1:54531`.
> - [x] **Testes de integração do motor corridos pela 1ª vez de sempre contra BD real** (`packages/db/tests/*.test.ts` — RLS, cash, payments, referral, stock, tracking): **67/67 verdes** (eram só código nunca executado, marcado `⏳` no ROADMAP base).
> - [ ] **Supabase CLOUD da Babalaza** — projeto próprio ainda não criado (precisa de acesso à conta Supabase da Ana/Leapfrog). Sem isto, `.env` de produção não pode ser preenchido.
> - [ ] **Deploy Vercel (staging)** — precisa da conta Vercel ligada (fora do alcance deste agente sem autorização/token).
> - [ ] **Fotos reais da Babalaza** — pendente da Ana (hero + fallback do cardápio), ver `public/assets/babalaza/README.md`.
>
> **Bugs corrigidos no motor (base, não específicos da Babalaza) descobertos ao correr os testes pela 1ª vez:**
> 1. Duas migrations com o mesmo timestamp `20260614000021` (`order_stats_kpis.sql` / `referral.sql`) — colidiam no reset. Renomeada para `20260614000024_referral.sql`.
> 2. `adjust_stock()` gravava `menu_items.updated_at`, coluna que nunca existiu → migration aditiva `20260620000001_menu_items_updated_at.sql`.
> 3. **Regressão real em `create_order`**: a versão original (`20260614000009`) decidia o flow via `coalesce(p_payload->>'flow','manual')`; migrations posteriores (`0020`, `0024`, `product_variants_addons`, `fix_create_order_vrc`) foram recriando a função inteira e substituíram essa lógica por `if settings.payment_provider in (...) then digital` — quebrava o checkout manual (`/api/create-order`, que nunca envia `flow`) sempre que o provider global fosse mock/paysuite. Corrigido em `20260620000002_fix_create_order_flow_source.sql` (volta a ler do payload, como a app real já espera em `api/payments/route.ts`).
> 4. `packages/db/tests/`: `referral.test.ts` usava `upsert(onConflict:'name')` em `menu_items` sem constraint UNIQUE nessa coluna (falhava sempre, erro descartado) e inserts fixos em `referral_codes` sem idempotência entre reruns; `stock.test.ts` tinha um bug de asserção (`r.value === 'ok'` em vez de `r.value.data === 'ok'` — `staff.rpc()` nunca rejeita a promise) e um teste desatualizado que assumia que `create_order` aceitava stock insuficiente (migration `0020` tornou isto fail-fast de propósito); `cash.test.ts` testava o `no_open_session` antigo, já substituído pelo auto-open da migration `20260618000002`. Todos corrigidos para refletir o comportamento real/intencional.

**PROMPT (original, para referência):**
> Lê `CLAUDE.md` (§2, §15, §27.0). Configura esta instância como **Babalaza**: edita `config/brand.ts` (name "Babalaza", tagline, `social`, tema dourado/escuro já default — afinar se preciso), coloca assets/logo em `/public/assets`. Cria o `.env` a partir do `.env.example` com o **Supabase da Babalaza**, `OWNER_EMAIL` (email da Ana/gestão), `APP_BASE_URL`. `PAYMENT_PROVIDER=manual` por agora (Paysuite entra na B6). Corre `pnpm install && pnpm lint && pnpm test && pnpm dev`. Deploy em Vercel (staging). **Não** implementes módulos novos aqui.
**DoD:**
- [x] `pnpm lint && pnpm test` verdes; `pnpm dev` abre com a marca Babalaza (dourado)
- [x] Supabase LOCAL ligado; `pnpm db:migrate` aplica as migrations do motor — **cloud da Babalaza pendente** (precisa da conta)
- [ ] Deploy staging acessível — **pendente** (precisa da conta Vercel)
- [ ] Commit `chore(babalaza): brand + env + staging`

### B0.2 🔴 Seed do cardápio real da Babalaza

> **Estado (2026-07-24): CONCLUÍDA.** Reaproveitado o importador EX.1 do motor (`packages/core/src/menu-import.ts`
> + RPC `import_menu` + CLI `pnpm menu:import`) tal como pedido — **zero lógica de importação nova escrita**.
> `seed/menu-babalaza.json` (extração bruta do Excel, `price_cents`) foi convertido para o **formato canónico**
> `menu.json` (preço decimal) em `seed/babalaza.menu-import.json` via script de conversão (scratchpad, não faz
> parte do repo — só transforma formato, não inventa dados).
>
> - [x] `pnpm menu:import seed/babalaza.menu-import.json` → **28 categorias, 254 itens** importados.
> - [x] Comida → `kitchen` (11 categorias, 104 itens), bebidas → `bar` (19 categorias, 156 itens) — confirmado via REST API.
> - [x] Vinhos sem preço (13 entradas no Excel; 12 linhas distintas na BD — "Casal Catarino Tinto Reserva" está
>   **duplicado no Excel da Ana**, o upsert por nome colapsou-os corretamente) ficam `price_cents=0`,
>   `available=false`, com `description` a dizer **"(preço a confirmar)"**.
> - [x] Idempotente: importado 2× (e 3× ao todo nesta sessão), contagem de itens/categorias estável, sem duplicados.
>
> **Extensão ao importador do motor (aditiva, documentada com `// DECISÃO:`):** `menuImportItemSchema.price` passou
> a aceitar `null`/omitido → `price_cents=0` + `available=false` forçado + marcador na `description`. Não existia
> forma de representar "preço a confirmar" no formato canónico antes disto; agora qualquer cliente futuro com o
> mesmo caso (menu com itens por precificar) beneficia. 3 testes novos em `packages/core/src/__tests__/menu-import.test.ts`.
>
> **2 bugs reais do motor descobertos e corrigidos ao validar a importação:**
> 1. `trigger_set_available_on_stock()` marcava `available=false` para **qualquer** item com `stock_qty=0`, mesmo
>    com `track_stock=false` (onde `stock_qty=0` é só o default, não "esgotado"). Como `import_menu()` faz
>    `UPDATE ... SET stock_qty = ...` no upsert (reafirma o mesmo valor), isso já bastava para disparar o trigger
>    `before update of stock_qty` e apagar a disponibilidade de quase todo o cardápio ao reimportar. Corrigido em
>    `20260620000003_fix_stock_trigger_track_stock.sql` (só aplica a lógica quando `track_stock=true`).
> 2. (Falso alarme investigado e descartado): a `description` "(preço a confirmar)" parecia corrompida
>    (`preÃ§o`) ao inspecionar via terminal/curl — confirmado com os bytes UTF-8 crus (`0xE7` = "ç") que os dados
>    estão **corretos**; era só o terminal Windows a mostrar mal, não um bug de dados.
>
> **Pendente:** confirmar com a Ana os **13 preços de vinho em falta** e os **nomes/preços do resto do cardápio**
> antes do go-live (o Excel pode mudar — a proposta prevê sugestões de combos).

**PROMPT (original, para referência):**
> Lê `CLAUDE.md` (§27.7) e o ficheiro **`seed/menu-babalaza.json`** (28 categorias, 254 itens, `price_cents`, `station` por categoria, doses Simples/Duplo já expandidas). Escreve um importador (reusa a EX.1 "menu.json" do motor se existir) que cria `menu_categories` (com `station` correto: comida=`kitchen`, bebidas=`bar`) e `menu_items` (preço em centavos, `available=true`) a partir do JSON. Vinhos com `price_cents:null` entram `available=false` (preço a confirmar). Idempotente (correr 2× não duplica). **Não inventes preços**; onde faltar, deixa a confirmar.
**DoD:**
- [x] Importador cria as 28 categorias com `station` certo e ~254 itens a partir do JSON
- [x] Comida → `kitchen`, bebidas → `bar` (verificado no admin/cardápio)
- [x] Itens sem preço (vinhos) ficam `available=false`; correr 2× não duplica
- [ ] Commit `feat(babalaza): seed do cardápio real`

## FASE B1 — Site institucional público

### B1.1 🔴 Loja passa para `/delivery` + homepage institucional
**PROMPT:**
> Lê `CLAUDE.md` (§27.3). Move a loja/cardápio atual de `/` para **`/delivery`** (redirects e links internos atualizados). Cria a **homepage institucional** em `/` (Server Component, com `metadata`, Open Graph, `sitemap.xml`, `robots.txt`, JSON-LD `Restaurant` para o Google): hero com foto + **botão GRANDE "ENTRAR NO DELIVERY"** (→ `/delivery`), e secções **Sobre · Galeria · Localização (mapa) · Horário · Contactos**. Reusa `settings.storefront_content`/tema (F12) para textos/cores; nada de marca hardcoded. **CTAs no início e no fim** (Entrar no delivery, Reservar, WhatsApp via `waLink`). Mobile-first.
**DoD:**
- [ ] `/` mostra o institucional; `/delivery` mostra a loja (cardápio→carrinho→checkout intactos)
- [ ] Botão "ENTRAR NO DELIVERY" em destaque; navegação não obriga a entrar no delivery
- [ ] `sitemap.xml` + metadata/OG + JSON-LD presentes (encontrável no Google)
- [ ] Commit `feat(babalaza): site institucional + loja em /delivery`

### B1.2 🟡 Reservas + Eventos
**PROMPT:**
> Lê `CLAUDE.md` (§27.3, §27.9). Migration aditiva `reservations` e `events` (RLS 14.1; anon nunca SELECT direto). RPC pública `create_reservation(p_payload jsonb)` (SECURITY DEFINER, **rate-limit no DB**) → grava reserva `pending` + email ao dono + botão wa.me. Secção **Reservas** no institucional (nome, telefone, nº pessoas, data/hora, notas). Secção **Eventos** que lista `events` ativos. No admin, tab/secção simples para gerir reservas (confirmar/cancelar) e eventos (CRUD). Nunca bloqueia a navegação.
**DoD:**
- [ ] Cliente envia reserva → aparece no admin + email ao dono; rate-limit testado
- [ ] Eventos criados no admin aparecem no institucional
- [ ] Commit `feat(babalaza): reservas + eventos`

## FASE B2 — Canais de pedido no schema

### B2.1 🔴 `orders.channel` + `tables` + máquina de estados
**PROMPT:**
> Lê `CLAUDE.md` (§27.2, §27.9) e §5 do motor. Migration aditiva: `orders.channel` (check delivery/pickup/dine_in/bar, default delivery), `orders.table_id`, `orders.pickup_number`; tabela `tables` (RLS 14.1). **Testes Vitest ANTES** em `packages/core`: a state machine aceita pedidos `dine_in` (nasce em `awaiting_approval`, flow manual) e `bar` (nasce em `awaiting_payment`, flow digital, pay-first). Estende `create_order(p_payload)` para aceitar `channel` + `table_id` (valida mesa ativa) e gerar `pickup_number` sequencial-por-dia quando `channel='bar'`. "Venda confirmada" (§4.5) inalterada. Sem quebrar delivery/pickup existentes.
**DoD:**
- [ ] Testes da state machine (dine_in/bar) escritos e verdes
- [ ] `create_order` aceita `channel`/`table_id`, gera `pickup_number` no bar, recalcula tudo no servidor
- [ ] Delivery/pickup continuam a funcionar (regressão verde)
- [ ] Commit `feat(babalaza): canais de pedido (channel/tables) + state machine`

## FASE B3 — QR das mesas (`dine_in`)

### B3.1 🔴 Rota da mesa + pedido + comanda com Nº da mesa
**PROMPT:**
> Lê `CLAUDE.md` (§27.4). RPC `get_table(p_token uuid)` (SECURITY DEFINER, grant anon) que valida a mesa ativa e devolve `{ table_number, menu }`. Rota pública **`/m/[token]`**: abre o cardápio "amarrado" à mesa, carrinho, **ecrã de resumo/confirmação** antes de enviar → `create_order(channel='dine_in', table_id)`. Ao confirmar, cria os `print_jobs` por estação (comida→cozinha restaurante, bebida→bar) com o **Nº da mesa em destaque** no payload. Ecrã de sucesso: "Pedido enviado para a mesa X — a equipa já vai tratar". **O talão não é conta.** Admin (Pedidos) mostra o canal `dine_in` + nº da mesa.
**DoD:**
- [ ] Ler `/m/[token]` válido → pede → comanda sai (simulador) com **Nº MESA** grande, split cozinha/bar
- [ ] Token inválido → cardápio sem poder enviar (ver B3.2)
- [ ] Pedido de mesa aparece no painel com canal + mesa; não é conta
- [ ] Commit `feat(babalaza): QR das mesas (dine_in) + comanda por estação`

### B3.2 🔴 Anti-abuso das mesas
**PROMPT:**
> Lê `CLAUDE.md` (§27.4, "Anti-abuso"). No servidor: (1) enviar pedido `dine_in` **exige `table_id` de uma mesa ativa via token** — sem token válido, não há envio (de `/delivery`/casa vê-se o menu mas não se manda para mesa); (2) **rate-limit por `table_id`** no DB (não disparar vários talões seguidos) + o resumo já confirma antes; (3) fora de `open_hour`–`close_hour` o envio fecha; (4) a equipa pode ignorar/cancelar no painel. Testa cada trava.
**DoD:**
- [ ] Sem token válido → `create_order(dine_in)` recusa
- [ ] Rate-limit por mesa testado; fora de horário bloqueia
- [ ] Commit `feat(babalaza): anti-abuso das mesas`

## FASE B4 — Autoatendimento no bar (`bar`)

### B4.1 🔴 Rota do bar + pay-first + número de levantamento
**PROMPT:**
> Lê `CLAUDE.md` (§27.5) e §6.2 (Paysuite). Rota pública **`/bar`** (QR grande do bar): cardápio de bar, carrinho, **checkout pay-first obrigatório** via Paysuite (fluxo digital) → só após `paid` gera **`pickup_number`** e cria o `print_job` do **bar**. Ecrã pós-pagamento no telemóvel: **número de levantamento + nome + data/hora + confirmação + QR do pedido** (redundância). RPC `get_bar_ticket(p_order_id)` para reabrir esse ecrã. Valor sempre recalculado no servidor.
**DoD:**
- [ ] `/bar`: pedir → pagar (mock/Paysuite) → `paid` → nº de levantamento + QR no telemóvel; comanda no bar
- [ ] Sem pagamento não há comanda (pay-first garantido)
- [ ] `pickup_number` sequencial por dia; ecrã reabre por RPC
- [ ] Commit `feat(babalaza): autoatendimento do bar (pay-first + nº levantamento)`

## FASE B5 — Impressão em 3 estações físicas

### B5.1 🔴 print-bridge multi-impressora por (channel, station)
**PROMPT:**
> Lê `CLAUDE.md` (§27.6) e §9. Estende `services/print-bridge`: `.env` com `PRINTER_IP_COZINHA_DELIVERY`, `PRINTER_IP_COZINHA_REST`, `PRINTER_IP_BAR`. Mapa de roteamento **`(channel, station) → impressora`** (comida delivery/pickup→cozinha delivery; comida dine_in→cozinha restaurante; qualquer `station='bar'` + canal bar→bar). Templates de talão por contexto: cupom delivery, comanda **Nº MESA**, comanda **Nº LEVANTAMENTO**. Testes do roteamento e do render ESC/POS por template. Impressora continua redundância (falha nunca esconde o pedido).
**DoD:**
- [ ] Um pedido de mesa com comida + cerveja gera 2 jobs (cozinha restaurante + bar) para IPs distintos (simulador)
- [ ] Templates certos por canal (Nº MESA / Nº LEVANTAMENTO / cupom delivery)
- [ ] Testes de roteamento e render verdes; retry/`failed` mantidos
- [ ] Commit `feat(babalaza): impressão em 3 estações`

## FASE B6 — M-Pesa Vodacom (Paysuite) em produção

### B6.1 🔴 Ligar o Paysuite da Babalaza
**PROMPT:**
> Lê `CLAUDE.md` (§27.8, §6.2) e corre o skill **`/connect-paysuite`**. Configura as chaves Paysuite da Babalaza em `settings` (admin → Definições) com fallback `.env`; `payment_provider='paysuite'`. Garante os 3 caminhos idempotentes (webhook HMAC, verificação ativa, cron). Testa o fluxo real (bar pay-first + delivery digital) com um valor pequeno. Documenta a categoria da empresa (E.I/colectiva) para os documentos Vodacom (ver `documentos/`).
**DoD:**
- [ ] Pagamento real de teste confirma via webhook **e** via verificação ativa
- [ ] Bar e delivery digitais a confirmar pedidos; valores batem (sem mismatch)
- [ ] Commit `feat(babalaza): M-Pesa Vodacom (Paysuite) em produção`

## FASE B7 — Painel: dados da operação

### B7.1 🟡 Mesas mais activas + gestão por canal
**PROMPT:**
> Lê `CLAUDE.md` (§27.1, §8) e §16.9. Estende a **Análise**: card **"Mesas mais activas"** (pedidos por `table_id`), e o split por **canal** (delivery/pickup/mesa/bar) no faturado/pedidos. Em **Pedidos**, filtro por canal e vista de **comandas** (mesa/bar) para a equipa acompanhar. Deriva das views existentes (sem inventar). Mantém "pratos que mais saem", "horas de pico" e "ticket médio" (já no motor).
**DoD:**
- [ ] Análise mostra mesas mais activas + split por canal; bate com um seed conhecido
- [ ] Pedidos filtra por canal; comandas de mesa/bar visíveis
- [ ] Commit `feat(babalaza): painel de dados (mesas + canais)`

## FASE B8 — Email @babalaza (comunicação em massa)

### B8.1 🟡 CRM + templates + campanhas (FASE 7 do motor) com domínio da Babalaza
**PROMPT:**
> Lê `CLAUDE.md` (§20, §21, §27.8). Ativa a FASE 7: `/clientes` (CRM real), campos opcionais (`email`, `birthday`, `marketing_opt_in`), templates de email editáveis com fallback, e **campanhas** para a lista `marketing_opt_in`. Configura o remetente **`@babalaza.co.mz`** no Resend (domínio verificado). Respeita sempre `marketing_opt_in`; transacional não precisa opt-in.
**DoD:**
- [ ] CRM lista clientes; opt-in captado no checkout/gate
- [ ] Campanha de teste sai só para opt-in, do remetente `@babalaza.co.mz`
- [ ] Commit `feat(babalaza): email @babalaza em massa (CRM + campanhas)`

## FASE B9 — (Opcional) Painel LED numérico no bar

### B9.1 🟢 Integração do LED de levantamento
**PROMPT:**
> Lê `CLAUDE.md` (§27.5, "Painel LED"). Integração **best-effort** com o painel LED do balcão: quando um pedido `bar` fica pronto/pago, disponibiliza o `pickup_number` para o LED (via serviço local, à semelhança do print-bridge, ou entrada manual). **Nunca acopla** — se o LED falhar, o número no telemóvel + a garçonete resolvem. Só avançar quando o hardware estiver definido; ADR para o protocolo do LED.
**DoD:**
- [ ] Número de levantamento chega ao LED (ou entrada manual documentada); falha do LED não afeta o pedido
- [ ] Commit `feat(babalaza): painel LED (opcional)`

---

