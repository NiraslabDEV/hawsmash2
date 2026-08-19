# CLAUDE.md — HAWSMASH

Restaurante de smash burgers em Maputo, Moçambique.
Plataforma de encomendas online: menu, checkout, painel admin, Edge Functions Supabase.
Desenvolvido por **Niraslab** (niraslab.dev@gmail.com).

**Visão:** empacotar esta plataforma como produto multi-tenant — vender a outros restaurantes em Moçambique e mercados semelhantes (África, pagamentos móveis M-Pesa/e-Mola).

> **Execução por fases:** o plano de trabalho está em **[`ROADMAP.md`](ROADMAP.md)**. Uma fase por sessão.
> Foco actual (próximas entregas): **F1 — Mais produtos / Bebidas**, **F2 — Tracking (pixels + Google tags nos botões)**, **F3 — Impressora de pedidos**.

---

## 1. TOPOLOGIA DE DEPLOY

| Ambiente | URL | Branch | Railway service |
|---|---|---|---|
| **LIVE** | `hawsmash.com` | `main` | hawsmash-production |
| **STAGING** | `hawsmash-staging-vite.up.railway.app` | `vite-build` | hawsmash-staging-vite |

Railway auto-deploya em cada `git push` (~45s). Não há CI manual.

### REGRA DE OURO
```
vite-build → testar staging → merge main → live
NUNCA editar main directamente.
```

### Supabase — BACKEND PARTILHADO
Projecto `tsrgileifpiaiicwjfar` ("hawsmash") é **único** — staging e live usam o mesmo DB/storage/Edge Functions.
Qualquer mudança de DB, policy, bucket ou Edge Function **vai a produção imediatamente**.

---

## 2. STACK

| Camada | Tecnologia |
|---|---|
| Frontend | React 18 + Vite 5, Multi-Page App (MPA) |
| Deploy | Railway → `npm run build` → `npx serve dist` |
| Backend | Supabase (Postgres + Storage + Edge Functions Deno) |
| Email | SMTP via Edge Functions (segredo `SMTP_PASS`) |
| Pagamentos | M-Pesa (847955382 · Soeil Nissar) + e-Mola (870909080 · Mehzabin Ibrahim) |

### Entrypoints
```
index.html    → src/app.jsx       homepage + menu + carrinho
checkout.html → src/checkout.jsx  checkout, upload comprovativo, M-Pesa/e-Mola
admin.html    → src/admin.jsx     painel admin (Supabase Auth)
public/pedido.html                acompanhamento do pedido pelo cliente (order-status)
```

### CSS — sem inline nos HTML
- `checkout.css` (raiz) — importado por `src/checkout.jsx`
- `public/styles.css` — referenciado por `admin.html`
- **Nunca** adicionar `<style>` inline grande nos HTML — causa race no build Vite

### Config runtime
Os HTML carregam `window.*` via ficheiros externos (não inline — necessário para CSP):
- `public/boot-main.js` — `PRE_LAUNCH`
- `public/boot-checkout.js` — URLs, números, nomes, taxas
- `public/boot-admin.js` — URL + anon key
- `public/boot-tracking.js` — IDs **públicos** de pixel/GA/GTM/Ads (F2 — ver §11). Tokens secretos NÃO entram aqui.

A anon key (`sb_publishable_6FKwR_eCIKN6kngjb04Vbg_p7Couoay`) é **pública e intencional** — protegida por RLS.

---

## 3. SUPABASE — DB, STORAGE, SEGURANÇA

### Tabelas (todas com RLS ✅)
| Tabela | Escrita | Leitura |
|---|---|---|
| `orders` | Edge Function `create-order` (service key) | `authenticated` |
| `order_items` | Edge Function `create-order` (service key) | `authenticated` |
| `order_feedback` | anon INSERT | `authenticated` |
| `waitlist` | anon INSERT | `authenticated` |
| `caixa_fechamentos` | `authenticated` | `authenticated` |
| `product_categories` (F1) | `authenticated` (admin → aba Produtos) | `anon` via RPC `get_menu()` |
| `products` (F1) | `authenticated` (admin → aba Produtos) | `anon` via RPC `get_menu()` |
| `store_settings` (F1.6) | `authenticated` (admin → aba Definições) | `anon` lê directo (horário público) |

### Funções SQL (SECURITY DEFINER, `search_path=''`)
| Função | Quem chama | Acesso |
|---|---|---|
| `get_order_number()` | trigger interno | só `postgres` + `service_role` ✅ |
| `total_burgers_sold()` | homepage (anon) | `anon` intencional — counter público ✅ |
| `set_updated_at()` | trigger | interno ✅ |
| `get_menu()` (F1) | homepage/checkout (anon) | `anon` — só produtos `available`, campos públicos |

### Storage
- Bucket `payment-proofs` — **PRIVADO** (`public=false`)
- Admin acede via `createSignedUrl(path, 3600)` — ver `signProof()` em `src/admin.jsx`
- `send-email` descarrega com service key directamente
- **NUNCA usar URL pública do bucket `payment-proofs` — retorna 400**
- Bucket `product-images` (F1) — **PÚBLICO** (fotos de menu são públicas); admin escreve, leitura pública (URL pública OK aqui)

### Segredos (painel Supabase → Edge Functions → Secrets)
- `SUPABASE_SERVICE_ROLE_KEY` — **NUNCA commitar no código**
- `SMTP_PASS` — password email transacional
- `META_CAPI_TOKEN` — token da Meta Conversions API (F2.4, server-side — **nunca** no frontend)

---

## 4. EDGE FUNCTIONS (8 total — todas versionadas)

Projecto `tsrgileifpiaiicwjfar`. Todas `verify_jwt: false`.
Código em `supabase/functions/*/index.ts`.

| Função | O que faz | Rate-limit |
|---|---|---|
| `create-order` | Cria pedido, recalcula preços no servidor | ✅ 6/phone/hora |
| `send-email` | Emails transacionais (novo pedido, confirmado, pronto) | — |
| `approve-order` | Link aprovar/recusar no email do dono | — |
| `feedback-email` | Pede avaliação ao cliente | — |
| `send-apology` | Email de recuperação (stub 410 — desactivada) | — |
| `weekly-report` | Relatório semanal por email | — |
| `send-caixa` | Fecho de caixa por email | — |
| `review-blast` | Campanha de avaliações | — |

> A fazer (ver ROADMAP): `meta-capi` (F2.4 — dispara `Purchase` server-side ao confirmar/aprovar o pedido).

**Edge Functions não têm staging** — deploy vai directo a produção.

```bash
# Deploy de uma função
supabase functions deploy <nome> --project-ref tsrgileifpiaiicwjfar

# Ver logs
supabase functions logs <nome> --project-ref tsrgileifpiaiicwjfar
```

---

## 5. SEGURANÇA — ESTADO ACTUAL (Jun 2026)

Tudo implementado e em produção:

- ✅ RLS em todas as tabelas
- ✅ Bucket `payment-proofs` privado + signed URLs
- ✅ Rate-limit `create-order` (6/phone/hora)
- ✅ CSP header em `serve.json` (`script-src 'self'`, sem `unsafe-inline`)
- ✅ HSTS, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy
- ✅ Upload validado: só imagem, máx 5MB
- ✅ `get_order_number` restrita a `service_role` + `postgres`
- ✅ Sem secrets hardcoded nas Edge Functions
- ✅ `search_path=''` nas funções SQL

Pendente (baixa prioridade):
- 🟡 Rate-limit em `order_feedback` / `waitlist` INSERT anon (sem Edge Function — seria via RLS ou trigger)

> ⚠️ **F2 (Tracking) toca na CSP.** Carregar GTM/GA4/Meta Pixel exige alargar `script-src`/`connect-src`/`img-src` em `serve.json` a domínios específicos (ver §11.2). Sem isso os scripts são bloqueados. **Nunca** voltar a `unsafe-inline` para "resolver" — usar os domínios certos.

---

## 6. PREÇOS E PRODUTOS

**Regra invariável:** o cliente envia **nomes/ids e quantidades** — o servidor recalcula **sempre**. Nunca confiar em preços do cliente. Valores são **inteiros em MT** (não centavos).

### Fonte de verdade do preço
- **Hoje (a migrar):** mapa `PRICES` hardcoded em `supabase/functions/create-order/index.ts` + `MENU`/`NATA`/`CHIPS` hardcoded em `src/app.jsx` — nome tem de bater exactamente.
- **Alvo (F1 — ver §10 e [`ROADMAP.md`](ROADMAP.md)):** tabela **`products`** no Supabase, gerida no **admin** (aba Produtos). O `create-order` valida preços **contra a tabela**; o menu público vem de `get_menu()`. **Zero produtos hardcoded.**

Preços actuais (até a F1 migrar para o DB):
```
Classic Smash HAW: 300 MT     Classic Smash WAGYU: 400 MT
Double Smash HAW: 400 MT      Double Smash WAGYU: 500 MT
Smoked Brisket HAW: 450 MT    Smoked Brisket WAGYU: 500 MT
Hawsmash Signature: 600 MT
Pastéis de Nata (1): 90 MT    Pastéis de Nata (6): 500 MT
Joe's Chips: 150 MT
Taxa de entrega: 150 MT
```

---

## 7. VISÃO DE PRODUTO — ROADMAP E EMPACOTAMENTO

### Estratégia em duas fases

**Fase 1 — Completar o HAWSMASH** (provar o produto num cliente real)
Construir os módulos abaixo na instância HAWSMASH. Cada módulo é independente, entregue e pago individualmente.

**Fase 2 — Plataforma multi-tenant** (vender a outros restaurantes)
Depois de validado no HAWSMASH, empacotar como SaaS para restaurantes em Moçambique e mercados com M-Pesa/e-Mola.

---

### Foco actual — 3 entregas (detalhe e DoD em [`ROADMAP.md`](ROADMAP.md))

| Fase | Entrega | Onde mexe |
|---|---|---|
| **F1** | 🍔 **Gestão de Produtos pelo admin** (sem hardcode) — bebidas e tudo o resto entram pela **aba Produtos** | tabela `products` + `get_menu()` + `admin.jsx` (aba Produtos) + `create-order` lê do DB — ver §10 |
| **F2** | 📈 **Tracking** — Pixel Meta + Google tags (GA4/Ads/GTM) nos botões | `boot-tracking.js` + `src/lib/track.js` + CSP — ver §11 |
| **F3** | 🖨️ **Impressora** de pedidos (cozinha) | `print-bridge/` (Node local) + coluna `printed_at` — ver §12 |

### Roadmap de produto — Módulos por valor (ref: NL-2026-BLD)

| Prioridade | Módulo | Valor | Estado |
|---|---|---|---|
| ⭐ 1 | 💳 Pagamento Automático M-Pesa + e-Mola | 8.000 MT | A fazer |
| 2 | 📦 Controlo de Estoque | 7.000 MT | A fazer |
| 3 | 🛒 POS · Venda no Balcão | 5.000 MT | A fazer |
| 4 | 📊 Relatórios Financeiros (margem, COGS, IVA) | 4.000 MT | A fazer |
| 5 | 👨‍🍳 Ecrã de Cozinha (KDS) | 4.000 MT | A fazer |
| 6 | ⭐ Programa de Fidelização | 4.000 MT | A fazer |
| 7 | 🍔 Gestão de Menu pelo painel (sem código) → **F1** | 3.500 MT | A fazer |
| 8 | 👥 Gestão de Equipa / turnos / permissões | 3.500 MT | A fazer |
| 9 | 🎟️ Cupões & Promoções | 3.000 MT | A fazer |
| 10 | 🖨️ Impressora de Pedidos (cozinha) → **F3** | 3.000 MT | A fazer |
| + | 📈 Marketing & Tracking (Pixel/GA/Ads) → **F2** | — | A fazer |

**Módulo 1 (Pagamento Automático) é o de maior impacto operacional** — elimina a verificação manual de comprovativos e liberta o atendimento para escalar.

Antes de qualquer módulo: **upgrade Supabase para Pro** (backups automáticos, uptime garantido). Custo de plataforma, não de desenvolvimento.

---

### Fase 2 — Multi-tenant (após validação no HAWSMASH)

Cada restaurante terá: menu próprio, preços, identidade, números M-Pesa/e-Mola, painel admin isolado.

**Abordagem recomendada para MVP:** row-level multi-tenancy (um DB, `tenant_id` em todas as tabelas + RLS estrito). Mais simples que schema-per-tenant ou projecto-por-tenant.

Estrutura base:
```sql
CREATE TABLE tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,           -- 'hawsmash', 'burgerboss'
  name text NOT NULL,
  emola_number text, emola_name text,
  mpesa_number text, mpesa_name text,
  delivery_fee_mt integer DEFAULT 150,
  pickup_address text, pickup_maps_url text,
  pre_launch boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);
```

Adicionar `tenant_id uuid REFERENCES tenants(id)` em todas as tabelas operacionais.

Os valores hardcoded em `boot-checkout.js`/`boot-tracking.js` (números, endereços, taxas, IDs de pixel) passam a vir do DB por tenant.

**Roteamento:**
- MVP simples: path-based (`niraslab.app/hawsmash`, `niraslab.app/burgerboss`)
- Depois: subdomínio wildcard (`hawsmash.niraslab.app`) ou domínio próprio por tenant

---

## 8. WORKFLOW PARA QUALQUER TAREFA

1. **Afecta DB/storage/Edge Functions?** → vai a produção imediatamente — pensar bem
2. Trabalhar em `vite-build`
3. `git push origin vite-build` → deploy staging (~45s)
4. Testar em `hawsmash-staging-vite.up.railway.app`
5. OK → `git checkout main && git merge vite-build && git push origin main`
6. Confirmar em `hawsmash.com`

---

## 9. COMANDOS ÚTEIS

```bash
npm run dev                                          # dev local
npm run build                                        # build (igual ao Railway)
npx serve dist -l 3000                              # servir build local

supabase functions deploy <nome> --project-ref tsrgileifpiaiicwjfar
supabase functions logs <nome> --project-ref tsrgileifpiaiicwjfar
supabase functions download <nome> --project-ref tsrgileifpiaiicwjfar

# F3 — impressora (mini-PC local do restaurante, NÃO no Railway)
cd print-bridge && npm start                         # poll orders → ESC/POS
```

---

## 10. GESTÃO DE PRODUTOS — admin, sem hardcode (F1)

> Objectivo: o dono adiciona/edita produtos (**incluindo bebidas**) na aba **Produtos** do `admin.jsx` — sem tocar em código nem fazer deploy. Os produtos saem do hardcode (`MENU` em `app.jsx` + `PRICES` em `create-order`) e passam para a tabela `products` no Supabase. É o módulo "Gestão de Menu pelo painel" da §7. Referência: `menu_items`/`get_menu()` do Exemplo (`Exemplo/CLAUDE.md §4, §14.2`).

### 10.1 Tabelas `product_categories` + `products` (RLS — leitura pública só via RPC)
**Categorias são geríveis pelo admin** (não um enum fixo) → tabela própria, com FK em `products`.

`product_categories`: `id uuid pk`, `name` (único), `slug`, `sort int`, `active bool default true`, `created_at`.

`products`: `id`, `name` (único), `category_id uuid references product_categories(id)`, `description`, `ingredients` (jsonb/text[]), `price_single int null`, `price_haw int null`, `price_wagyu int null` (burgers usam haw/wagyu; o resto usa `single`), `image_url`, `available bool default true`, `sort int`, `created_at`.
- **RLS:** `authenticated` (staff) faz tudo nas duas tabelas; **anon não lê direto**.
- **Leitura pública:** RPC `get_menu()` (SECURITY DEFINER, `search_path=''`) devolve as **categorias `active`** com os respectivos produtos `available`, ordenadas por `product_categories.sort` e depois `products.sort` — `grant execute to anon` (mesmo padrão de `total_burgers_sold`). Listar colunas explicitamente, nunca `select *` (futuros campos de custo/margem ficam de fora).
- **Seed:** criar as categorias iniciais (Burgers, Bebidas, Sobremesas, Extras) e migrar o menu actual (burgers + Nata + Chips) para `products` apontando para elas — para nada quebrar no cutover.

### 10.2 `create-order` valida contra o DB (não hardcoded)
Deixa de usar o mapa `PRICES` fixo: lê `products` (service key) e resolve o preço por **produto + variante** (HAW/WAGYU/single). Nome/id desconhecido ou `available=false` → rejeita. Preço continua **100% do servidor** (a §6 mantém-se: cliente nunca define preço).

### 10.3 Frontend lê o menu do DB
`app.jsx` deixa de ter o `MENU` hardcoded: chama `get_menu()` e renderiza **por categoria dinâmica** (as que o admin definir — Burgers, Bebidas, Sobremesas, Extras… na ordem do `sort`). Mantém o estilo dos banners; burgers com toggle HAW/WAGYU, restantes com preço único (`single`).

### 10.4 Admin → aba "Produtos" (produtos + categorias)
Nova tab no `admin.jsx`, com duas gestões:
- **Categorias:** criar/renomear/reordenar/activar `product_categories` (name, sort, active).
- **Produtos:** criar/editar/eliminar produto (name, **categoria** via dropdown das categorias existentes, preço(s), descrição, ingredientes, **foto via Storage**, toggle `available`, `sort`).
Reaproveita o estilo das outras tabs; upload para o bucket **`product-images` (público)** — distinto do `payment-proofs` (privado, signed URLs). Eliminar categoria com produtos → bloquear ou reatribuir (não deixar produtos órfãos).

### 10.5 Bebidas = dados, não código
Depois de 10.1–10.4, **bebidas e qualquer produto entram pelo painel** — o dono adiciona Coca-Cola, água, sumos, sodas artesanais, etc. sem deploy. Lista/preços/fotos finais vêm do dono (ver checklist `ROADMAP.md` F1.5).

### 10.6 Horário de encomendas configurável pelo admin (F1.6) ✅

Tabela `store_settings` (key/value jsonb, RLS: anon lê, authenticated escreve). Chave `'schedule'`:
```json
{ "slot_days": [{"dow":4,"start":"11:00","end":"21:30"}, ...], "days_ahead": 14 }
```
- `checkout.jsx` carrega o schedule via `sb.from('store_settings').select('value').eq('key','schedule')` no mount; usa `SCHEDULE_DEFAULT` como fallback enquanto carrega ou em erro.
- `generateSlots()` passou a usar strings `"HH:MM"` (suporte a `21:30`).
- `admin.jsx` — aba **⚙️ Definições** com `SettingsView`: grid de 7 dias (checkbox + hora início + hora fim) + campo de antecedência. Guarda via `upsert` em `store_settings`.
- `CalendarView` e `CaixaView` do admin usam o mesmo schedule para preencher datas futuras sem pedidos.
- Migration: `supabase/migrations/002_store_settings.sql`.

**Regra:** nunca hardcodar `SLOT_DOWS = [4,5,6]` — só ler de `store_settings`.

### Compatibilidade da variante (HAW/WAGYU)
O carrinho/`order_items` hoje usam nomes como `Classic Smash (HAW)`. Manter esse contrato no cutover (menos risco): o `create-order` reconstrói o preço a partir de `products` por nome+variante. Migrar para `product_id + variant` é melhoria futura, não bloqueia a F1.

---

## 11. MARKETING & TRACKING — Pixels + Google Tags (F2)

> Objectivo: medir o funil (entrada → menu → carrinho → checkout → compra) com **Meta Pixel + Google (GA4 / Google Ads / GTM)**, com os eventos certos nos botões, e proteger a atribuição com **Meta CAPI** server-side. Adaptado da spec do template Exemplo (`Exemplo/CLAUDE.md §16`) à arquitectura MPA do HAWSMASH.

### 11.1 A regra crítica (escrever em código antes de tudo)
- **`purchase` NUNCA dispara no submit do checkout.** Dispara **apenas** na página de acompanhamento (`public/pedido.html`) quando o pedido está **confirmado/aprovado** (não em `pending`). Encomenda não confirmada não é venda.
- **Idempotência:** guard persistente `localStorage['hs_purchase_<orderId>']` → não re-dispara em reload.
- `value` em **MT** (inteiro, já é a moeda interna — não há centavos), `currency: 'MZN'`.
- `eventID = 'purchase_<orderId>'` em todos os destinos → deduplicação browser ↔ CAPI server-side.

### 11.2 CSP — o portão (alterar `public/serve.json`)
Sem isto os scripts de tag são **bloqueados**. Alargar (sem `unsafe-inline`):
- `script-src` → `+ https://www.googletagmanager.com https://connect.facebook.net`
- `connect-src` → `+ https://www.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com https://connect.facebook.net https://www.facebook.com`
- `img-src` → `+ https://www.facebook.com https://www.google-analytics.com https://www.googletagmanager.com`

### 11.3 Config dos IDs — `public/boot-tracking.js` (só IDs públicos)
```js
window.GTM_ID        = '';   // 'GTM-XXXXXX'  (opcional — hub)
window.META_PIXEL_ID = '';   // '1234567890'
window.GA4_ID        = '';   // 'G-XXXXXXXXXX'
window.GADS_ID       = '';   // 'AW-123456789'
window.GADS_LABEL    = '';   // 'AbCdEf...'
window.TRACKING_CONSENT_REQUIRED = false; // Moçambique: banner leve, opcional
```
IDs de pixel/GA são **públicos por natureza** — OK no boot. O **token CAPI é segredo** (Supabase secret `META_CAPI_TOKEN`), nunca aqui. Referenciar `boot-tracking.js` em `index.html`, `checkout.html` e `public/pedido.html`.

### 11.4 Módulo canónico — `src/lib/track.js` (único lugar que toca dataLayer/fbq/gtag)
Componentes **nunca** chamam `fbq`/`gtag` direto. Expõe:
`loadTags()` · `trackViewItem(item)` · `trackAddToCart(item)` · `trackBeginCheckout(cart)` · `trackAddPaymentInfo(method)` · `trackPurchase(order)` · `trackLead()`.

### 11.5 Onde cada evento dispara (nos botões)
| Evento | Gatilho (ficheiro) | Condição |
|---|---|---|
| `view_item` | banner do burger abre (`app.jsx`) | sempre |
| `add_to_cart` | botão **Adicionar** / stepper `onAdd` (`PriceChip`, `app.jsx`) | sempre |
| `begin_checkout` | mount do `checkout.jsx` | sempre |
| `add_payment_info` | escolher **M-Pesa/e-Mola** (`onMethod`, `checkout.jsx`) | sempre |
| `purchase` | `public/pedido.html` (order-status) | **só se confirmado/aprovado** (11.1) |
| `lead` | submit da waitlist (`PRE_LAUNCH`) | loja fechada |

### 11.6 Server-side — Meta CAPI (anti iOS/adblock) (F2.4)
Nova Edge Function `meta-capi` (ou dentro de `approve-order`): ao confirmar/aprovar o pedido, POST à Conversions API com `event_id: 'purchase_<orderId>'` (mesmo do browser → Meta deduplica), `value`/`currency`. **Fire-and-forget** — falha de envio **nunca** afeta o pedido. Token de `META_CAPI_TOKEN` (Supabase secret). Google Enhanced Conversions fica para depois.

### 11.7 Consentimento (leve, Moçambique)
Banner PT opcional (cookie `hs_consent`). Se `TRACKING_CONSENT_REQUIRED=true` → tags só carregam após "Aceitar". Por defeito carregam (mercado menos exigente), mas o código respeita a flag.

---

## 12. IMPRESSORA DE PEDIDOS (F3) ✅ implementado (falta teste físico)

> Imprime automaticamente o cupom na cozinha quando um pedido é aprovado. Adaptado de `Exemplo/CLAUDE.md §9`
> (que por sua vez vem do QR MESAS `services/print-bridge/`) à realidade do HAWSMASH (single-tenant, sem `print_jobs`).
> **Decisão (2026-06-27): opção (a) print-bridge 24/7.** Hardware: **Xprinter XP-T80Q** (80 mm, Ethernet, ESC/POS).

### 12.1 Arquitectura — `print-bridge/` (Node/JS puro, local, 24/7)
- Serviço Node **standalone** (JS ESM, sem build) no PC do restaurante — pode ser o mesmo PC da padaria, desde que ligado e na mesma rede da impressora. **NÃO corre no Railway** (separado do site). Arranque: `cd print-bridge && npm install && npm start`. Autostart no boot via `start.bat` (ver `README.md`).
- `.env`: `SUPABASE_SERVICE_ROLE_KEY` (segredo, só neste PC), `PRINTER_IP`, `PRINTER_PORT=9100` (`SUPABASE_URL` tem default).
- Poll de `orders` (3 s) onde `status='paid'` **e** `printed_at IS NULL` **e** `deleted_at IS NULL` → render ESC/POS → TCP `ip:9100` → marca `printed_at`. **Desacoplado de QUEM aprovou** (link do email OU admin) → o papel sai sozinho sem ninguém no painel. Retry 2×/ciclo + o próprio poll é a retentativa longa (auto-recupera); falha de impressão **NUNCA** esconde/bloqueia o pedido (papel = redundância).
- **DB:** migration `005_printer.sql` (aplicada em prod via MCP, 2026-06-27) — `orders.printed_at` + index parcial + backfill dos existentes (não cospe talões antigos no 1.º arranque).
- Ficheiros: `escpos.js` (cupom + decoder), `printer-client.js` (TCP+retry), `polling.js`, `simulator.js`, `index.js`, `config.js`, `demo.js`. Teste sem hardware: `npm run demo`.

### 12.2 Formato do cupom (80 mm = 48 colunas, CP1252) — ref. moçambicano
```
================================================
              HAWSMASH · Maputo
================================================
PEDIDO: HS-0042          19/06/2026  14:25
================================================
CLIENTE: MARIA ALBERTINA      <- bold, destaque
TEL:     +258 84 123 456
================================================
** ENTREGA **   (ou ** LEVANTAMENTO **)
Zona:    Sommerschield
Morada:  Av. Julius Nyerere, 100
HORARIO: 14:30   (ou HORARIO: AGORA)
================================================
Descricao              Qty       Total
------------------------------------------------
Double Smash (HAW)      x2    800.00 MT
Joe's Chips             x1    150.00 MT
================================================
Subtotal:                     950.00 MT
Taxa de entrega:              150.00 MT  <- só se delivery
================================================
TOTAL:                       1100.00 MT  <- double-height
================================================
[ PAGO VIA M-PESA ]   (ou [ PAGAR NA ENTREGA ])
================================================
Obrigado! Bom apetite!
================================================
```
Regras: nome do item truncado; `xN` alinhado; total à direita; taxa de entrega só se `delivery_fee_mt > 0`.

---

## 13. NÃO FAZER

- ❌ `SUPABASE_SERVICE_ROLE_KEY` no código
- ❌ URL pública do bucket `payment-proofs` — é privado, dá 400
- ❌ `window.PRE_LAUNCH = true` sem avisar o dono — bloqueia todas as encomendas
- ❌ Editar `main` sem testar no staging
- ❌ `<style>` inline grande nos HTML — causa race no build Vite
- ❌ Alterar preços no frontend — preço autoritativo é do servidor (`create-order`: hoje `PRICES`, após F1 a tabela `products`)
- ❌ Pós-F1: hardcodar produto em `app.jsx`/`PRICES` — produtos vivem na tabela `products`, geridos pela aba Produtos do admin
- ❌ Pós-F1: dar a `anon` SELECT directo em `products` — leitura pública só via `get_menu()` (sem expor custo/margem)
- ❌ Disparar `purchase` no submit do checkout — só na página de pedido, e só quando confirmado/aprovado
- ❌ Token CAPI (`META_CAPI_TOKEN`) no `boot-tracking.js` ou em qualquer JS do cliente — é segredo Supabase
- ❌ Voltar a `unsafe-inline` na CSP para "fazer o pixel funcionar" — alargar só aos domínios de §11.2
- ❌ `fbq`/`gtag`/`dataLayer` chamados fora de `src/lib/track.js`
- ❌ Acoplar o pedido à impressora — falha de impressão nunca esconde o pedido (papel = redundância)
- ❌ Migrations que adicionem `tenant_id` sem RLS correspondente — expõe dados cruzados
