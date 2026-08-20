# CLAUDE.md — HAWSMASH 2.0 · Restaurant OS multi-unidade

> **O que é:** o sistema que passa a correr **todo** o negócio do HAWSMASH — **balcão (POS), delivery,
> levantamento, pagamentos, estoque, caixa e cozinha** — em **duas lojas** (Maputo e Matola), num só painel.
> Motor herdado do **Delivery OS** (instância Casa do Bom Pasteleiro / Babalaza), fundido com tudo o que o
> **HAWSMASH 1.0** já tem em produção.
>
> **Dono do produto:** Niraslab / Leapfrog — Gabriel dos Santos · niraslab.dev@gmail.com
> **Cliente:** Ridwan · HAWSMASH (Maputo + Matola, Moçambique)
>
> Este ficheiro é a **fonte de verdade**. O plano de execução está em **[`ROADMAP.md`](ROADMAP.md)**.
> As regras de trabalho do agente estão em **[`AGENTS.md`](AGENTS.md)** — ler antes de escrever código.

---

## 0. CONTEXTO COMERCIAL (factos fechados — condicionam o âmbito)

| | |
|---|---|
| **Proposta** | `NL-2026-HS-EXP` — "Duas lojas, um só sistema" (`docs/legacy/Proposta-NL-2026-HS-EXP.html`) |
| **Fechado** | **50.000 MT** de implantação (pagamento único) + **20.000 MT/mês** de operação e suporte |
| **Prazo** | **Fase 1 pronta para a abertura das duas lojas** — as duas abrem **no mesmo dia**. Fase 2 até 6 semanas depois |
| **Não negociável na abertura** | **POS de balcão a cobrar** · **cozinha a imprimir** · **caixa a fechar** · **delivery a cair na loja certa** · **estoque a controlar** |
| **Fora de âmbito** | Facturação fiscal certificada (AT), equipamento (é do cliente), integrações de terceiros, 3.ª loja |
| **Equipamento** | PC touch + impressora térmica + gaveta por loja, a cargo do HAWSMASH. Especificação em [`docs/HARDWARE.md`](docs/HARDWARE.md) |

**Leitura operacional do preço:** a 20.000 MT/mês pelas duas lojas, **o suporte tem de ser barato de prestar**.
Isso é uma decisão de arquitectura, não de simpatia: o sistema tem de **avisar sozinho quando falha**,
**recuperar sozinho** do que for recuperável e **nunca perder uma venda** por causa de rede, papel ou reinício.
Cada decisão neste ficheiro que parecer "trabalho a mais" existe para não gerar um telefonema às 20h de sábado.

---

## 1. AS QUATRO REGRAS QUE MANDAM EM TUDO

1. **A venda nunca pára.** Impressora, email, pixel, CAPI, realtime e internet são **best-effort**. Nada disso
   pode impedir registar uma venda. Se a rede cair, o POS vende **offline** e sincroniza depois (§7.5).
2. **O preço é do servidor.** O cliente e o POS enviam **ids + quantidades + `client_sale_id`**. O servidor
   recalcula **sempre** a partir da BD. Dinheiro em **centavos inteiros**. Nunca float.
3. **Cada linha pertence a uma loja.** Toda a tabela operacional tem `store_id` e RLS que a faz cumprir.
   Um utilizador da Matola **não consegue** ler nem escrever nada de Maputo. Testado, não assumido (§11.4).
4. **Repetir uma operação não a duplica.** Todo o caminho que cria dinheiro ou papel é **idempotente**:
   `client_sale_id` no POS, `idempotency_key` no webhook, `(order_id, station, kind)` no `print_jobs`.

---

## 2. TOPOLOGIA

| Ambiente | Onde | Branch | Supabase |
|---|---|---|---|
| **LIVE** | `hawsmash.com` | `main` | projecto `hawsmash2` (**Pro** — PITR + backups) |
| **STAGING** | `*-staging.up.railway.app` | `dev` | projecto `hawsmash2-staging` (Free) |
| **POS / bridge** | mini-PC em cada loja | — | fala com o LIVE + LAN local |

### Regra de ouro
```
dev → testar staging → merge main → live
NUNCA editar main directamente. NUNCA correr SQL à mão em produção — só migrations versionadas.
```

> **Diferença deliberada face ao HAWSMASH 1.0:** o 1.0 partilhava um único projecto Supabase entre staging e
> live — qualquer migration ia a produção no instante. **No 2.0 isso acaba.** Staging tem BD própria; migrations
> correm primeiro lá. É a condição para poder mexer no sistema com duas lojas a vender.

---

## 3. STACK (decisões fechadas — mudar só com ADR em `docs/decisions/`)

| Camada | Tecnologia |
|---|---|
| Frontend | Next.js 14 (App Router) + TypeScript |
| UI | Tailwind + shadcn/ui; tema do HAWSMASH (escuro + dourado `--gold #e5a93c`) em `config/brand.ts` |
| Estado | TanStack Query (retry/reconexão) · POS com cache local (IndexedDB) |
| Backend | Supabase (Postgres + RLS + Realtime + Auth + Storage) |
| Validação | Zod em toda a boundary |
| Pagamentos | **Paysuite** (M-Pesa/e-Mola automático, já validado em produção no motor) + **manual por comprovativo** (fallback) + **balcão** (dinheiro/cartão/móvel) |
| Email | Resend (route handlers) |
| Impressão | `services/print-bridge` (Node, ESC/POS TCP 9100) — um por loja, 24/7, com **HTTP local na LAN** |
| Monorepo | pnpm workspaces + Turborepo |
| Testes | Vitest (domínio/RLS) + Playwright (e2e do POS e do checkout) |
| Hosting | Railway (web) + Supabase Cloud + mini-PC por loja |

**Regra:** o cliente final (quem come) usa **sempre** o browser. Zero instalação. O **POS** é uma **PWA** —
instala-se no PC touch como aplicação, mas continua a ser web.

---

## 4. ESTRUTURA DO REPOSITÓRIO

```
/apps/web
  /app/(public)/            loja: escolha de loja, cardápio, checkout, order-status
  /app/(admin)/             painel: pedidos, caixa, estoque, cardapio, clientes,
                            analise, equipa, lojas, definicoes, marketing, sistema
  /app/(pos)/pos/           POS de balcão (PWA, touch, offline-capable)
  /app/(tv)/tv/[store]/     ecrãs de TV: menu board · senhas · (F2) KDS
  /app/api/                 webhooks, emails, health, track, cron
/config/brand.ts            identidade (fábrica) — o que é runtime vive em stores/settings
/packages/core              money, order-machine, schemas (Zod) — domínio puro, testado
/packages/db                migrations SQL + seed + tipos + testes de RLS
/packages/paysuite          provider Paysuite + mock
/services/print-bridge      poll print_jobs + servidor HTTP local + ESC/POS + gaveta
/docs/engine/               spec completa do motor herdado (Delivery OS) — consulta
/docs/legacy/               HAWSMASH 1.0 (CLAUDE, roadmap, edge functions, print-bridge, proposta)
/docs/HARDWARE.md           equipamento, ligações, rede, contingência
/docs/RUNBOOK.md            operação: monitorização, alertas, backups, incidentes
/docs/decisions/            ADRs
ROADMAP.md · AGENTS.md
```

> `docs/engine/DELIVERY-OS-CLAUDE.md` descreve o motor herdado (§16 tracking, §17 referral, §20 CRM,
> §21 emails, §24 entregadores, §26 aparência…). **Continua a valer** onde este ficheiro não o contradiz.
> Onde colidir, **manda este ficheiro** — é a instância.

---

## 5. MULTI-UNIDADE — o coração do 2.0

**Princípio:** uma instância = uma **empresa** = uma BD. Dentro dela, **N lojas físicas**.
`store_id` **não é** `tenant_id`: não há planos, não há gating, não há clientes diferentes na mesma BD.
É a unidade física onde a venda acontece, onde o papel sai e onde o dinheiro é contado.

### 5.1 Schema base (migration `1001_stores.sql`)

```sql
create table stores (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,                    -- 'maputo' | 'matola'
  name text not null,                           -- 'HAWSMASH Maputo'
  short_name text not null,                     -- 'Maputo'  (talão, TV, seletor)
  order_prefix text not null unique,            -- 'MPT' | 'MTL'  → MPT-0042
  active boolean not null default true,
  accepting_orders boolean not null default true,   -- kill switch por loja
  -- morada / contacto
  address text, maps_url text, phone text, owner_email text,
  -- canais
  delivery_enabled boolean not null default true,
  pickup_enabled   boolean not null default true,
  counter_enabled  boolean not null default true,
  -- pagamento por loja
  mpesa_number text, mpesa_name text, emola_number text, emola_name text,
  payment_provider text not null default 'manual'
    check (payment_provider in ('manual','mock','paysuite')),
  paysuite_api_key text, paysuite_webhook_secret text,   -- (B) segredo: nunca em RPC anon
  -- talão
  receipt_header text, receipt_footer text,
  sort int not null default 0,
  created_at timestamptz not null default now()
);

create table store_hours (               -- horário por loja (substitui o schedule singleton do 1.0)
  store_id uuid not null references stores(id) on delete cascade,
  dow smallint not null check (dow between 0 and 6),
  opens time not null, closes time not null,
  active boolean not null default true,
  primary key (store_id, dow)
);
```

**`settings` (singleton) continua a existir** e passa a ser **só o que é da empresa**: tracking, chaves de email,
templates, aparência da loja, políticas globais. Tudo o que é **operacional da unidade** (horário, números de
pagamento, morada, zonas, taxas, provider) vive em `stores`. **Nunca duplicar o mesmo campo nos dois sítios.**

### 5.2 Tabelas com `store_id not null`
`orders` · `order_items` (herda por join, mas grava `store_id` para RLS directa) · `payments` · `print_jobs` ·
`delivery_zones` · `store_hours` · `store_items` · `stock_movements` · `cash_sessions` · `cash_movements` ·
`devices` · `staff_stores` · `analytics_events` (nullable: tráfego antes da escolha de loja) · `order_counters`.

### 5.3 Cardápio partilhado, disponibilidade por loja
```sql
-- catálogo (global, uma marca, um cardápio):
menu_categories · menu_items                       -- já existem no motor

-- realidade de cada loja:
create table store_items (
  store_id uuid not null references stores(id) on delete cascade,
  menu_item_id uuid not null references menu_items(id) on delete cascade,
  available boolean not null default true,
  price_cents_override int null check (price_cents_override >= 0),  -- null = preço do catálogo
  track_stock boolean not null default false,
  stock_qty int not null default 0 check (stock_qty >= 0),
  low_stock_qty int not null default 0,
  primary key (store_id, menu_item_id)
);
```
- **Preenchimento determinístico:** trigger `after insert on menu_items` cria a linha para **todas** as lojas
  activas; trigger `after insert on stores` cria a linha para **todos** os itens. Nunca "linha em falta = talvez".
- `get_menu(p_store_slug)` devolve **preço efectivo** (`coalesce(override, price_cents)`) e **disponibilidade
  efectiva** (`available and (not track_stock or stock_qty > 0)`).
- Preço diferente entre lojas é suportado **desde o dia 1** (a política de preços entre unidades é decisão do
  cliente — ver §16 Perguntas em aberto).

### 5.4 Numeração de pedidos
```sql
create table order_counters (store_id uuid, day date, seq int, primary key (store_id, day));
```
- `orders.order_number text` = `MPT-0042` (contínuo por loja, para histórico/email/pesquisa).
- `orders.daily_number int` = **número do dia por loja** (1, 2, 3…) — é este que sai grande no talão, na TV de
  senhas e na chamada ao balcão. Reinicia todo o dia, por loja. Gerado no servidor, dentro da transação.

### 5.5 Onde a loja é escolhida
| Contexto | Como |
|---|---|
| **Site (cliente)** | Página de entrada com **escolha de loja** (Maputo / Matola) → cookie `hs_store` + `/l/[slug]`. Zonas, horários, números de pagamento e disponibilidade passam todos a ser dessa loja. Trocar de loja **limpa o carrinho** (preços e stock são de outra unidade). |
| **POS** | O **dispositivo** está amarrado a uma loja (`devices.store_id`). O operador não escolhe — não pode enganar-se. |
| **Painel** | Selector no topo: `Maputo · Matola · Todas`. "Todas" é **só leitura consolidada**; qualquer acção (aprovar, imprimir, fechar caixa) exige loja concreta. |
| **print-bridge** | `.env` com `STORE_ID` — só puxa `print_jobs` da sua loja. |

### 5.6 Gestão das lojas pelo painel (aba **Lojas**)

Uma loja não é código: é uma linha em `stores` com o seu horário, zonas e números. Quem abre, fecha,
muda uma taxa ou corrige o rodapé do talão é o **painel**, nunca uma migration à mão.

| Quem | Pode |
|---|---|
| `owner` | criar loja, editar tudo (morada, contactos, números de pagamento, rodapé, canais, horário, zonas) |
| `manager` | **só** o kill switch da sua loja (`accepting_orders`), com motivo — é decisão de operação, não de configuração |
| `cashier` / `kitchen` | nada |

**Regras que não se negoceiam aqui:**

- **O kill switch real é `stores.accepting_orders`.** `settings.accepting_orders` é herança do motor
  single-store e **não fecha loja nenhuma** — a aba Definições não deve fingir que fecha.
- **`slug` e `order_prefix` são imutáveis depois de criados.** Mudá-los partiria o histórico de pedidos
  (`MPT-0042`), os cookies dos clientes e o `.env` do print-bridge daquela loja.
- **Criar uma loja é criar operação, não só uma linha:** a nova loja nasce com `store_items` para todo o
  cardápio (trigger da 1003) mas **sem horário, sem zonas e sem números de pagamento** — até isso estar
  preenchido a loja não deve aceitar pedidos. A aba mostra o que falta antes de a deixar abrir.
- **Segredos nunca chegam ao browser:** `stores.paysuite_api_key` e `paysuite_webhook_secret` não são
  legíveis pelo cliente autenticado (grant por coluna) e nunca voltam numa RPC de leitura.
- Toda a alteração grava `event_log` com autor e loja: `store.created`, `store.updated`,
  `store.hours_changed`, `store.zone_saved`, `store.accepting_orders_changed`.

> **Âmbito:** editar as lojas existentes é operação normal do contrato. A criação de uma **3.ª loja** continua
> fora do âmbito comercial fechado (§0) — o painel suporta-a, mas abrir uma unidade nova implica hardware,
> formação e suporte que se orçamentam à parte.

---

## 6. EQUIPA, PERFIS E AUDITORIA

```sql
create table staff_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role text not null check (role in ('owner','manager','cashier','kitchen')),
  pin_hash text null,                    -- PIN de 4-6 dígitos p/ acções sensíveis no POS
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table staff_stores (
  user_id uuid not null references auth.users(id) on delete cascade,
  store_id uuid not null references stores(id) on delete cascade,
  primary key (user_id, store_id)
);
```

| Perfil | Vê | Pode |
|---|---|---|
| `owner` | **todas** as lojas | tudo, incluindo definições, preços, equipa, anulações, consolidado |
| `manager` | as suas lojas | operação completa da loja: aprovar, anular, abrir/fechar caixa, sangria, estoque, cardápio |
| `cashier` | a sua loja | vender no POS, imprimir, receber, abrir gaveta **em venda**, abrir/fechar a sua caixa |
| `kitchen` | a sua loja | ver pedidos e avançar estado (em preparo → pronto). Não vê dinheiro |

### Helpers de RLS (SECURITY DEFINER, `search_path = ''`, `stable`)
`auth_role()` · `auth_is_owner()` · `auth_can_store(p_store uuid)` — **toda** a policy usa `auth_can_store(store_id)`.
Nunca `using (true)`. O `staff_all` do motor herdado é **substituído** loja a loja na migration de multi-unidade.

### Auditoria (`event_log`, append-only, com actor)
Grava **sempre**, com `actor_user_id` + `store_id`: aprovação/recusa de pedido, anulação de venda, abertura de
gaveta fora de venda, sangria/reforço, abertura/fecho de caixa com diferença, alteração de preço, alteração de
stock à mão, remoção de acesso. É isto que responde à pergunta "quem fez isto?" — e é a resposta contratual da
proposta (§6 "Registo de auditoria").

---

## 7. POS DE BALCÃO — o módulo novo

> Ecrã touch no balcão de cada loja. **Vender em menos de 15 segundos**, com a mão, sem teclado.

### 7.1 Fluxo
1. Operador entra (Supabase Auth; sessão longa no dispositivo) → o dispositivo já sabe a loja.
2. Grelha de categorias → produtos (alvos grandes, foto opcional, esgotado a cinzento e **não clicável**).
3. Carrinho lateral: quantidade ±, nota por item, remover, **descontos só com perfil ≥ manager**.
4. Tipo: **Balcão (comer/levar)** · **Delivery no balcão** (pede nome/telefone/zona) · **Levantamento**.
5. Pagamento: **Dinheiro** (teclado numérico → troco em ecrã grande) · **M-Pesa** · **e-Mola** · **Cartão**.
   Pagamento misto (dinheiro + móvel) é suportado no schema (`payments` N linhas por pedido).
6. **Finalizar** → grava, **imprime talão do cliente + comanda da cozinha**, **abre a gaveta** (se dinheiro),
   mostra ecrã de confirmação com o **número do dia** e volta ao início em 3 s.

### 7.2 Servidor: `create_counter_sale(p_payload jsonb)`
Uma RPC transacional que faz tudo ou não faz nada:
- valida loja, dispositivo, sessão de caixa aberta (abre automaticamente se não houver — padrão herdado);
- **recalcula preços** a partir de `store_items`/`menu_items`;
- **desconta stock atomicamente** (`update … where stock_qty >= qty`; 0 linhas → `out_of_stock:<id>` → rollback);
- cria `orders` (`channel='counter'`, `status='paid'`, `paid_at`), `order_items`, `payments`, `daily_number`;
- cria `print_jobs`: `kind='receipt'` (cliente) + `kind='order'` por estação (cozinha);
- se pagamento em dinheiro → abre a gaveta (`kind='drawer'` ou flag no receipt);
- grava `event_log` com o operador.
- **Idempotente:** `orders.client_sale_id uuid unique`. Repetir a chamada devolve **o mesmo pedido** — nunca
  cobra duas vezes. É isto que torna seguro o retry automático e a sincronização offline.

### 7.3 Dinheiro e troco
`orders.cash_received_cents` e `orders.change_cents` são gravados. Sem isto o fecho de caixa não fecha e a
conciliação vira discussão. O troco é **calculado no cliente para mostrar** e **recalculado no servidor** para gravar.

### 7.4 Anulação e devolução
`void_sale(p_order_id, p_reason)` — exige `manager`/`owner` (ou PIN de manager no POS), repõe stock, marca
`cancelled`, mantém a linha no histórico e loga em `event_log`. **Venda anulada nunca desaparece.**
Reimpressão de talão: `reprint(p_order_id, p_kind)` — cria novo `print_jobs` e loga (para não virar via de fraude).

### 7.5 Modo offline (o que evita a dor de cabeça)
O POS é uma **PWA** com service worker:
- **Cache de menu** (`store_items` + preços) refrescada a cada 2 min e à entrada. É a **única** fonte de preço
  offline — o operador nunca escreve um preço.
- **Sem ligação:** a venda entra numa fila **IndexedDB** com `client_sale_id`, imprime **na hora** via
  **HTTP local do print-bridge** (LAN, não depende da internet) e abre a gaveta.
- **Ao voltar a ligação:** a fila é enviada para `create_counter_sale`. Idempotência garante zero duplicados.
  Se o preço na BD tiver mudado entretanto, o servidor grava o **preço do servidor** e marca o pedido em
  `needs_review` → aparece numa lista **"Conciliação"** no painel. Nunca falha em silêncio.
- **Banner permanente** no POS: `SEM LIGAÇÃO · 3 vendas por sincronizar`. E confirmação verde ao sincronizar.
- **Limites honestos:** offline o POS não consulta stock real nem cria pedidos de delivery online. Vende balcão.
  É esse o compromisso — e está escrito no manual da equipa.

### 7.6 Ecrã
- Fullscreen/kiosk, alvos ≥ 64 px, contraste alto, **sem hover** (é touch), teclado numérico próprio.
- Atalho físico opcional: tecla `F9` = abrir gaveta (com permissão), `F2` = repetir último talão.
- **Nunca** um `confirm()` do browser em fluxo de venda — diálogos próprios, grandes.

---

## 8. IMPRESSÃO E GAVETA

### 8.1 `print_jobs` (motor herdado, estendido)
```sql
print_jobs (id, store_id, order_id null, station text, kind text, reprint_seq int default 0,
            payload jsonb, status text, attempts int, created_at, printed_at,
            unique (order_id, station, kind, reprint_seq))
-- kind: 'order' (comanda cozinha) | 'receipt' (talão cliente) | 'drawer' | 'cash_close' | 'test'
-- station: 'kitchen' | 'counter' | 'bar' (herdado; HAWSMASH usa kitchen + counter)
```

### 8.2 print-bridge (um por loja)
- `.env`: `SUPABASE_URL`, service key **restrita**, `STORE_ID`, `PRINTER_IP_KITCHEN`, `PRINTER_IP_COUNTER`,
  `LOCAL_HTTP_PORT=7777`, `LOCAL_TOKEN`.
- **Poll** (3 s) de `print_jobs` da **sua loja** → ESC/POS → TCP 9100 → `printed`. Retry 3× com backoff →
  `failed` + `event_log` + **alerta**.
- **Servidor HTTP local (novo):** `POST /print`, `POST /drawer`, `GET /health` na LAN, autenticado por
  `LOCAL_TOKEN`. É por aqui que o **POS imprime e abre a gaveta sem internet**.
- **Gaveta:** pulso ESC/POS `ESC p 0 25 250` (`1B 70 00 19 FA`) para a impressora do balcão (a gaveta liga-se à
  impressora por RJ11 — ver [`docs/HARDWARE.md`](docs/HARDWARE.md)). Abrir gaveta **fora de venda** exige perfil
  e fica logado.
- **Watchdog:** arranque automático com o Windows, reinício em caso de crash, `heartbeat` a cada 60 s para
  `devices`. Empacotamento `.exe` (SEA) reaproveitado do HAWSMASH 1.0 (`docs/legacy/hawsmash-print-bridge/`).
- **Simulador** (`pnpm bridge:dev`) para desenvolver sem hardware.

### 8.3 Talão (80 mm · 48 colunas · CP1252)
Dois formatos, ambos com **`short_name` da loja no cabeçalho**:
- **Comanda de cozinha:** número do dia GRANDE, canal (BALCÃO/DELIVERY/LEVANTAMENTO), itens + qty + notas,
  hora, **sem preços**.
- **Talão do cliente:** loja, morada, número do pedido, itens com preço, subtotal, taxa de entrega (se houver),
  **TOTAL a dupla altura**, forma de pagamento, **troco** se dinheiro, rodapé (`stores.receipt_footer`).
Formato de referência: `docs/legacy/HAWSMASH-1.0-CLAUDE.md §12.2` (já validado em papel).

**Regra herdada e inegociável:** falha de impressão **nunca** esconde nem bloqueia o pedido. O painel é o canal
primário; o papel é redundância.

---

## 9. CAIXA (por loja, por turno)

```sql
cash_sessions  (id, store_id, shift_label, opened_by, opened_at, opening_float_cents,
                closed_by, closed_at, counted_cash_cents, expected_cash_cents,
                difference_cents, difference_reason, report jsonb)
cash_movements (id, session_id, store_id, type, amount_cents, reason, created_by, created_at)
                -- type: 'sangria' | 'reforco' | 'despesa' | 'troco_inicial'
```
- **Esperado em caixa** = fundo inicial + vendas em **dinheiro** − sangrias + reforços − despesas.
  Vendas em M-Pesa/e-Mola/cartão entram no relatório **separadas** (não estão na gaveta).
- Fecho: contagem → diferença. Diferença acima de `settings.cash_diff_tolerance_cents` **exige motivo**.
  Imprime o fecho, gera PDF e envia email ao dono (herdado do 1.0 `send-caixa` e do motor `close_cash_session`).
- **Conta desde o último fecho** — nunca "desde a meia-noite UTC" (bug real corrigido no motor; não repetir).
- Consolidado das duas lojas num ecrã, com a decomposição por loja, por turno e por forma de pagamento.

---

## 10. ESTOQUE (por loja)

- `store_items.track_stock/stock_qty/low_stock_qty` (§5.3). Baixa **na mesma transação** que confirma a venda
  (`create_counter_sale`, `confirm_payment`, `advance_order APPROVE`).
- `stock_movements (id, store_id, menu_item_id, delta, reason, order_id null, created_by, created_at)` —
  `reason ∈ ('sale','void','manual','waste','receive','count')`. **Todo** o movimento fica registado; é o que
  permite explicar um desvio em vez de o adivinhar.
- Chega a 0 → o item deixa de estar disponível **naquela loja** (site e POS), automaticamente.
- `low_stock_qty` atingido → alerta (§11.5) e destaque no painel.
- Reposição e contagem no painel (aba **Estoque**), sempre com motivo, sempre logadas.

---

## 11. ROBUSTEZ — o programa completo

> Esta secção existe porque o sistema passa a ser o coração de duas lojas. Cada item é **verificável**.

### 11.1 Nunca perder uma venda
Ordem de degradação, do melhor para o pior — e o POS desce sozinho:
`online + impressora` → `online, impressora em baixo` (venda grava, talão fica em fila, avisa) →
`offline, impressora na LAN` (venda em IndexedDB, papel sai) → `offline, sem impressora`
(venda em IndexedDB, ecrã mostra o número e o total; procedimento em papel treinado).

### 11.2 Idempotência (lista fechada)
`orders.client_sale_id unique` · `payments.idempotency_key unique` · `print_jobs unique(order_id,station,kind,reprint_seq)` ·
webhook Paysuite com HMAC + `on conflict do nothing` · `create_order` com rate-limit por telefone (6/hora, herdado do 1.0).

### 11.3 Realtime que não mente
Lição do HAWSMASH 1.0 (corrida real em produção): **o evento de realtime nunca constrói estado** — só dispara
`refetch()` da fonte. Se o realtime cair, um **polling de 15 s** assume. Pedido sem itens no ecrã é bug de
arquitectura, não azar.

### 11.4 Testes que travam o deploy
- `packages/core`: money, order-machine, schemas (herdado, já verde).
- `packages/db/tests/rls.test.ts`: **isolamento entre lojas** — utilizador da Matola a tentar ler/escrever
  Maputo tem de falhar. **Gate de CI.**
- POS: teste de idempotência (mesma `client_sale_id` 2× → 1 pedido), troco, stock esgotado, anulação.
- Playwright: venda de balcão ponta a ponta com impressora simulada; checkout online ponta a ponta.
- `pnpm lint && pnpm test` verdes é **condição de merge**. Sem excepções.

### 11.5 Monitorização e alertas (é isto que substitui o telefonema)
- `devices (id, store_id, kind, label, app_version, last_seen_at)` — `kind ∈ ('pos','bridge','kds','tv')`,
  heartbeat 60 s.
- Painel **Sistema**: semáforo por loja — POS, impressora, bridge, internet, último pedido, fila de impressão.
- **Alertas automáticos** (email + WhatsApp deep link) quando: dispositivo silencioso > 5 min em horário de loja ·
  `print_jobs` falhado 3× · pedido pago sem comanda impressa > 2 min · loja sem nenhuma venda há > 90 min em
  horário de pico · erro 5xx repetido · stock crítico.
- **Digest diário** ao dono: vendas por loja, fecho de caixa, incidentes.

### 11.6 Dados: backups e restauro
- Supabase **Pro** com PITR no projecto de produção.
- `pg_dump` nocturno para armazenamento externo (retenção 30 dias) via cron.
- **Teste de restauro mensal**, com data e resultado registados em `docs/RUNBOOK.md`. Backup não testado não é backup.
- Exportação de dados (CSV) disponível ao cliente a qualquer momento — é compromisso da proposta.

### 11.7 Disciplina de mudança
Migrations **forward-only** e idempotentes, uma por assunto, nomeadas `1NNN_assunto.sql`. Nada de SQL manual em
produção. Alteração que toque em dinheiro, RLS ou estado de pedido exige teste **antes** do código (ver `AGENTS.md`).

### 11.8 Fuso horário
Tudo gravado em **UTC**; apresentado em **Africa/Maputo**. Horários de loja e relatórios calculados no fuso da
loja. (O 1.0 teve um bug real de caixa por causa disto — não repetir.)

### 11.9 Degradação de pagamento
Se o Paysuite falhar (API em baixo, chave inválida), o checkout **não morre**: cai automaticamente no fluxo
**manual por comprovativo** (herdado do 1.0) e avisa o painel. Uma loja nunca deixa de receber encomendas por
causa do gateway.

---

## 12. PEDIDO — canais e máquina de estados

`orders.channel ∈ ('delivery','pickup','counter','dine_in')` — `counter` é o POS. `dine_in` fica preparado
(o motor já o tem) mas **não entra na Fase 1**.

```
Online manual:   draft → awaiting_approval → approved → in_preparation → ready → delivered
Online digital:  draft → awaiting_payment  → paid     → in_preparation → ready → delivered
Balcão (POS):    (nasce) paid → ready → delivered          -- pago no acto
Qualquer não-terminal → cancelled (com motivo, logado)
```
- Transições **só** por `advance_order(p_order_id, p_event, p_reason)`. Update directo de `status` = proibido por RLS.
- Cozinha/impressora só vêem o pedido em `paid`/`approved`.

---

## 13. SITE PÚBLICO (o canal que já factura)

- **Página de entrada com escolha de loja** (compromisso da proposta) → `/l/maputo`, `/l/matola`.
- Cardápio, carrinho, checkout com **zonas e taxas da loja escolhida**, agendamento pelos **horários dessa loja**.
- Pagamento: Paysuite (automático) ou manual por comprovativo, conforme `stores.payment_provider`.
- `order-status` com estado ao vivo; `purchase` de tracking **só** quando `paid`/`approved` (§16 do motor).
- Tracking por loja: os eventos levam `store` como dimensão, para medir campanhas por unidade.

---

## 14. TVs

| Ecrã | Rota | Fase |
|---|---|---|
| **Menu board** (cardápio na parede, preços e esgotados ao vivo) | `/tv/[store]/menu` | **1** |
| **Senhas** (número do dia chamado quando fica `ready`) | `/tv/[store]/senhas` | **1** (barato, grande impacto no balcão) |
| **KDS** (ecrã de cozinha com colunas e temporizador) | `/kds/[store]` | **2** |

Regras: sem interacção, auto-refresh resiliente (reconecta sozinho), fullscreen, legível a 4 m, e **funciona
mesmo que o backend esteja lento** (mostra o último estado conhecido em vez de ecrã em branco).

---

## 15. MIGRAÇÃO DO HAWSMASH 1.0

O 1.0 continua a vender **até ao dia do cutover**. Nada pára.
1. `scripts/import-hawsmash-1.ts` — lê o Supabase antigo (`tsrgileifpiaiicwjfar`) e importa para o novo:
   `products`/`product_categories` → `menu_items`/`menu_categories` (+ `store_items` nas duas lojas);
   `orders`/`order_items` → `orders` com `store_id = maputo`, preservando `order_number` e `created_at`;
   `order_feedback`, `waitlist`, `caixa_fechamentos` (histórico), telefones → `customers` agregados.
2. **Dry-run obrigatório** com relatório de contagens antes de escrever.
3. Cutover: domínio aponta para o 2.0; o 1.0 fica **read-only** e arquivado (não apagar durante 90 dias).
4. Preços de referência do 1.0 (Classic 300/400, Double 400/500, Brisket 450/500, Signature 600, Nata 90/500,
   Chips 150, entrega 150 MT) entram como **seed inicial** — a partir daí o preço vive na BD, por loja.

---

## 16. PERGUNTAS EM ABERTO (decidir com o cliente antes da fase respectiva)

> **Registo vivo:** esta tabela é o retrato inicial. O que está por responder — e o que o agente fez para
> não parar à espera da resposta — vive em **[`BLOQUEIOS.md`](BLOQUEIOS.md)**, com um ID por assunto
> (`B-001`…) e o marcador correspondente no código. É essa a lista que se ataca de uma vez só.

| # | Pergunta | Bloqueia |
|---|---|---|
| 1 | **Um Paysuite para as duas lojas ou um por loja?** (onde cai o dinheiro de cada unidade) | F6 pagamentos |
| 2 | ✅ **Decidido:** preços iguais nas duas lojas | — |
| 3 | ✅ **Decidido:** ambas usam M-Pesa 847955382 (Soeil Nissar) e e-Mola 870909080 (Mehzabin Ibrahim) | — |
| 4 | Zonas e taxas de entrega da **Matola** | F6 |
| 5 | ✅ **Decidido:** Qui–Sáb; Maputo 11:00–21:30 e Matola 12:00–21:30 | — |
| 6 | Terminal de cartão: é do banco (só registamos a forma de pagamento) — confirmar | F2 POS |
| 7 | Quantas contas de equipa por loja e quem é `manager` | F7 |
| 8 | Talão do cliente: que rodapé/NUIT aparece (sem certificação fiscal) | F3 |

---

## 17. NÃO FAZER

- ❌ Policy `using (true)` em tabela com `store_id` — isolamento de loja é a regra 3.
- ❌ Confiar no cliente (browser **ou POS**) para preço, taxa, troco, desconto ou estado de pagamento.
- ❌ Float para dinheiro. Centavos inteiros, sempre, via `packages/core/src/money.ts`.
- ❌ Bloquear a venda por causa de impressora, email, pixel, CAPI ou realtime.
- ❌ Criar venda no POS sem `client_sale_id` — é o que impede cobrar duas vezes.
- ❌ Construir estado a partir do payload do realtime (só `refetch`).
- ❌ SQL manual em produção; migration não versionada; editar `main` sem passar por staging.
- ❌ `anon` com SELECT directo em tabela — acesso público só por RPC `SECURITY DEFINER`.
- ❌ URL pública do bucket `payment-proofs` (é privado) — só `createSignedUrl`.
- ❌ Segredo (service key, Paysuite, CAPI, Resend) em código do cliente.
- ❌ Abrir gaveta sem perfil e sem registo em `event_log`.
- ❌ Apagar venda anulada — anula-se com motivo, nunca se apaga.
- ❌ `tenant_id`, planos comerciais ou gating por plano. `store_id` é unidade física, não inquilino.
- ❌ Avançar fase do ROADMAP com testes vermelhos.
