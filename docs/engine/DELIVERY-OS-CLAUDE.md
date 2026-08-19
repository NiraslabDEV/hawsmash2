# CLAUDE.md — Delivery OS (template whitelabel single-tenant)

> Sistema de **encomendas online com entrega/levantamento** para restaurantes em Moçambique.
> Cliente abre o site → cardápio → carrinho → escolhe **Levantamento** ou **Entrega** (taxa por zona) →
> agenda **Agora** ou um **horário** do dia → paga (**manual**: vê M-Pesa/e-Mola e envia comprovativo · ou
> **automático** via Paysuite) → o dono vê o pedido no painel interno + email + (opcional) **impressora térmica 24/7**.
>
> **NÃO é multi-tenant.** Um restaurante = um deploy. Para cada cliente novo: clonar o repo, editar
> `config/brand.ts` + `.env`, configurar menu/zonas no admin, fazer deploy. Isto é o **template de revenda**.
> Desenvolvido por **Niraslab** (niraslab.dev@gmail.com).

> 🍺 **ESTE DEPLOY É A INSTÂNCIA BABALAZA (Salvação).** Além de tudo o que está aqui, esta instância tem
> **6 módulos a mais** (site institucional, QR das mesas, autoatendimento no bar, impressão em 3 estações,
> M-Pesa Vodacom em produção, email @babalaza em massa). **Lê a §27 (INSTÂNCIA BABALAZA)** e o
> **`ROADMAP.md`** (fases B0–B9). Onde a §27 e o resto colidirem, a **§27 ganha** — é a instância.

---

## ⚡ COMO TRABALHAR NESTE REPO (regras para o agente de IA)

1. **Uma fase do `ROADMAP.md` por sessão.** Nunca antecipar fases futuras.
2. **Antes de codar:** ler este ficheiro + a fase atual no ROADMAP. Listar os ficheiros que vais criar/alterar
   e o plano de testes. Esperar confirmação se houver dúvida de escopo.
3. **Reaproveitar antes de inventar.** Grande parte do motor já existe no projeto **QR MESAS**
   (`C:\Users\Gabriel\Desktop\QR MESAS`). Copiar/adaptar (ver secção 13 — Reaproveitamento), não reescrever.
4. **Skeleton-first → tests-before-code → implementação** (Método Akita). Nenhuma lógica de domínio sem teste Vitest escrito ANTES.
5. **Single-tenant é uma decisão fechada.** NUNCA adicionar `tenant_id`, `qr_token`, planos comerciais ou
   gating por plano. Se aparecer no código copiado do QR MESAS, **remover**.
6. **Dinheiro sempre em centavos inteiros.** Preços só existem no servidor. O client envia nomes e quantidades; o servidor recalcula tudo.
7. **Copiar os padrões canónicos da secção 14** (RLS, idempotência de webhook, dinheiro, estoque atómico) em vez de inventar variações.
8. **Definition of Done de toda fase:** `pnpm lint && pnpm test` verdes + checklist da fase no ROADMAP marcado + commit convencional (`feat(scope): ...`).
9. Em caso de ambiguidade: escolher a opção mais simples que respeite a secção 12 ("O que NUNCA fazer") e documentar com `// DECISÃO:`.

---

## 1. Visão do produto

- **O que é:** um site de encomendas pronto a vender. O Niraslab vende delivery a restaurantes; cada um recebe
  uma cópia deste sistema, conectada à sua marca, números de pagamento e cardápio.
- **Mercado:** Maputo → Moçambique. UI 100% em **português**. Moeda **MZN (MT)**.
- **Diferencial:** integração nativa M-Pesa/e-Mola (manual + Paysuite), operação confiável com internet instável,
  impressora térmica opcional, e um painel interno bonito (Pedidos / Caixa / Análise / Feedback / Lista de Espera).
- **Whitelabel:** identidade visual e segredos vêm de `config/brand.ts` + `.env`. Dados de negócio
  (menu, zonas, horários, números de pagamento) vêm do admin/BD. Trocar de cliente NÃO exige tocar na lógica.

### 1.1 Não há planos. Não há gating.
Este é um produto entregue por instância. Toda a feature está sempre ligada. (Contraste com o QR MESAS, que é SaaS com planos — aqui isso não existe.)

---

## 2. Stack (decisões fechadas — não mudar sem ADR em `/docs/decisions`)

| Camada | Tecnologia | Motivo |
|---|---|---|
| Frontend | Next.js 14+ (App Router) + TypeScript | Loja do cliente + painel admin no mesmo código; route handlers para webhooks/emails |
| UI | Tailwind CSS + shadcn/ui | Velocidade; tema whitelabel via CSS vars |
| Visual | Tema escuro + dourado **portado do HawSmash** (`C:\Users\Gabriel\Desktop\HawSmash\admin.css`) | Igual às screenshots do dono |
| Estado no client | TanStack Query | Cache, retry, reconexão |
| Backend/DB | Supabase (Postgres + RLS + Realtime + Auth + Storage) | RLS simples (1 restaurante), realtime no painel, storage para comprovativos |
| Validação | Zod em toda boundary | Inputs nunca confiáveis |
| Pagamentos | Manual (comprovativo) + Paysuite (M-Pesa/e-Mola/cartão) | Manual cobre todos; Paysuite automatiza |
| Email | Resend (default) via route handler — swappable por SMTP | Pedido novo → dono; pagamento confirmado/negado → cliente |
| Impressão | Print-bridge local (Node) → ESC/POS TCP 9100 | Portado do QR MESAS; redundância, nunca acopla |
| Hosting | Vercel (web) + Supabase Cloud; print-bridge num mini-PC local | |
| Testes | Vitest (unit/integração) + Playwright (e2e) | |
| Monorepo | pnpm workspaces + Turborepo | Igual ao QR MESAS |

**Regra de ouro:** o cliente final (quem come) usa SEMPRE o browser. Zero instalação.

---

## 3. Estrutura do repositório

```
/apps/web                       # Next.js: loja do cliente + painel admin
  /app/(public)/                # loja: cardápio, carrinho, checkout, status do pedido (anon)
    page.tsx                    #   storefront (cardápio + carrinho)
    checkout/                   #   dados, levantamento/entrega+zona, agendamento, pagamento manual/auto
    order-status/[orderId]/     #   acompanhamento do pedido (polling)
  /app/(admin)/                 # painel interno (auth Supabase)
    pedidos/  caixa/  analise/  feedback/  lista-espera/
  /app/api/webhooks/paysuite/   # webhook de pagamento (HMAC + idempotência)
  /app/api/payments/            # cria checkout Paysuite
  /app/api/emails/              # envio transacional (Resend)
  /app/api/cron/reconcile/      # reconciliação Paysuite (5 min)
/config/brand.ts                # ⭐ identidade whitelabel (nome, cores, logo, locale, redes)
/packages/core                  # PORTADO do QR MESAS: money, order-machine, schemas (sem planos)
/packages/db                    # migrations SQL single-tenant + seed + tipos gerados
/packages/paysuite              # PORTADO do QR MESAS: provider + mock + paysuite real
/services/print-bridge          # PORTADO do QR MESAS: poll print_jobs → ESC/POS TCP (single-tenant)
/docs/decisions                 # ADRs
ROADMAP.md                      # fases de execução com DoD
```

---

## 4. Arquitetura single-tenant

**Princípio:** uma instância = um restaurante = um banco. Sem `tenant_id` em lado nenhum.

### Regras
1. RLS habilitado em TODAS as tabelas. `authenticated` = staff do restaurante (lê/gere tudo). `anon` = NENHUMA policy direta.
2. Todo acesso público (loja do cliente) passa por **RPCs `SECURITY DEFINER`** (`get_menu`, `create_order`, `get_order_status`). O client anon nunca faz SELECT direto.
3. Preços e taxas de entrega são SEMPRE recalculados no servidor a partir da BD. O payload do cliente só traz nomes, quantidades, zona e horário.
4. Rotas públicas: `/` (loja), `/checkout`, `/order-status/{orderId}`. Painel (tabs em `(admin)/layout.tsx`): `/pedidos`, `/caixa`, `/analise`, `/feedback`, `/lista-espera`, `/cardapio` (cardápio + zonas de entrega), `/marketing`, `/definicoes` (settings operacionais), `/layout-loja` (formatos visuais da loja + imagens de hero/banners + tema de cores + conteúdo — F10/F12, §26).
5. **"Venda confirmada" (decisão fechada):** `status in ('approved','paid','in_preparation','ready','delivered')`. É este o conjunto que conta para faturado/ativos (`get_order_stats`), métricas de Análise (`get_dashboard_metrics`) e caixa (`get_cash_dashboard`). No fluxo manual a venda é real assim que o dono APROVA, não só quando entrega. Métricas específicas de entrega (tempo médio, nº entregues) continuam restritas a `delivered`. A caixa conta desde o último fecho (não desde a meia-noite).

### Schema de referência (migrar em fases — ver ROADMAP)

```
settings            (id smallint pk default 1 check (id=1)  -- singleton
                     mpesa_number, mpesa_name, emola_number, emola_name,
                     pickup_address, pickup_maps_url, owner_email,
                     open_hour int, close_hour int, slot_minutes int default 30,
                     accepting_orders bool default true,  -- "pré-launch"/loja fechada
                     payment_provider text check in ('manual','mock','paysuite') default 'manual',
                     -- Layout da Loja (F10) — campos PÚBLICOS (devolvidos por get_menu()):
                     storefront_layout smallint default 1 check (storefront_layout between 1 and 5),  -- F10/F12
                     hero_image_url    text null,          -- hero uploadado; null = usa brand.ts
                     banner_images     jsonb default '[]', -- [{url,title,sort}] até 5 mini banners (Formato 2)
                     -- Aparência runtime (F12, §26) — overrides PÚBLICOS com fallback p/ brand.ts:
                     storefront_theme   jsonb default '{}',  -- cores {primary,primary2,bg,card,star} hex validado
                     storefront_content jsonb default '{}')  -- textos {tagline,hero_title,footer_text,closed_message,social{...}}
menu_categories     (id uuid pk, name, sort int, station text check in ('kitchen','bar','cold_kitchen') default 'kitchen', active bool default true)
menu_items          (id uuid pk, category_id, name, description, price_cents int check (>=0),
                     photo_url, available bool default true,
                     track_stock bool default false, stock_qty int check (>=0), sort int)
delivery_zones      (id uuid pk, name, fee_cents int check (>=0), active bool default true, sort int)
orders              (id uuid pk, order_number text unique,         -- "ENC-0042"
                     status text, flow text check in ('digital','manual'),
                     fulfillment_type text check in ('pickup','delivery'),
                     delivery_zone_id uuid null, address text null,   -- obrigatório se delivery
                     customer_name, customer_phone,
                     scheduled_for timestamptz null,                  -- null = AGORA (ASAP)
                     subtotal_cents int, delivery_fee_cents int, total_cents int,
                     payment_method text check in ('mpesa','emola','credit_card','cash'),
                     payment_proof_path text null,                    -- comprovativo (fluxo manual)
                     notes text, created_at, updated_at)
order_items         (id uuid pk, order_id, menu_item_id, name_snapshot text, qty int check (>0),
                     unit_price_cents int, station text, notes text)
payments            (id uuid pk, order_id, provider, provider_ref, method, amount_cents int,
                     status text check in ('pending','confirmed','failed','refunded'),
                     idempotency_key text unique, raw_webhook jsonb, created_at)
print_jobs          (id uuid pk, order_id, station, payload jsonb,
                     status text check in ('queued','printing','printed','failed'),
                     attempts int default 0, created_at, printed_at)
cash_sessions       (id uuid pk, opened_at/by, closed_at/by, expected_cash_cents, counted_cash_cents,
                     difference_cents, notes, report jsonb)
order_feedback      (id uuid pk, order_id null, rating int, comment text, created_at)
waitlist            (id uuid pk, name, phone, created_at)
event_log           (id bigserial pk, order_id null, type text, payload jsonb, created_at)  -- append-only
device_heartbeats   (id text pk, kind text, last_seen_at)            -- printer/admin online
```

Notas:
- `order_items.name_snapshot` + `unit_price_cents`: snapshot no momento do pedido (cardápio muda, histórico não).
- `event_log` append-only (sem UPDATE/DELETE policies).
- Identidade da marca: `config/brand.ts` é o **default de fábrica** (nome legal, fontes, assets base). Desde a F12 (§26),
  o dono pode **sobrepor em runtime** cores/formato/textos da loja via `settings.storefront_*` — precedência
  `settings` → fallback `brand.ts` (mesmo padrão das chaves Paysuite §6.2 e dos email templates §21). O que é
  build-time (fontes, nome legal, assets/ícones PWA) continua SÓ em `brand.ts`.

---

## 5. Máquina de estados do pedido (fonte única: `packages/core/src/order-machine.ts` — PORTADA do QR MESAS, intacta)

```
Fluxo manual (pagamento M-Pesa/e-Mola por comprovativo, ou dinheiro na entrega):
draft → awaiting_approval → approved → in_preparation → ready → delivered

Fluxo digital (Paysuite):
draft → awaiting_payment → paid → in_preparation → ready → delivered
                        ↘ payment_failed → awaiting_payment (retry)

Qualquer estado não-terminal → cancelled (só staff, com motivo, logado em event_log)
```

- **O pedido só vira "novo" para a cozinha/impressora quando `paid` (digital) ou `approved` (manual).**
- O **comprovativo** do fluxo manual NÃO confirma sozinho: o dono vê o comprovativo no painel e clica **Aprovar** (`APPROVE`) ou **Negar** (`CANCEL` com motivo). É aí que o cliente recebe o email de confirmação/recusa.
- Transições só via RPC `advance_order(p_order_id, p_event, p_reason)` que chama a state machine. Update direto de `status` pelo client = proibido (bloqueado por RLS). `CANCEL` exige `p_reason`.
- Toda transição grava `event_log`.

---

## 6. Pagamentos

### 6.1 Manual (default, cobre 100% dos clientes)
1. Cliente finaliza o pedido escolhendo **M-Pesa** ou **e-Mola**.
2. Pedido nasce `awaiting_approval` (flow `manual`).
3. Ecrã mostra o **número e nome** do `settings` (ex.: M-Pesa 84… / Soeil Nissar) + instrução: *"Transfere e envia o comprovativo"*.
4. Cliente faz **upload do comprovativo** → bucket **privado** `payment-proofs`; caminho guardado em `orders.payment_proof_path`.
5. **Email ao dono** ("Novo pedido #ENC-0042 com comprovativo"). Pedido aparece no painel **Pedidos** com botão "Ver comprovativo" (signed URL).
6. Dono **Aprova** → `approved` → cozinha/impressora + **email ao cliente** ("pagamento confirmado"). Ou **Nega** → `cancelled` + **email ao cliente** ("pagamento não confirmado").

### 6.2 Automático (Paysuite) — `packages/paysuite` PORTADO do QR MESAS · **EM PRODUÇÃO (validado com M-Pesa real)**
- Base da API: `https://paysuite.tech/api/v1`. Cliente clica "Pagar Agora" → servidor cria checkout (`POST /payments`) → redireciona para `checkout_url`.
- **Config das chaves:** vêm de `settings` (admin → Definições → Paysuite: `paysuite_api_key`, `paysuite_webhook_secret`, migration `0019`) **com fallback** para env (`PAYSUITE_API_KEY`/`PAYSUITE_WEBHOOK_SECRET`). Resolvido em `apps/web/lib/payments/config.ts` (`getPaymentConfig`/`buildProvider`). NÃO há encriptação por-tenant.
- **Confirmação do pagamento — 3 caminhos idempotentes** (idempotency key = `orderToReference(orderId)` em todos):
  1. **Webhook** `/api/webhooks/paysuite` (HMAC-SHA256 do raw body) — fonte de verdade, instantâneo.
  2. **Verificação ATIVA** `/api/payments/verify` — chamada pela página `/payment/return`; pergunta o estado direto ao Paysuite (`getPaymentStatus`) e confirma. **Não depende do webhook** (evita o pedido ficar preso em "A processar" quando o webhook não chega / cron não corre).
  3. **Cron** `/api/cron/reconcile` (5 min) — rede de segurança (não corre sozinho no Railway).
- **GOTCHAS REAIS (corrigidos):** `reference` tem de ser **alfanumérico** (`apps/web/lib/payments/reference.ts`, `ord`+hex32) — `order_<uuid>` dá HTTP 422; `return_url`/`callback_url` precisam de **esquema** (`resolvePublicBase` na rota de payments); transação paga = `transaction.status='completed'` (mapeado em `API_STATUS_MAP`).
- Runbook completo para ligar a um cliente novo: skill **`/connect-paysuite`** (`.claude/skills/`).

### 6.3 Conversão centavos ↔ decimal (`packages/core/src/money.ts`, PORTADO)
Interno: `Cents` inteiro. Boundary Paysuite: `centsToDecimalString` / `decimalStringToCents`. Nunca float para dinheiro.

### 6.4 `confirm_payment` (RPC transacional)
Valor do webhook ≠ `orders.total_cents` → NÃO confirma; loga `payment.amount_mismatch`; fica `pending` para reconciliação; 200. Pedido fora de `awaiting_payment`/`payment_failed` → confirma o pagamento mas não transiciona; loga `payment.confirmed_on_invalid_state`; 200.

---

## 7. Entrega, levantamento e agendamento

- **Levantamento (pickup):** sem morada; mostra `pickup_address` + link de mapa do `settings`. Taxa = 0.
- **Entrega (delivery):** cliente escolhe uma **zona** (`delivery_zones`) → `delivery_fee_cents` somado ao total no servidor; **morada obrigatória**. (Por zonas — decisão fechada.)
- **Agendamento:**
  - **Agora (ASAP):** `scheduled_for = null` → pode preparar/imprimir já.
  - **Horário:** slots de `slot_minutes` (default 30) **do próprio dia**, dentro de `open_hour`–`close_hour`, sempre no futuro. O servidor valida o slot (não confiar no client).
- O **painel Pedidos** tem vista **Lista** e **Calendário** (como nas screenshots): agrupa por dia, mostra "começar preparo às HH:MM", totais por produto do dia.

---

## 8. Painel interno (reskin **estilo iFood** — vermelho `#EA1D2C`, ver screenshots do dono)

> **Estado:** o painel admin foi reestilizado ao estilo iFood (2026-06-16). `apps/web/app/(admin)/layout.tsx` =
> sidebar vertical + topbar + drawer mobile (tema vermelho). `pedidos/page.tsx` = 6 KPIs (`get_order_stats`
> estendido na migration `0021`: faturado/pedidos hoje, em preparo, prontos, cancelados, avaliação média),
> abas de status, tabela (desktop) + cards (mobile). Falta estender o reskin às outras tabs.
> Dinheiro no painel: usar `formatMT` (centavos → `MT`), **nunca** `Intl ... currency MZN` (dá `MTn`).

Tabs: **Pedidos · Caixa · Análise · Feedback · Lista de Espera**. Auth Supabase (single-tenant → `authenticated` = staff).

- **Pedidos:** cards de stat no topo (Total Faturado, Ativos, Aguarda Pagamento, Em Preparo, Prontos), busca, vista Lista/Calendário, filtros (Ativos/Aguarda pagamento/Pagos/Em preparo/Prontos/Concluídos/Cancelados/Todos). Aprovar/Negar, ver comprovativo, avançar estado.
- **ADD PRODUTOS (dentro de Pedidos ou aba própria de gestão):** CRUD de categorias e itens — nome, descrição, **preço (MT → centavos)**, foto (Storage), `available`, e os campos de **estoque** (`track_stock`, `stock_qty`) já prontos para ligar. Reaproveitar padrão de `apps/web/app/(staff)/admin/menu-section.tsx` do QR MESAS.
- **Caixa:** fecho de caixa por dia (total pedidos, faturado, entregues, por fechar, vendido por unidade), notas, **PDF** e **email** do fecho. Reaproveitar `cash_sessions` (F2.9 do QR MESAS).
- **Análise:** faturação (dia/semana/mês), ticket médio, produtos mais vendidos, **Como recebem** (Levantamento vs Entrega), horários de pico (heatmap), clientes que mais compraram. Reaproveitar `dashboard-section.tsx` + views (`0010_dashboard_views.sql`) do QR MESAS, adaptadas single-tenant.
- **Feedback / Lista de Espera:** `order_feedback` e `waitlist` (INSERT anon com rate-limit ao nível do DB).

---

## 9. Impressora térmica (opcional, 24/7) — `services/print-bridge` PORTADO do QR MESAS

- Node leve a correr num mini-PC/PC local do restaurante, ligado 24/7. `.env`: `SUPABASE_URL`, service key restrita, `PRINTER_IP`.
- Poll de `print_jobs.queued` (3s) → render ESC/POS → TCP `ip:9100` → marca `printed`. Retry 3× com backoff → `failed` + `event_log`.
- 1 `print_job` é criado quando o pedido fica `paid`/`approved` (na mesma transação de `confirm_payment`/`advance_order APPROVE`).
- Cupom: nº pedido, **nome do cliente em destaque**, itens+qty+notas, **Levantamento/Entrega + zona + morada**, **horário (Agora ou HH:MM)**, "PAGO VIA M-PESA"/"AGUARDA PAGAMENTO NA ENTREGA", hora.
- `printer-sim` (simulador TCP) para `pnpm bridge:dev` sem hardware. **A impressora é redundância; o painel é o canal primário.** Falha de impressão NUNCA esconde o pedido.

---

## 10. Comandos

```bash
pnpm dev            # web em localhost:3000
pnpm test           # vitest run (CI/DoD)
pnpm test:watch     # vitest watch
pnpm test:e2e       # playwright
pnpm lint           # eslint + tsc --noEmit por package
pnpm db:migrate     # supabase db reset (aplica migrations + seed)
pnpm db:types       # regenera tipos do schema
pnpm bridge:dev     # print-bridge com impressora simulada
```

---

## 11. Variáveis de ambiente (`.env.example`)

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=        # só servidor
PAYMENT_PROVIDER=manual|mock|paysuite
PAYSUITE_API_KEY=                 # só se paysuite
PAYSUITE_WEBHOOK_SECRET=          # só se paysuite
RESEND_API_KEY=                   # email transacional (ou SMTP_* se preferires)
OWNER_EMAIL=                      # para onde vão os avisos de novo pedido
APP_BASE_URL=
# print-bridge (no mini-PC local):
PRINTER_IP=
```

---

## 12. O que NUNCA fazer

- ❌ Float para dinheiro. Sempre centavos inteiros.
- ❌ Adicionar `tenant_id`, `qr_token` ou planos comerciais. Isto é single-tenant.
- ❌ `anon` com SELECT direto em tabela (sempre RPC `SECURITY DEFINER`).
- ❌ Confiar no client para preços, taxa de entrega, estado de pagamento ou validade de horário.
- ❌ Mostrar pedido na cozinha/impressora antes de `paid`/`approved`.
- ❌ Webhook sem assinatura verificada e sem idempotência.
- ❌ URL pública do bucket `payment-proofs` (é privado, dá 400) — usar `createSignedUrl`.
- ❌ Acoplar o sistema à impressora (papel = redundância).
- ❌ Editar a identidade da marca espalhada pelo código — só em `config/brand.ts`.
- ❌ Pular fase do ROADMAP ou alterar contrato de fase concluída sem ADR.
- ❌ Confiar no client para desconto, cupom, brinde ou meta de gamificação — sempre recalcular no `create_order`.
- ❌ ID de pixel/GA/Ads hardcoded; carregar tags de marketing sem consentimento (`dl_consent`).
- ❌ Disparar `purchase` antes de `paid`/`approved`.
- ❌ Devolver PII (morada, comprovativo, pagamento) de um telefone na personalização soft (sem OTP).
- ❌ Permitir item `is_gift` no pedido sem cupom válido, ou mais de 1 unidade de brinde.

---

## 13. Reaproveitamento do QR MESAS (copiar, depois simplificar)

Fonte: `C:\Users\Gabriel\Desktop\QR MESAS`. Visual: `C:\Users\Gabriel\Desktop\HawSmash\admin.css`.

| Trazer para cá | De | O que mudar |
|---|---|---|
| `money.ts` | `packages/core/src/money.ts` | Nada (usar tal e qual) |
| `order-machine.ts` | `packages/core/src/order-machine.ts` | Nada — já tem flows `digital` + `manual` |
| `schemas.ts` (Zod) | `packages/core/src/schemas.ts` | Adaptar payloads (entrega/zona/agendamento; sem qr_token) |
| `plans.ts` | `packages/core/src/plans.ts` | **NÃO trazer** (não há planos) |
| Paysuite (provider/mock/real/errors) | `packages/paysuite/src/*` | Nada na lógica; chaves via env (sem por-tenant) |
| print-bridge | `services/print-bridge/src/*` | Remover `TENANT_ID`; cupom de delivery (nome/zona/morada/horário) |
| Admin sections | `apps/web/app/(staff)/admin/*-section.tsx` | Reskin HawSmash; remover gating por plano; rotas pickup/delivery |
| Cash session | migration `0011`/cash + `cash-section` | Single-tenant; PDF + email do fecho |
| Dashboard views | `packages/db/migrations/0010_dashboard_views.sql` | Tirar `tenant_id`; adicionar split pickup/delivery |

**Tema visual (HawSmash):** CSS vars `--gold (#e5a93c)`, `--ink`, `--ink-mute`, `--line-strong`, fundo escuro `#0a0807→#110d0a`, `--font-display`/`--font-body`. Mapear para tokens do Tailwind em `config/brand.ts` para serem por-cliente.

---

## 14. PADRÕES CANÓNICOS (copiar, não reinventar)

### 14.1 RLS single-tenant
```sql
alter table menu_items enable row level security;
-- staff (qualquer authenticated, pois 1 restaurante) gere tudo:
create policy "staff_all" on menu_items for all to authenticated using (true) with check (true);
-- anon: NENHUMA policy. Acesso público só via RPC 14.2.
```

### 14.2 Acesso público via RPC SECURITY DEFINER (sem qr_token)
```sql
create or replace function public.get_menu()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  return jsonb_build_object(
    'accepting_orders', (select accepting_orders from settings where id = 1),
    'categories', (select coalesce(jsonb_agg(... order by c.sort), '[]'::jsonb)
                   from menu_categories c where c.active /* + itens available */),
    'zones', (select coalesce(jsonb_agg(...), '[]') from delivery_zones where active));
end; $$;
grant execute on function public.get_menu() to anon;
```
Mesmo padrão para `create_order(p_payload jsonb)` e `get_order_status(p_order_id uuid)`.

### 14.3 Idempotência de webhook (igual ao QR MESAS)
```ts
const raw = await req.text();
if (!verifySignature(raw, headers, env.PAYSUITE_WEBHOOK_SECRET)) return new Response('invalid', { status: 401 });
const evt = paysuiteWebhookSchema.parse(JSON.parse(raw));
// INSERT ... ON CONFLICT (idempotency_key) DO NOTHING → 0 rows = duplicado → 200
const inserted = await confirmPayment(evt);
if (!inserted) return Response.json({ ok: true, duplicate: true });
await Promise.all([createPrintJob(evt.orderId), logEvent('payment.confirmed', evt)]);
return Response.json({ ok: true });
```

### 14.4 Estoque atómico (quando `track_stock`)
```sql
-- na MESMA transação que confirma/aprova o pedido:
update menu_items set stock_qty = stock_qty - v_qty
where id = v_item_id and track_stock and stock_qty >= v_qty;
-- row_count = 0 → raise 'out_of_stock:<id>' → rollback do pedido inteiro
```

### 14.5 Dinheiro
`packages/core/src/money.ts` é o único lugar que formata/calcula dinheiro (`Cents`, `formatMT`, `orderTotal`, `centsToDecimalString`, `decimalStringToCents`).

---

## 15. Onboarding de um cliente novo (o "turnkey")

1. Clonar o repo para uma pasta/serviço novo.
2. Editar `config/brand.ts` (nome, cores, logo, redes) e colocar assets em `/public/assets`.
3. Preencher `.env` (Supabase do cliente, provider de pagamento, Resend, OWNER_EMAIL).
4. `pnpm db:migrate` no Supabase do cliente; `pnpm db:seed` (categorias/itens/zonas exemplo).
5. No admin: ajustar `settings` (números M-Pesa/e-Mola, horários, morada), cardápio e zonas.
6. Deploy (Vercel). Opcional: instalar o `print-bridge` no mini-PC do restaurante.
7. **"Conectar o front" = passos 2–3.** A partir daí o sistema sabe receber pedidos.

---

## 16. Marketing & Tracking (FASE 4) — spec COMPLETA

> Objetivo: medir o funil inteiro (entrada → cardápio → carrinho → checkout → compra) em **GTM + GA4 + Meta Pixel +
> Google Ads**, com eventos first-party próprios (fonte de verdade), e proteger a atribuição contra iOS/adblock com
> **Meta CAPI** e **Google Enhanced Conversions** server-side. Trazer os KPIs para o painel **Análise**.
> Single-tenant: a config vive em `settings` (singleton id=1), editável no admin — **nunca** `tenants`, **nunca** hardcoded.

### 16.1 A regra crítica (escrita em código antes de tudo)
- **`purchase` NUNCA dispara no submit do checkout.** Dispara **APENAS** em `/order-status` quando `order.status ∈ {paid, approved}`.
- **Idempotência dupla:** guard in-memory (`useRef`) **+** guard persistente (`localStorage['tracked_purchase_<orderId>']`) → não re-dispara em reload.
- `value` em **MT decimal** sempre via `money.ts` (`total_cents / 100` encapsulado), nunca float manual.
- `eventID = 'purchase_<orderId>'` em TODOS os destinos → deduplicação browser↔server (CAPI/Enhanced Conversions).
- `transaction_id = order.id` em GA4 e Ads → dedup nativo deles em reload.

### 16.2 Config por instância (tudo no admin — "cole e está configurado")
> Princípio: o dono configura **tudo** na tab **Marketing**, sem tocar em `.env`. Mas há duas classes de campo,
> com regras de exposição diferentes. **NUNCA** misturar as duas no mesmo SELECT público.

Migration aditiva (`0014_tracking.sql`), colunas em `settings` (singleton — **sem** `tenant_id`):
```sql
-- (A) IDs PÚBLICOS — vão para o client (carregam os scripts). OK no get_menu().
alter table settings add column gtm_container_id      text;  -- 'GTM-XXXXXX'
alter table settings add column meta_pixel_id         text;  -- '123456789'
alter table settings add column ga4_measurement_id    text;  -- 'G-XXXXXXXXXX'
alter table settings add column gads_conversion_id    text;  -- 'AW-123456789'
alter table settings add column gads_conversion_label text;  -- 'AbCdEfGhIjK'
-- (B) SEGREDOS — só servidor. NUNCA no get_menu() nem em qualquer RPC anon.
alter table settings add column meta_capi_token       text;  -- token CAPI (server-side)
alter table settings add column gads_developer_token  text;  -- Google Ads dev token (server-side)
-- (e, conforme a F5/F2, podem entrar aqui no mesmo padrão: resend_api_key, paysuite_api_key, paysuite_webhook_secret)
```
- **`get_menu()` devolve SÓ os campos (A).** Os campos (B) **nunca** entram num RPC com `grant … to anon`. O servidor lê (B) com service role (ex.: em `confirm_payment`/handlers de CAPI), ou via RPC `get_secret_settings()` restrita a `authenticated`.
- **Precedência:** valor em `settings` (B) tem prioridade; se vazio, cai no `.env` (`META_CAPI_TOKEN`, `GOOGLE_ADS_DEVELOPER_TOKEN`) como fallback. Assim funciona tanto "tudo no admin" como "tudo no `.env`".
- **RLS:** os campos (B) ficam na mesma linha `settings`, mas `settings` já é `staff_all` (só `authenticated`). O perigo é o `get_menu()` (SECURITY DEFINER) vazar — por isso o SELECT dele lista colunas explicitamente, nunca `select *`.
- Admin → tab **Marketing** (owner only): inputs para cada ID/token com link de "onde encontrar", campos de token mascarados (mostra `••••1234`, "Substituir" para trocar), **botão "Testar ligação"** (valida CAPI/Ads sem expor o token), e **preview do `dataLayer`**.

### 16.3 Módulo canónico de tracking (`apps/web/lib/analytics/track.ts`)
Único lugar que toca `dataLayer`/`fbq`/`gtag`. Componentes **nunca** chamam direto. Expõe:
- `loadGTM(containerId)` — injeta o GTM no `<head>` uma vez (guard por `id` do script). GTM é o hub: lê o `dataLayer` e reenvia a GA4/Meta/Ads via tags configuradas no painel GTM.
- `trackViewMenu(items)` · `trackViewItem(item)` · `trackAddToCart(item)` · `trackBeginCheckout(cart)` · `trackAddPaymentInfo()` · `trackPurchase(order)` · `trackLead()` · `trackCouponApplied(code)`.
- **Ordem do push no `purchase`** (fixa): (1) `dataLayer.push({ ecommerce: null })` para limpar contexto anterior; (2) push GA4 `ecommerce`; (3) push Google Ads `conversion` (`send_to: '<AW-ID>/<LABEL>'`); (4) `fbq('track','Purchase', …, { eventID })` se `fbq` existir.
- **GA4 `items[]`** preenchido por linha: `{ item_id: menu_item_id, item_name, price, quantity }` (sem isto o relatório de e-commerce não atribui).
- **Meta** sempre com `eventID`, `content_ids`, `content_type: 'product'`, e `contents: [{ id, quantity }]` por item (Advantage+ Catalog/retargeting).

### 16.4 Onde cada evento dispara
| Evento | Ficheiro / gatilho | Condição |
|---|---|---|
| `view_menu` | storefront `/` → mount com menu carregado | sempre |
| `view_item` | abrir detalhe/abrir item | sempre |
| `add_to_cart` | `useCart` ADD | sempre |
| `begin_checkout` | entrar em `/checkout` | sempre |
| `add_payment_info` | escolher M-Pesa/e-Mola/auto | sempre |
| `purchase` | `/order-status/[orderId]` | **APENAS `paid`/`approved`** (16.1) |
| `lead` | waitlist submit | loja fechada |
| `coupon_applied` | aplicar referral (17) | código válido |

### 16.5 `order_items` no order-status (para `items[]`/`contents[]`)
O `get_order_status` passa a devolver também `order_items(menu_item_id, name_snapshot, qty, unit_price_cents)`, para preencher GA4 `items[]` e Meta `contents[]` com detalhe por produto. Sem isto, cai no fallback `item_id = order.id` / `num_items: 1`.

### 16.6 Eventos first-party (fonte de verdade interna)
- Tabela `analytics_events` (ver 19). Client faz `POST /api/track` (Zod + `session_id` cookie 1st-party + `customer_phone` se identificado em 18.2). Server insere via service role — **anon nunca faz INSERT direto**.
- Sobrevivem a adblock/iOS → alimentam o funil do painel **Análise**. Pixels são para os ad networks; estes são a verdade.

### 16.7 Cookies & consentimento
- Banner PT (cookie `dl_consent`). Sem consentimento → só `session_id` 1st-party + first-party events; **GTM/Pixel/Ads só carregam após "Aceitar"**.

### 16.8 Server-Side: Meta CAPI + Google Enhanced Conversions (anti iOS/adblock)
- **Meta CAPI:** na MESMA transação/handler que confirma o pedido — `confirm_payment` (digital → `paid`) **e** `advance_order APPROVE` (manual → `approved`) — disparar (fire-and-forget, **nunca** bloqueia o pedido) um POST à Conversions API com `event_id: 'purchase_<orderId>'` (o mesmo do browser → Meta deduplica). Token lido de `settings.meta_capi_token` (B) ou fallback `.env META_CAPI_TOKEN`.
- **Google Enhanced/Offline Conversions:** no webhook Paysuite / na confirmação, enviar a conversão com `transaction_id = order.id`. Token de `settings.gads_developer_token` (B) ou fallback `.env GOOGLE_ADS_DEVELOPER_TOKEN`.
- Regra: falha de envio server-side **nunca** afeta o estado do pedido (log em `event_log`, segue a vida).

### 16.9 KPIs no painel Análise
Aba **Análise** (Recharts existente): funil com taxas de conversão por etapa (entrada→carrinho→checkout→compra), origem (`utm_source/medium` gravados no `analytics_events`), ROAS aproximado se Ads ligado. Tudo derivado de `analytics_events` via view SQL (sem `tenant_id`).

---

## 17. Indique e Ganhe + Presente/Cupom (FASE 5)

> Cada pessoa tem um **código** para partilhar. Um amigo coloca o código no fim do pedido → ganha **desconto** ou **item grátis**.
> Quem emitiu **não pode resgatar o próprio código** e cada código vale **um resgate** (configurável). Tudo validado no servidor.

### 17.1 Regras (decisões fechadas)
- O **benefício é do redentor** (quem usa o código): `discount` (centavos ou %) **ou** `free_item` (um item específico a preço 0).
- O **emissor** acumula crédito opcional (`referral_codes.referrer_reward_cents`) — MVP pode deixar como log; ativar depois.
- **Anti-abuso (validado SÓ no servidor, no `create_order`):**
  - `owner_phone == customer_phone` → rejeita (auto-resgate).
  - código já resgatado (`referral_redemptions` atingiu `max_redemptions`, default 1) → rejeita.
  - mesmo `customer_phone` já resgatou esse código → rejeita.
  - código inativo/expirado → rejeita.
- **Item grátis:** marcado por `menu_items.is_gift = true` (categoria "SEU PRESENTE", `available=false` por padrão). Só entra no pedido a preço 0 **se** um cupom válido o liberar, e **no máximo 1 unidade**. Sem cupom, o servidor remove/recusa qualquer item `is_gift`.
- O desconto/preço final é **recalculado no servidor**. O client só mostra *preview* (o "muda os preços do site" é cosmético até o `create_order` confirmar).

### 17.2 Fluxo
1. Front tem barra abaixo da hero: **"Coloque aqui o código do seu amigo"**. Ao aplicar → chama RPC `validate_referral(p_code, p_phone)` (read-only, SECURITY DEFINER) que devolve `{ valid, reward_type, reward_value, gift_item }` **sem** confiar nisso para o preço final.
2. Se válido: UI libera a categoria **SEU PRESENTE** (1 item grátis) e/ou mostra desconto previsto.
3. No checkout, o `p_payload` carrega `referral_code`. O `create_order` revalida tudo, aplica o benefício, grava `referral_redemptions`, e loga `referral.redeemed` em `event_log`.
- Geração de códigos: cada `customer` (18) recebe um código estável ao identificar-se; admin pode criar campanhas manuais.

---

## 18. Entrada personalizada + Gamificação (FASE 6)

### 18.1 Página de entrada (gate, não-scrollável)
- Antes da hero, uma tela cheia com imagem do restaurante (de `brand.ts`) + 1 campo: **telefone**. Sem scroll. CTA "Entrar".
- Ao submeter → `identify_customer(p_phone, p_name?)` (RPC SECURITY DEFINER): upsert em `customers`, devolve histórico leve (favoritos derivados, últimas compras resumidas). Seta cookie `dl_phone` (1st-party) e liga o `phone` aos `analytics_events`.
- **Risco de privacidade (anotar no código com `// DECISÃO:`):** sem OTP, isto é "soft login" — quem souber o número vê o histórico daquele número. Por isso a RPC devolve **só** itens/resumos, **nunca** morada, comprovativo ou dados de pagamento. Se o cliente quiser OTP no futuro → ADR.
- Personalização: itens favoritos (mais pedidos por aquele telefone) com ❤️, "Pedir de novo" das últimas compras. Pode-se pular o gate (link "ver cardápio") — não bloquear a venda.

### 18.2 Modo "energizado" (gamificação)
- À medida que o carrinho cresce (subtotal), o site/`botão Finalizar` ganham brilho progressivo (CSS via `--gold`, sem libs pesadas; estado derivado do subtotal, **não** persiste preço).
- **Meta de brinde:** `settings.gift_goal_cents` (ex.: 250000 = 2500 MT) e `settings.gift_goal_item_id`. Ao bater a meta no subtotal, o servidor (no `create_order`) adiciona o item-prémio a 0 — **validado no servidor**, não no client. Barra de progresso "Faltam X MT para o seu brinde 🎁".
- Tudo cosmético no client; **o brinde só é real quando o `create_order` o concede** (mesma disciplina do cupom).

---

## 19. Schema novo das FASES 4–6 (migrar em fases — aditivo, RLS 14.1)

```
analytics_events    (id bigserial pk, session_id text, customer_phone text null,
                     type text, value_cents int null, utm jsonb, payload jsonb, created_at)
                     -- append-only; INSERT só via /api/track (service role); ler só authenticated
customers           (phone text pk, name text, first_seen_at, last_seen_at,
                     orders_count int default 0, total_spent_cents int default 0)
                     -- identificação soft (sem OTP); leitura pública só via RPC do próprio telefone
referral_codes      (id uuid pk, code text unique, owner_phone text null, owner_name text,
                     reward_type text check in ('discount_cents','discount_pct','free_item'),
                     reward_value int,                 -- centavos, % ou ignorado se free_item
                     gift_item_id uuid null,           -- se free_item
                     referrer_reward_cents int default 0,
                     max_redemptions int default 1, active bool default true,
                     expires_at timestamptz null, created_at)
referral_redemptions(id uuid pk, code_id uuid, order_id uuid, customer_phone text, created_at,
                     unique(code_id, customer_phone))  -- 1 resgate por cliente por código
```
Aditivos a tabelas existentes:
- `menu_items.is_gift bool default false`
- `settings.gift_goal_cents int null`, `settings.gift_goal_item_id uuid null`
- `orders.referral_code text null`, `orders.discount_cents int default 0`, `orders.gift_item_id uuid null`
  (total no servidor = `subtotal - discount + delivery_fee`)

**Nunca:** confiar no client para desconto, brinde ou validade de cupom; expor pixels com ID hardcoded; carregar marketing sem consentimento; devolver PII de outro telefone na personalização.

---

## 20. CRM, Fidelização & Aniversário (FASE 7) — spec COMPLETA

> Objetivo: a tabela `customers` **já existe** (§19, soft-login sem OTP) mas não tem ecrã no admin. Transformá-la
> numa **base de clientes gerível pelo dono** (CRM), com email/aniversário **opcionais** e consentimento de marketing;
> e dar um **presente automático no aniversário** reusando o motor de cupom/presente da FASE 5 (§17) — zero lógica de
> preço nova. Single-tenant: tudo em `customers`/`settings`, sem `tenant_id`.

### 20.1 Decisões fechadas
- **Correção do NAV:** hoje a tab "Clientes" em `(admin)/layout.tsx` aponta para `/lista-espera` (a Lista de Espera).
  Passa a haver **`/clientes` = CRM real** (novo) e `/lista-espera` mantém o label correto "Lista de Espera".
- `customers` ganha campos **OPCIONAIS**: `email`, `birthday`, `notes`, `marketing_opt_in bool default false`,
  `tags text[] default '{}'`. O **telefone continua a PK e o canal primário** (Moçambique = WhatsApp/SMS, não email).
- **Consentimento:** nenhum email/SMS **de marketing** sai para um cliente sem `marketing_opt_in = true`. O
  transacional (pedido/pagamento) não precisa de opt-in; o marketing precisa. (Mesma cultura do `dl_consent`, §16.7.)
- **Recolha:** email/aniversário/opt-in captados no checkout (campos opcionais) e/ou no gate de entrada (§18.1).
  `create_order` e `identify_customer` aceitam-nos e fazem **upsert** — **nunca obrigatórios, nunca bloqueiam a venda**;
  upsert não apaga dado existente quando o campo vem vazio.
- **Privacidade:** a lista completa com PII só é legível por `authenticated` via RPC `admin_list_customers`. anon
  nunca. A RPC pública `identify_customer` continua a devolver só resumos do próprio telefone (§18.1).

### 20.2 Presente de aniversário (reusa FASE 5, §17)
- Config no admin (Definições): `settings.birthday_gift_enabled bool default false` + o prémio
  (`birthday_reward_type` ∈ `discount_cents|discount_pct|free_item`, `birthday_reward_value int`,
  `birthday_gift_item_id uuid null`, `birthday_valid_days int default 7` = janela de resgate).
- Cron diário `/api/cron/birthdays` (protegido por `CRON_SECRET`): encontra `customers` com aniversário = hoje (mês/dia)
  **e** `marketing_opt_in` → para cada um **emite um `referral_codes` pessoal** (owner_phone = null, max_redemptions = 1,
  `expires_at = hoje + birthday_valid_days`, reward = config) e avisa o cliente por email se houver (template
  `birthday_gift`, §21). **Idempotente por ano** (`customers.birthday_gift_issued_year`) — nunca emitir 2× no mesmo ano.
- O **resgate é o fluxo de cupom normal** (§17): o cliente mete o código no checkout, `create_order` revalida e aplica.
- Widget **"Aniversários de hoje/da semana"** no CRM para o dono mandar WhatsApp à mão quando não houver email.

### 20.3 Schema (aditivo, RLS 14.1)
```
customers (aditivo): email text null, birthday date null, notes text null,
                     marketing_opt_in bool default false, tags text[] default '{}',
                     birthday_gift_issued_year int null
settings  (aditivo): birthday_gift_enabled bool default false, birthday_reward_type text null,
                     birthday_reward_value int null, birthday_gift_item_id uuid null,
                     birthday_valid_days int default 7
```
RPCs (`authenticated`): `admin_list_customers(p_limit,p_offset,p_search,p_sort)`,
`admin_update_customer(p_phone, p_patch jsonb)` (notes/tags/opt-in). O cron usa service role.

**Nunca:** marketing a quem não deu `marketing_opt_in`; obrigar email/aniversário (a venda nunca depende disso);
devolver a lista de clientes a anon; emitir 2× o presente de aniversário no mesmo ano; criar lógica de desconto
fora do motor §17.

---

## 21. Email Marketing — templates editáveis + campanhas (FASE 7) — spec COMPLETA

> Objetivo: o dono **gere os emails** do sistema no admin — vê todos os templates "setados", edita assunto/corpo a
> partir de um **padrão**, e (opcional) envia campanha para a lista opt-in. Hoje os emails são route handlers fixos
> (`apps/web/app/api/emails/*`: `send-order-email`, `send-approval-email`, `send-rejection-email`,
> `send-cash-close-email`); passam a ler um template **editável com fallback para o padrão embutido**.

### 21.1 Decisões fechadas
- Tabela `email_templates(key text pk, subject text, body_html text, enabled bool default true, updated_at)`.
  Keys canónicas (transacionais existentes): `order_received_owner`, `payment_approved`, `payment_denied`, `cash_close`;
  mais `birthday_gift` (§20.2). Campanhas usam tabela própria (`email_campaigns`).
- **O default vive no código** (os HTML atuais dos route handlers) e é a fonte de verdade do fallback. Sem linha em
  `email_templates` para a key → usa o default. **"Repor padrão" = apagar a linha.** Assim o dono **nunca parte o
  sistema** ao editar — o pior caso cai no default embutido.
- **Variáveis** com sintaxe fixa `{{customer_name}}`, `{{order_number}}`, `{{total}}`, `{{items}}`, `{{coupon_code}}`,
  etc. **Render sempre no servidor, a partir de dados do servidor** — nunca confiar em valores vindos do client.
  Cada key tem uma lista de variáveis permitidas, documentada na UI.
- Remetente/assunto vêm do template; a chave Resend de `.env`/`settings` (padrão §16.2 B). Email continua
  **best-effort**: falha de email nunca bloqueia o pedido.

### 21.2 Admin (sub-secção "Emails", dentro de Marketing ou tab própria)
- Lista de **todos** os templates (key, assunto, enabled, atualizado em). Editar: assunto + corpo (HTML) com
  variáveis clicáveis, **preview** com dados de exemplo, **enviar teste** ao `owner_email`, **repor padrão**.
- **Campanhas (opcional, F7.4):** compor email único + segmento (todos opt-in / aniversariantes do mês / top clientes)
  → `/api/emails/campaign` (authenticated, rate-limit, envio em lote via Resend, regista `sent_count` + event_log).
  **Sempre respeita `marketing_opt_in`.**

### 21.3 Schema (aditivo, RLS 14.1)
```
email_templates (key text pk, subject text, body_html text,
                 enabled bool default true, updated_at timestamptz default now())
                 -- staff_all (authenticated); render só server-side; anon nunca
email_campaigns (id uuid pk, subject text, body_html text, segment text,
                 sent_count int default 0, created_by, created_at)   -- opcional (F7.4)
```
Render: `apps/web/lib/email/render.ts` (substitui `{{variáveis}}`, sanitiza). Os route handlers passam a
`loadTemplate(key) ?? default`.

**Nunca:** render de template com dados vindos do client; enviar campanha a quem não deu opt-in; deixar o sistema
sem email por o dono ter apagado um template (fallback para o default embutido); expor a Resend key a anon.

---

## 22. Estúdio de Conteúdo / Social (FASE 8) — spec COMPLETA

> Objetivo: o dono **planeia e prepara** posts para redes sociais dentro do admin (calendário + legenda/imagem
> geradas por IA) e **publica à mão** (copiar legenda / descarregar imagem). **Auto-publish via Meta Graph API NÃO
> entra nesta fase** — exige OAuth, revisão de app da Meta e token de página **por restaurante**, o que colide com o
> turnkey "clonar → `.env` → deploy". Só com ADR (§22.4).

### 22.1 Decisões fechadas
- Tabela `social_posts` (rascunho → agendado → publicado-à-mão). **Sem integração externa obrigatória.**
- A geração por IA (legenda + imagem) é por **route handler server-side** com a chave configurada no admin
  (`settings.ai_*`, segredo B §16.2 / fallback `.env`) — **provider-agnóstico** (o dono "põe uma IA barata"). O client
  **nunca** chama a IA direto nem guarda a chave.
- Imagens geradas vão para um bucket Storage `social-media` (leitura pública — são para publicar). Legendas/prompts
  ficam em `social_posts`. Geração é **best-effort**: falha de IA nunca parte o painel.

### 22.2 Admin (tab "Conteúdo")
- Vista calendário + lista. Criar post: canais como etiquetas (instagram/facebook/whatsapp_status), legenda (escrever
  ou **"Gerar com IA"** a partir de um item do cardápio/promoção), imagem (upload ou **"Gerar imagem"**), data prevista.
  Ações: copiar legenda, descarregar imagem, marcar **"Publicado"**.
- Routes: `/api/social/generate-caption` (item/promo → legenda PT + hashtags), `/api/social/generate-image`
  (prompt → imagem no bucket).

### 22.3 Schema (aditivo, RLS 14.1)
```
social_posts (id uuid pk, channels text[] default '{}', caption text, image_url text null,
              ai_prompt text null, scheduled_for timestamptz null,
              status text check in ('draft','scheduled','published') default 'draft',
              created_by, created_at, updated_at)   -- staff_all (authenticated); anon nunca
settings (aditivo, opcional): ai_provider text null, ai_api_key text null  -- (B) segredo §16.2
```

### 22.4 Auto-publish (Visão futura — ADR obrigatório)
Publicar automático no Instagram/Facebook exige Meta Graph API + OAuth + revisão de app + **token de página por
restaurante** → colide com o single-tenant turnkey. Só avançar com ADR em `/docs/decisions` (como a V.1 do ROADMAP).
MVP: preparar + publicar à mão.

**Nunca:** guardar a chave de IA no client ou expô-la a anon; auto-publicar em rede social sem ADR; bloquear o painel
se a IA falhar (geração é best-effort).

---

## 23. WhatsApp, Alertas & Relatório Semanal (FASE 9) — spec COMPLETA

> Objetivo: **WhatsApp é o canal real de Moçambique** (email é fraco lá). Nível 1 = deep links `wa.me` com mensagem
> pré-preenchida (zero API, zero custo) espalhados pelo painel e loja. Mais: o painel vira **PWA com push + campainha**
> (o dono nunca perde um pedido) e o dono recebe um **relatório semanal automático** (a mensalidade "fala" com ele).
> **WhatsApp Cloud API (envio automático) NÃO entra nesta fase** — é a V.6 (ADR): custo por conversa + setup Meta
> por restaurante colide com o turnkey.

### 23.1 WhatsApp nível 1 — deep links (decisões fechadas)
- Helper canónico `apps/web/lib/whatsapp.ts`: `waLink(phone, message)` → `https://wa.me/<E164 sem '+'>?text=<encoded>`.
  Normaliza números MZ (9 dígitos começados em 8 → prefixo `258`). Mensagens padrão PT vivem **no código**
  (`waMessages.orderApproved(order)`, `orderOutForDelivery`, `orderReadyPickup`, `birthdayGift(code)`, …) — só o
  servidor/painel fornece os dados, nunca texto vindo do client.
- `settings` aditivo: `whatsapp_number text null` — número do restaurante. É campo **público (classe A, §16.2)** →
  devolvido por `get_menu()` (SELECT com colunas explícitas).
- **Painel:** botões wa.me em Pedidos (avisar cliente: aprovado / saiu para entrega / pronto para levantar), no CRM
  (falar com cliente) e no widget de aniversários (§20.2 — enviar o cupom por WhatsApp à mão).
- **Loja:** botão "Falar com o restaurante" (order-status + menu) quando `whatsapp_number` existir.
- O clique abre o WhatsApp do **dono/cliente** com a mensagem pronta — o envio é humano. Isso é feature, não limitação:
  não exige opt-in nem API (quem envia é a pessoa).

### 23.2 PWA + Web Push + campainha (decisões fechadas)
- Painel instalável: `manifest.webmanifest` (nome/ícones de `brand.ts`) + service worker `apps/web/public/sw.js`
  **mínimo** (só `push` + `notificationclick` → abre `/pedidos`; **sem** cache offline nesta fase).
- Tabela `push_subscriptions(id uuid pk, endpoint text unique, keys jsonb, user_email text null, created_at)` —
  RLS staff_all; INSERT via route `/api/push/subscribe` (authenticated).
- Envio via `web-push` (VAPID): `VAPID_PUBLIC_KEY` (exposta ao client) + `VAPID_PRIVATE_KEY` (só servidor) no `.env`.
  Dispara **fire-and-forget** quando o pedido entra em `awaiting_approval` (manual) ou `paid` (digital) — nos handlers
  que já tratam esses momentos. Payload **sem PII**: `"🔔 Novo pedido ENC-0042 — 350 MT"`. Subscrição morta (410) →
  apagar a linha. Falha de push **nunca** bloqueia o pedido.
- **Campainha:** no painel, subscrição Supabase Realtime a `orders` (migration adiciona a tabela à publication) →
  novo pedido a exigir ação toca `bell.mp3` em loop até interação; toggle de som persistido em `localStorage`.
  O som é **redundância** do push (painel aberto), como a impressora é do painel.

### 23.3 Relatório semanal automático (decisões fechadas)
- Cron `/api/cron/weekly-report` (protegido por `CRON_SECRET`, segunda de manhã): métricas da semana anterior vs a
  antecedente — faturado, nº pedidos confirmados (§4.5), ticket médio, top 3 produtos, hora de pico, split
  levantamento/entrega. **Deriva das views de Análise existentes** — não inventar queries novas.
- Envio por email ao `owner_email` via motor §21 (key nova `weekly_report` na lista canónica; default embutido).
- Card "Resumo da semana" na aba **Análise** com botão **partilhar no WhatsApp** (wa.me com o texto do resumo —
  o dono manda para si próprio/sócios).
- **Idempotente por semana**: loga `report.weekly_sent` em `event_log` com a chave da semana ISO; se já existe, não reenvia.

**Nunca:** WhatsApp Cloud API / envio automático de WhatsApp sem ADR (V.6); PII no corpo da push; push/campainha como
único canal (email continua); falha de push/relatório a afetar pedidos; texto de mensagem vindo do client.

---

## 24. Entregadores & "A caminho" (FASE 10) — spec COMPLETA

> Objetivo: fechar o ciclo do delivery. Hoje o pedido "morre" em `ready`: ninguém atribui entregador, o cliente não
> vê quem vem. Entra a entidade **rider**, o estado **`out_for_delivery`**, uma **página móvel do entregador sem
> login** (link com token por pedido, enviado por WhatsApp §23.1) e o tracker do cliente ganha nome/telefone do
> entregador. Single-tenant; sem app nativa — browser, como tudo aqui.

### 24.1 Decisões fechadas
- Tabela `riders(id uuid pk, name text, phone text, active bool default true, created_at)` — RLS staff_all; anon nunca.
- `orders` aditivo: `rider_id uuid null references riders(id)`, `rider_token uuid not null default gen_random_uuid()`
  (unique — o segredo do link do entregador).
- **Máquina de estados** (`packages/core/src/order-machine.ts` — testes Vitest ANTES de mexer): novo estado
  `out_for_delivery` + evento `DISPATCH` (`ready → out_for_delivery`, só `fulfillment_type='delivery'`); `DELIVER`
  passa a aceitar `ready → delivered` (pickup/balcão) **e** `out_for_delivery → delivered`. Migration atualiza
  `advance_order` e **adiciona `out_for_delivery` ao conjunto de "venda confirmada"** (§4.5) em TODAS as RPCs/views
  que o enumeram (`get_order_stats`, `get_dashboard_metrics`, `get_cash_dashboard`, `identify_customer`, …).
- **Atribuição:** no painel, pedido delivery em `ready` ganha "Atribuir entregador" (select de riders ativos) →
  grava `rider_id` + `advance_order DISPATCH` + botão wa.me (§23.1) que envia ao rider o link `/entrega/<rider_token>`.
- **Página do entregador** `(public)/entrega/[token]` (mobile-first, sem login):
  - RPC `get_delivery_job(p_token uuid)` (SECURITY DEFINER, grant anon): devolve **só o necessário ao trabalho** —
    order_number, customer_name, customer_phone (botão ligar), morada + zona, scheduled_for, badge de pagamento
    (`PAGO` ou `COBRAR X MT` se cash) e status. Token errado → vazio (sem enumerar).
  - RPC `rider_mark_delivered(p_token uuid)`: única transição permitida `out_for_delivery → delivered` (internamente
    `advance_order DELIVER`, `event_log` com actor `rider`). Depois de `delivered`, a página mostra só "Entregue ✔"
    — **deixa de expor a morada/telefone**.
- **Cliente:** `get_order_status` devolve também `rider: { name, phone }` **apenas** quando `out_for_delivery`.
  O tracker da loja mapeia `out_for_delivery` → "A caminho" (o passo visual já existe).

### 24.2 O que o rider NUNCA vê/faz
Lista de outros pedidos; histórico; painel; cancelar/retroceder estados; dados de pagamento além do "cobrar X MT".
O token é por-pedido e morre (na prática) com `delivered`.

**Nunca:** rota de rider com SELECT direto anon (só as 2 RPCs); token adivinhável ou sequencial; expor PII depois de
entregue; app nativa/login para riders (browser + token); esquecer `out_for_delivery` no conjunto de venda confirmada.

---

## 25. Carteira/Cashback + Funil Google Reviews (FASE 11) — spec COMPLETA

> Objetivo: retenção do cliente final. **Cashback**: % de cada venda confirmada volta como saldo em MT preso ao
> telefone, gasto no pedido seguinte — casa com a cultura M-Pesa e ninguém em MZ o tem nativo. **Google Reviews**:
> avaliação 5★ no feedback vira convite para avaliar no Google (crescimento orgânico grátis). Toda a contabilidade
> é **ledger append-only em centavos, só no servidor** — mesma disciplina do dinheiro (§14.5).

### 25.1 Carteira (decisões fechadas)
- Tabela `wallet_ledger(id bigserial pk, customer_phone text not null, order_id uuid null,
  delta_cents int not null, reason text check in ('cashback','redeem','redeem_refund','adjust'),
  created_at timestamptz default now())` — **append-only** (sem UPDATE/DELETE policies), RLS staff_all para leitura
  do painel; movimentos automáticos só via RPCs/handlers do servidor; anon nunca toca. **Saldo = SUM(delta_cents)**.
  Índices únicos parciais `(order_id) where reason='cashback'` e `(order_id) where reason='redeem'` → idempotência.
- `settings` aditivo: `cashback_enabled bool default false`, `cashback_pct int default 0 check (cashback_pct between 0 and 50)`.
- `orders` aditivo: `wallet_used_cents int not null default 0`.
- **Crédito:** na confirmação (`advance_order APPROVE` / `confirm_payment`), **na mesma transação**:
  `delta = (base * cashback_pct) / 100` (divisão inteira) com `base = subtotal - discount - wallet_used`
  (nunca dar cashback sobre taxa de entrega nem sobre saldo gasto). Só se `cashback_enabled` e houver `customer_phone`.
- **Resgate:** `create_order` aceita `use_wallet bool` no payload. O servidor lê o saldo do `customer_phone` do
  próprio pedido, aplica `wallet_used = min(saldo, subtotal - discount)` e grava ledger `redeem` (negativo).
  Total no servidor = `subtotal - discount - wallet_used + delivery_fee` (≥ 0 garantido). `CANCEL` de pedido com
  `wallet_used > 0` → linha compensatória `redeem_refund` na mesma transação.
- **Preview:** `identify_customer` (§18.1) passa a devolver também `wallet_cents` (só do próprio telefone). Checkout
  mostra "Tens X MT de saldo" + toggle "Usar saldo" — **preview**; a verdade é do `create_order`.
- `// DECISÃO:` sem OTP, o saldo é tão protegido quanto o soft-login (§18.1): quem declarar o telefone usa o saldo
  desse telefone. Risco aceite (cashback é fidelização, não dinheiro real); OTP futuro → ADR. `cashback_pct` baixo
  (2–10%) por recomendação ao dono.
- Painel: saldo visível no CRM (§20) por cliente + ajuste manual (`adjust`, logado com motivo em `event_log`).

### 25.2 Funil Google Reviews (decisões fechadas)
- `settings` aditivo: `google_review_url text null` — campo **público (classe A)**, devolvido por `get_menu()`.
- No fluxo de feedback pós-entrega: rating **= 5** → ecrã de sucesso mostra CTA "Gostaste? Avalia-nos no Google ⭐"
  com o link. Rating < 5 → só o obrigado normal (o feedback negativo fica interno, no painel).
- **Nunca condicionar benefício** (desconto/brinde) à review — viola as políticas do Google e do bom senso.

**Nunca:** saldo calculado/alterado no client; UPDATE/DELETE em `wallet_ledger`; cashback ou redeem duplicado no
mesmo pedido (índices únicos); resgate maior que o saldo ou total negativo; incentivo pago por review no Google.

---

## 26. Aparência da Loja no admin — tema, formatos e conteúdo (FASE 12) — spec COMPLETA

> Objetivo: o dono muda o **visual** da loja sem deploy — cores (tema), formato do layout (**1–5 arranjos**) e
> conteúdo (hero, banners, textos, redes) — tudo na tab **`/layout-loja`**. Evolui e **absorve a F10** do storefront
> (`(public)/CLAUDE.md §10`, ainda não implementada). Decisão fechada revista (§4): `brand.ts` = **default de
> fábrica**; `settings` guarda **overrides runtime** — precedência `settings` → `brand.ts`, o mesmo padrão de
> Paysuite (§6.2) e email templates (§21). **UM só frontend com N formatos — NUNCA N frontends/forks.**

### 26.1 Divisão build vs runtime (decisão fechada)
| Runtime (`settings`, dono muda no admin) | Build (`brand.ts`, Niraslab muda no deploy) |
|---|---|
| `storefront_theme` (cores/gradiente), `storefront_layout` (1–5), `hero_image_url`, `banner_images`, `storefront_content` (textos/redes), `whatsapp_number` (§23) | Nome legal, fontes (`next/font` é build-time), assets base/fallback de produto, ícones PWA |

### 26.2 Tema de cores (`storefront_theme jsonb default '{}'`)
- Overrides **parciais** dos tokens `--st-*` da loja: `{ primary, primary2, bg, card, star }` (o gradiente
  `--st-grad` deriva de `primary`+`primary2` — não é campo próprio).
- **Validação Zod dupla** (ao gravar no admin E ao renderizar): só chaves conhecidas; valor tem de ser hex
  `#rrggbb`. Chave desconhecida/valor inválido → **ignorado silenciosamente** (nunca chega ao CSS — isto é a defesa
  contra CSS injection). `{}` ou falha total → `brand.ts` intacto.
- Merge num único sítio: `(public)/layout.tsx` (o mesmo que já injeta as CSS vars do brand):
  `tokens = { ...brand.storefront, ...validado(settings.storefront_theme) }`. Componentes continuam a ler
  `var(--st-…)` — **não sabem** de onde veio o valor.
- Admin: color pickers + **amostra ao vivo** (botão gradiente, card de produto, pill renderizados com os valores
  escolhidos — sem iframe), **aviso de contraste AA** (texto branco sobre `primary`), botão **"Repor padrão"**
  (grava `{}`). O dono **nunca consegue partir a loja**.

### 26.3 Formatos de layout (`storefront_layout` 1–5)
- Estende o check da F10 de `(1,2,3)` para `between 1 and 5`. Catálogo:
  **1** Hero clássico (default, F10) · **2** Hero + mini banners (F10) · **3** Grid mercado (denso, hero baixo,
  grid 2 col direto) · **4** Lista compacta (texto-first, fotos pequenas à direita — menus longos) ·
  **5** Editorial (1 coluna, foto grande, descrição em destaque — fine dining).
- Cada formato é **composição de secções** existentes no `menu/page.tsx` (hero, banners, barra de cupom,
  categorias, grelha/lista de produtos) — mesmos componentes, arranjo/densidade diferentes. **Zero fork.**
- Admin: cards de preview com **thumbnail estático** de cada formato (imagem em `public/`, não screenshot dinâmico);
  selecionar = gravar o número. Formato fora de 1–5 na BD → renderiza o 1.
- Hero/banners: como na F10 (`hero_image_url`, `banner_images` até 5 `{url,title,sort}`, bucket **público**
  `storefront-assets`, upload via `POST /api/upload-storefront-asset` authenticated).

### 26.4 Conteúdo editável (`storefront_content jsonb default '{}'`)
- Campos (todos opcionais, fallback **por campo** para `brand.ts`): `tagline`, `hero_title`, `hero_subtitle`,
  `footer_text`, `closed_message` (loja fechada), `social { instagram, facebook, tiktok }` (URLs).
- **Texto puro SEMPRE** — Zod valida strings com tamanho máximo; a loja renderiza como texto
  (**nunca** `dangerouslySetInnerHTML`) → XSS impossível por construção. URLs de `social` validadas (https).
- Admin: editor simples com preview e "repor" por campo.

### 26.5 Exposição pública
`storefront_theme`, `storefront_layout`, `hero_image_url`, `banner_images`, `storefront_content` são todos campos
**públicos (classe A, §16.2)** → devolvidos por `get_menu()` com **colunas explícitas** (nunca `select *`, nunca ao
lado de campos B).

**Nunca:** N frontends/forks por formato; hardcodar cor/texto de marca em componente (regra do `(public)/CLAUDE.md
§6` continua); renderizar valor de tema não-validado (CSS injection) ou HTML de `storefront_content` (XSS); campos
B no mesmo SELECT; deixar a loja partir por config errada — o fallback `brand.ts` é sagrado.

---

## 27. INSTÂNCIA BABALAZA (Salvação) — o que esta instância tem a MAIS

> Esta secção manda nesta instância. As §1–26 descrevem o motor; a §27 descreve a **Babalaza**. As fases de
> execução dos módulos novos estão em **`ROADMAP.md` (B0–B9)**. Padrões canónicos (RLS, dinheiro, webhook,
> máquina de estados, Paysuite, print-bridge) continuam a valer tal e qual.

### 27.0 Contexto do negócio (factos fechados)
| | |
|---|---|
| **Cliente** | **Ana Malate** — **Babalaza · Salvação** (bar · restaurante · delivery), Maputo, Moçambique |
| **Dev & manutenção** | **Leapfrog** — Gabriel dos Santos · niraslab.dev@gmail.com · WhatsApp +27 63 485 1904 |
| **Domínio** | `babalaza.co.mz` — site público + email profissional |
| **Email** | `@babalaza.co.mz` via Resend (domínio verificado). Comunicação em massa com a base de clientes é **PRIORIDADE** (ativar FASE 7) |
| **Tema** | Escuro + **dourado** — já é o default do motor (`--gold #e5a93c`). Afinar em `config/brand.ts` |

> ⚠️ **Dois M-Pesa diferentes — nunca confundir:**
> - **M-Pesa do PROJETO** `85 386 0621` (Gabriel dos Santos) — a Ana usa-o só para **pagar o desenvolvimento** à Leapfrog. **NUNCA entra no código.**
> - **M-Pesa da BABALAZA** (número da loja, a confirmar) — ligado ao **Paysuite/Vodacom** para **receber vendas**. É este que vai em `settings`/chaves Paysuite.

### 27.1 Os 6 módulos novos (mapa)
| # | Módulo | Estende |
|---|---|---|
| **B1** | **Site institucional público** — homepage no Google, **botão GRANDE "ENTRAR NO DELIVERY"**, sobre, galeria, mapa, horário, reservas, eventos, CTAs | novo (loja passa a `/delivery`) |
| **B2** | **Canais de pedido** `orders.channel ∈ (delivery, pickup, dine_in, bar)` | `orders`, state machine |
| **B3** | **QR das mesas** — pede na mesa → comanda na cozinha+bar com **Nº da mesa**; **não é conta** | loja + impressão |
| **B4** | **Autoatendimento no bar** — QR grande, **pede e paga sozinho** (M-Pesa) → **número de levantamento** | fluxo digital Paysuite |
| **B5** | **Impressão em 3 estações** — cozinha delivery · cozinha restaurante · bar | `print-bridge` |
| **B6** | **M-Pesa Vodacom em produção** + Painel (mesas mais activas) + Email @babalaza em massa | Paysuite, Análise, FASE 7 |

### 27.2 Canais de pedido (`orders.channel`) — decisão fechada
```sql
orders.channel      text not null default 'delivery' check (channel in ('delivery','pickup','dine_in','bar'))
orders.table_id     uuid null references tables(id)   -- obrigatório se channel='dine_in'
orders.pickup_number text null                          -- gerado se channel='bar'
```
| channel | Nasce em | Pagamento | Imprime em | Talão |
|---|---|---|---|---|
| `delivery` / `pickup` | `/delivery` | manual ou Paysuite | **cozinha delivery** | cupom (nome/zona/morada/horário) |
| `dine_in` | **QR da mesa** `/m/[token]` | na mesa (M-Pesa opcional) ou balcão | **cozinha restaurante + bar** | comanda com **Nº MESA** — **não é conta** |
| `bar` | **QR do bar** `/bar` | **pay-first** (Paysuite obrigatório) | **bar** | comanda + **Nº LEVANTAMENTO** |

`fulfillment_type` mantém-se, relevante só para `delivery`/`pickup`. "Venda confirmada" (§4.5) inalterada.

### 27.3 B1 — Site institucional público
- A loja/cardápio do motor passa a viver em **`/delivery`**; a **raiz `/`** vira o **site institucional** (SSR, metadata, OG, `sitemap.xml`, `robots.txt`, JSON-LD `Restaurant` — encontrável no Google).
- Hero com fotos reais + **botão GRANDE "ENTRAR NO DELIVERY"** (CTA dourada, topo). Secções: **Sobre · Galeria · Localização (mapa) · Horário · Contactos · Reservas · Eventos**. **CTAs no início e no fim** (Entrar no delivery / Reservar / WhatsApp).
- **Reservas:** form → grava `reservations` + email ao dono + wa.me. Nunca bloqueia (é pedido; o dono confirma).
- **Eventos:** lista de `events` gerível no admin.
- Conteúdo/tema reusam a FASE 12 (`settings.storefront_*`). Nada de marca hardcoded.

### 27.4 B3 — QR das mesas (`channel='dine_in'`)
- Tabela `tables (id, number, token uuid unique, active)`. Cada mesa tem QR físico → **`/m/[token]`**.
- Fluxo: ler QR → cardápio amarrado à mesa → **confirma resumo** → `create_order(channel='dine_in', table_id)` → comanda na **cozinha restaurante + bar** com **Nº da mesa em destaque**. A equipa confere e serve.
- **O talão da mesa NUNCA é conta** — imprimir comanda ≠ fechar conta. Pagamento é ato da equipa (balcão ou M-Pesa na mesa).
- **Anti-abuso (servidor):** (1) enviar exige o `token` físico da mesa — de casa vê-se o menu mas não se manda; (2) rate-limit por `table_id` + resumo confirmado + fora de horário fecha; (3) talão não é venda; (4) a equipa pode ignorar suspeitos.
- **NOTA §12:** a proibição de `qr_token` era contra **gating multi-tenant**. `tables.token` é um **identificador físico de mesa dentro do único tenant** (sem planos, sem `tenant_id`) — **permitido e necessário**.

### 27.5 B4 — Autoatendimento no bar (`channel='bar'`)
- QR grande no bar → **`/bar`** (auto-serviço de balcão). **Pay-first obrigatório:** escolhe → **paga já** (Paysuite/M-Pesa, fluxo digital) → `paid` → gera **`pickup_number`** → comanda **no bar**.
- **Número de levantamento** no telemóvel: **número + nome + data/hora + confirmação** + **QR do pedido (redundância)**. A garçonete pode ler o QR para garantir "daquela hora/pessoa" — **não obrigatório** (número+nome+hora bastam).
- **Painel LED (opcional, hardware — fase própria B9):** equipa digita o número no LED; best-effort, **nunca acopla**.
- Valor **sempre recalculado no servidor**; `pickup_number` sequencial por dia (é chamada, não pagamento).

### 27.6 B5 — Impressão em 3 estações físicas
O motor já tem `station ∈ (kitchen, bar, cold_kitchen)` e `print_jobs.station`. O `print-bridge` passa a escolher a impressora por **`(channel, station)`**:
| Impressora | Recebe |
|---|---|
| **Cozinha DELIVERY** | comida (`kitchen`/`cold_kitchen`) de `channel ∈ (delivery, pickup)` |
| **Cozinha RESTAURANTE** | comida de `channel='dine_in'` |
| **BAR** | tudo `station='bar'` (qualquer canal) + comanda de `channel='bar'` |
- `.env` do print-bridge: `PRINTER_IP_COZINHA_DELIVERY`, `PRINTER_IP_COZINHA_REST`, `PRINTER_IP_BAR`.
- Um pedido gera **vários `print_jobs`** (ex.: mesa com comida + cerveja → job cozinha-rest + job bar). Templates de talão por contexto (delivery / **Nº MESA** / **Nº LEVANTAMENTO**). Impressora = redundância; painel = primário.

### 27.7 Menu real — `seed/menu-babalaza.json`
- Gerado do Excel final da Ana. **28 categorias, 254 itens.** `price_cents = MT × 100`.
- Estação já no JSON: comida → `kitchen`; bebidas (cervejas, cidras, espumantes, espirituosas, whiskey, gin, vodka, shots, garrafas, vinhos, águas/sumos/refrigerantes/energéticas) → `bar`.
- **Doses SIMPLES/DUPLO** expandidas em 2 itens (`Nome (Simples)`/`Nome (Duplo)`). Vinhos com `price_cents: null` → **preços a confirmar**. ⚠️ **Rever nomes/preços com a Ana** antes do go-live (a proposta prevê sugestões de combos).

### 27.8 M-Pesa Vodacom (Paysuite) + Email @babalaza
- **Paysuite:** usar o skill **`/connect-paysuite`**. Chaves da Babalaza em `settings` (admin → Definições) + fallback `.env`. Documentos Vodacom em `documentos/` (Alvará entregue; confirmar categoria E.I / colectiva). Fluxo digital obrigatório no **bar**.
- **Email em massa:** ativar **FASE 7** (CRM + templates + campanhas). Remetente `@babalaza.co.mz` (verificar domínio no Resend). Respeitar `marketing_opt_in`.

### 27.9 Schema — deltas Babalaza (aditivos, RLS 14.1)
```sql
alter table orders add column channel text not null default 'delivery'
  check (channel in ('delivery','pickup','dine_in','bar'));
alter table orders add column table_id uuid null references tables(id);
alter table orders add column pickup_number text null;
create table tables (id uuid primary key default gen_random_uuid(), number text not null,
  token uuid not null unique default gen_random_uuid(), active bool not null default true,
  created_at timestamptz default now());
create table reservations (id uuid primary key default gen_random_uuid(), name text, phone text,
  party_size int, reserved_for timestamptz, notes text,
  status text check (status in ('pending','confirmed','cancelled')) default 'pending',
  created_at timestamptz default now());
create table events (id uuid primary key default gen_random_uuid(), title text, description text,
  image_url text, starts_at timestamptz, active bool default true, sort int default 0,
  created_at timestamptz default now());
```
RPCs novas (SECURITY DEFINER, grant anon): `get_table(p_token uuid)` (valida mesa + devolve menu), `create_reservation(p_payload jsonb)` (rate-limited). `create_order` estendido: aceita `channel`/`table_id` e gera `pickup_number` quando `channel='bar'`. `tables`/`reservations`/`events`/`pickup_number` seguem o padrão anon-nunca-SELECT-direto.

### 27.10 O que NUNCA fazer (Babalaza)
- ❌ Confundir o M-Pesa do **projeto** (85 386 0621) com o da **loja** (Paysuite/Vodacom).
- ❌ Deixar mandar pedido para uma **mesa** sem o `token` físico dela.
- ❌ Tratar a **comanda da mesa como conta** (pagamento é ato da equipa).
- ❌ Deixar o **bar** criar comanda **antes de `paid`** (pay-first).
- ❌ Acoplar o sistema ao **LED**/impressoras (redundância).
- ❌ Confundir `tables.token` com `tenant_id`/gating (é físico, single-tenant).
- ❌ Marca/preço hardcoded — `brand.ts` + `settings` + `seed/menu-babalaza.json`.
- ❌ Campanha de email a quem não deu `marketing_opt_in`.
- ❌ Pular fase do `ROADMAP.md` sem terminar o DoD.
