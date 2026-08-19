# ROADMAP.md — HAWSMASH: Roteiro de Execução em Fases

> **Como usar:** abrir o Claude Code na raiz do repo. Colar o PROMPT da fase atual, exactamente como está.
> Uma fase por sessão. A fase só está concluída quando TODO o checklist de DoD estiver verde.
> Trabalhar sempre em `vite-build` → testar staging → merge `main` (REGRA DE OURO do `CLAUDE.md §1`).

Legenda: 🔴 bloqueia · 🟡 importante · 🟢 melhoria
DoD: `[x]` feito · `[ ]` por fazer

> **Disciplina (colar no início de cada sessão):**
> ```
> Estamos na fase <X.Y> do ROADMAP.md. Lê o CLAUDE.md inteiro + a fase.
> Lista os ficheiros que vais criar/alterar e o plano de teste ANTES de codar.
> Lembra: preço sempre validado no servidor; pós-F1 os produtos vivem na tabela `products` (não hardcoded);
> pixels/gtag só em src/lib/track.js; purchase só no pedido confirmado.
> No fim: build verde + testar no staging + checklist de DoD.
> ```

> **Estado actual (2026-06-19):** plataforma em produção (live `hawsmash.com`, staging `vite-build`).
> Próximas 3 entregas: **F1 Produtos pelo admin · F2 Tracking · F3 Impressora**. Independentes — podem ir por qualquer ordem.

---

## FASE 1 — Gestão de Produtos pelo admin (sem hardcode) 🍔

🎯 Objectivo: o dono adiciona/edita **todos** os produtos (incl. **bebidas**) na **aba Produtos** do admin — sem
código nem deploy. Os produtos saem do hardcode (`MENU` em `app.jsx` + `PRICES` em `create-order`) e passam para a
tabela `products` no Supabase. O preço continua **100% validado no servidor**. Ler `CLAUDE.md §6, §10`.

> ⚠️ **Toca em DB + Edge Function → vai a produção imediatamente.** Cutover delicado: só funciona depois de a
> tabela `products` estar **seedada** com o menu actual. Testar tudo no staging antes do merge `main`.
>
> **Ordem importa:** F1.1 (DB+seed) → F1.2 (create-order lê DB) → F1.3 (frontend lê get_menu) são o **cutover** e
> devem ir juntas para staging. Só depois F1.4 (admin CRUD) e F1.5 (bebidas pelo painel).

### F1.1 🔴 Tabelas `product_categories` + `products` + RPC `get_menu()` + seed + bucket

**PROMPT:**
> Lê o `CLAUDE.md` (§3, §10.1). Cria a migration com **`product_categories`** (id, name único, slug, sort, active,
> created_at) e **`products`** (name único, `category_id` FK → product_categories, description, ingredients,
> `price_single`/`price_haw`/`price_wagyu`, image_url, available, sort, created_at), ambas com **RLS**
> (`authenticated` faz tudo; anon sem policy). Cria a RPC `get_menu()` (SECURITY DEFINER, `search_path=''`,
> `grant execute to anon`) que devolve as **categorias `active`** com os produtos `available`, ordenadas por
> `product_categories.sort` e `products.sort` — colunas explícitas (nunca `select *`). **Seed:** cria as categorias
> (Burgers, Bebidas, Sobremesas, Extras) e insere o menu actual (Classic/Double/Smoked/Signature com haw/wagyu,
> Nata 1/6, Joe's Chips) apontando para elas, com os preços de §6. Cria o bucket Storage **`product-images`
> (público)** + policies (admin escreve, leitura pública).

**DoD:**
- [x] Migration escrita em `supabase/migrations/001_products.sql`; `product_categories` + `products` com RLS; anon sem policy directa
- [x] `get_menu()` SECURITY DEFINER devolve categorias `active` + produtos `available`, ordenados por sort
- [x] Seed reproduz o menu/preços de hoje (4 categorias + 7 produtos); bucket `product-images` público (criar no dashboard — ver comentário na migration)
- [ ] **Aplicar a migration no Supabase SQL Editor** e criar o bucket `product-images` (público)
- [ ] Commit `feat(db): product_categories + products + get_menu() + seed + bucket`

### F1.2 🔴 `create-order` valida contra o DB (fim do `PRICES` hardcoded) ✅

**DoD:**
- [x] `supabase/functions/create-order/index.ts` reescrito — lê `products` (service key), resolve preço por nome+variante HAW/WAGYU/single
- [x] Produto desconhecido ou `available=false` → rejeita com mensagem PT
- [x] Rate-limit 6/phone/hora mantido
- [ ] **Deploy da Edge Function** (após migration aplicada): `supabase functions deploy create-order --project-ref tsrgileifpiaiicwjfar`

### F1.3 🔴 Frontend lê o menu de `get_menu()` (cutover) ✅

**DoD:**
- [x] `src/app.jsx` — hook `useMenu()` carrega via `supabaseClient.rpc('get_menu')`; componente `Menu()` renderiza por categoria dinâmica
- [x] Burgers → `BurgerBanner`/`SignatureBanner` (HAW/WAGYU); restantes → `GenericBanner` (single)
- [x] Loading state e erro tratados; `category-head` com título dourado para categorias não-burgers
- [x] Build verde (`npm run build`)
- [ ] **Testar no staging** após migration + deploy da Edge Function

### F1.4 🟡 Admin → aba "Produtos" (categorias + produtos) ✅

**DoD:**
- [x] `src/admin.jsx` — aba **🍔 Produtos** com sub-tabs **Produtos** / **Categorias**
- [x] Categorias: criar/editar/eliminar (name, slug auto, sort, active); eliminar bloqueia se há produtos
- [x] Produtos: criar/editar/eliminar (name, categoria dropdown, preços HAW/WAGYU/single, descrição, ingredientes, foto upload para `product-images`, available toggle, sort)
- [x] Alteração reflecte na loja via `get_menu()` sem deploy
- [x] Build verde

### F1.6 🔴 Horário de encomendas configurável pelo admin ✅

**Objectivo:** eliminar o `SLOT_DOWS = [4,5,6]` hardcoded — o dono define no painel quais os dias,
horas de início/fim e quantos dias de antecedência aparecem no checkout.

**DoD:**
- [x] `supabase/migrations/002_store_settings.sql` — tabela `store_settings` (key/value jsonb); anon lê, authenticated escreve; seed com Qui/Sex/Sáb 11:00–21:30, 14 dias
- [x] `checkout.jsx` — carrega schedule do DB no mount; `SCHEDULE_DEFAULT` como fallback; `generateSlots()` aceita strings `"HH:MM"` (suporte a 21:30); `StepSlot` usa schedule dinâmico
- [x] `admin.jsx` — aba **⚙️ Definições** com `SettingsView`: 7 dias com checkbox + hora início/fim + campo antecedência; upsert em `store_settings`; `CalendarView` e `CaixaView` usam schedule do DB
- [x] Build verde
- [ ] **Aplicar `002_store_settings.sql`** no Supabase SQL Editor
- [ ] Ajustar no painel (Definições → Qui/Sex/Sáb, 11:00–21:30) e confirmar que o checkout mostra os slots certos

### F1.5 🟡 Bebidas pelo painel + go-live

**PROMPT:**
> Com a aba Produtos pronta, o **dono** adiciona as bebidas (Coca-Cola, água, sumos, sodas artesanais…) com preços e
> fotos confirmados — **sem código**. Validar o fluxo completo e fazer o go-live para `main`.

**DoD:**
- [x] Bebidas adicionadas pelo painel aparecem na loja e entram no carrinho/checkout
- [x] Pedido com bebida → `create-order` aceita, total correcto, aparece no email + painel
- [ ] Merge `vite-build` → `main`; confirmar em `hawsmash.com`

---

## FASE 2 — Tracking: Pixels + Google Tags nos botões 📈

🎯 Objectivo: medir o funil inteiro com **Meta Pixel + Google (GA4/Ads/GTM)**, com os eventos certos nos botões
(`add_to_cart`, `begin_checkout`, `add_payment_info`, `purchase`), e proteger a atribuição com **Meta CAPI**
server-side. Ler `CLAUDE.md §11` (spec completa) e `Exemplo/CLAUDE.md §16` (referência).

> ⚠️ **A regra crítica:** `purchase` só dispara em `pedido.html` quando o pedido está **confirmado/aprovado** —
> nunca no submit do checkout. Idempotente por `localStorage['hs_purchase_<orderId>']`.

### F2.1 🔴 CSP + config dos IDs (o portão)

**PROMPT:**
> Lê o `CLAUDE.md` (§5, §11.2, §11.3). Cria `public/boot-tracking.js` com os IDs **públicos** vazios
> (`GTM_ID`, `META_PIXEL_ID`, `GA4_ID`, `GADS_ID`, `GADS_LABEL`, `TRACKING_CONSENT_REQUIRED=false`) e referencia-o
> em `index.html`, `checkout.html` e `public/pedido.html`. Alarga a CSP em `public/serve.json` exactamente aos
> domínios de §11.2 (`script-src`/`connect-src`/`img-src`) — **sem** `unsafe-inline`. O token CAPI **não** entra aqui.

**DoD:**
- [ ] `boot-tracking.js` criado (só IDs públicos) e carregado nas 3 páginas
- [ ] CSP alargada só aos domínios de §11.2; sem `unsafe-inline`; build verde
- [ ] Com IDs vazios, nada carrega e o site funciona igual (sem erros de consola)
- [ ] Commit `chore(tracking): boot-tracking.js + CSP para tags`

### F2.2 🟡 Módulo canónico `src/lib/track.js` + eventos do funil

**PROMPT:**
> Lê o `CLAUDE.md` (§11.4, §11.5). Cria `src/lib/track.js` — **único** lugar que toca `dataLayer`/`fbq`/`gtag`.
> Expõe `loadTags()`, `trackViewItem`, `trackAddToCart`, `trackBeginCheckout`, `trackAddPaymentInfo`, `trackLead`
> (e `trackPurchase`, usado na F2.3). `loadTags()` injecta GTM/Pixel/GA4 uma vez (guard por id), lendo os IDs de
> `window.*`. Instrumenta os gatilhos: `view_item` (abrir banner do burger), `add_to_cart` (`onAdd` do `PriceChip`
> em `app.jsx`), `begin_checkout` (mount do `checkout.jsx`), `add_payment_info` (`onMethod` em `checkout.jsx`),
> `lead` (waitlist). **Nenhum** componente chama `fbq`/`gtag` direto. `value` em MT, `currency:'MZN'`, `items[]` por linha.

**DoD:**
- [ ] Eventos disparam nos gatilhos certos (verificar no Pixel Helper / GA DebugView / preview do `dataLayer`)
- [ ] `fbq`/`gtag`/`dataLayer` só aparecem em `src/lib/track.js`
- [ ] `purchase` **não** dispara em lado nenhum ainda (só na F2.3)
- [ ] Commit `feat(tracking): módulo track.js + eventos do funil`

### F2.3 🟡 `purchase` no pedido confirmado (regra crítica + dedup)

**PROMPT:**
> Lê o `CLAUDE.md` (§11.1, §11.5). Em `public/pedido.html` (order-status), dispara `trackPurchase(order)`
> **apenas** quando o pedido está confirmado/aprovado (nunca em `pending`), com guard
> `localStorage['hs_purchase_<orderId>']` para não re-disparar em reload. Push: GA4 (`transaction_id`, `value` MT,
> `currency:'MZN'`, `items[]`) → Google Ads conversion (`send_to`) → `fbq('track','Purchase', …, {eventID:'purchase_<orderId>'})`.

**DoD:**
- [ ] `purchase` só em pedido confirmado/aprovado; nunca no submit do checkout
- [ ] Não re-dispara em reload (localStorage); `value`/`items[]` correctos
- [ ] Commit `feat(tracking): purchase no pedido confirmado com dedup`

### F2.4 🟢 Meta CAPI server-side (anti iOS/adblock)

**PROMPT:**
> Lê o `CLAUDE.md` (§11.6, §3 segredos). Cria a Edge Function `meta-capi` (ou integra em `approve-order`): ao
> confirmar/aprovar o pedido, faz **fire-and-forget** POST à Conversions API com `event_id:'purchase_<orderId>'`
> (mesmo do browser → dedup), `value`/`currency`. Token de `META_CAPI_TOKEN` (Supabase secret). Falha de envio
> **nunca** afecta o pedido (só log). Deploy da função.

**DoD:**
- [ ] CAPI dispara na confirmação com o mesmo `event_id` do browser (Meta deduplica)
- [ ] `META_CAPI_TOKEN` em Supabase secret (nunca no frontend)
- [ ] Falha server-side não altera o estado do pedido
- [ ] Commit `feat(tracking): Meta CAPI server-side`

### F2.5 🟢 Manual do dono

**PROMPT:**
> Cria um guia curto (onde achar cada ID: GTM/Pixel/GA4/Ads + token CAPI) e como colá-los no `boot-tracking.js` /
> Supabase secret.

**DoD:**
- [ ] Guia escrito (ex.: `public/guia-tracking.html` ou `docs/tracking.md`)
- [ ] Commit `docs(tracking): manual de configuração`

---

## FASE 3 — Impressora de Pedidos (cozinha) 🖨️

🎯 Objectivo: imprimir automaticamente o cupom na cozinha quando um pedido é confirmado, com formato térmico
**80 mm**. Ler `CLAUDE.md §12` e `Exemplo/CLAUDE.md §9` (referência).

> **DECISÃO (2026-06-27): opção (a)** — `print-bridge` Node local 24/7. Imprime mesmo sem ninguém no admin
> (o Ridwan aprova pelo link do email/painel e o papel sai sozinho). **Hardware: Xprinter XP-T80Q** (80 mm,
> Ethernet, ESC/POS) → 48 colunas. Implementado em `print-bridge/` (JS puro, fora do build Railway).

### F3.1 ✅ Coluna `printed_at` + payload do cupom

**PROMPT:**
> Lê o `CLAUDE.md` (§12.1). Migration aditiva: `alter table orders add column printed_at timestamptz null;`
> (vai a produção — confirmar). Garante que o pedido tem tudo o que o cupom precisa (cliente, telefone, fulfillment,
> zona/morada, horário, itens com qty, método/estado de pagamento, subtotal/taxa/total). Se faltar, ajusta a query
> de leitura, **não** os preços. Decide com o dono a opção (a)/(b) acima.

**DoD:**
- [x] `orders.printed_at` existe (migration `005_printer.sql` aplicada em prod via MCP, 2026-06-27)
- [x] Backfill: pedidos existentes marcados `printed_at=now()` (não cospe talões antigos no arranque)
- [x] O poll lê `*, order_items(*)` → payload completo do cupom (FK `order_items.order_id→orders.id` confirmada)
- [x] Opção (a) decidida e anotada
- [ ] Commit `feat(printer): coluna printed_at + payload do cupom`

### F3.2 ✅ `print-bridge/` — render ESC/POS + poll

**PROMPT:**
> Lê o `CLAUDE.md` (§12). Cria a pasta `print-bridge/` (Node standalone, **fora** do build Railway): `.env`
> (`SUPABASE_URL`, service key restrita, `PRINTER_IP`), render ESC/POS no formato 58 mm de §12.2 (CP1252), e poll
> de `orders` (3 s) onde confirmado/aprovado **e** `printed_at IS NULL` → TCP `ip:9100` → marca `printed_at`.
> Retry 3× com backoff → log. Falha de impressão **NUNCA** bloqueia/esconde o pedido. Inclui um simulador
> (decodifica CP1252 → consola) para testar sem hardware.

**DoD:**
- [x] Simulador mostra o cupom (80 mm/48 col) — testado via `npm run demo` (entrega + levantamento)
- [x] Taxa de entrega só aparece em pedidos de entrega; TOTAL em destaque (double-size)
- [x] Job re-tentado em falha; pedido nunca desaparece do painel (impressão = redundância)
- [x] `printed_at` é marcado só após impressão com sucesso (não re-imprime)
- [ ] Commit `feat(printer): print-bridge ESC/POS + poll`

### F3.3 🟡 Impressora física + runbook

**PROMPT:**
> Liga a uma impressora térmica real por LAN (`PRINTER_IP:9100`), valida um pedido real, e escreve um runbook curto
> (instalar o bridge no mini-PC, configurar IP, arrancar no boot).

**DoD:**
- [x] Runbook escrito (`print-bridge/README.md`) — inclui setup Xprinter XP-T80Q + autostart Windows
- [ ] Cupom impresso numa impressora física a partir de um pedido confirmado **← passo no restaurante**
- [ ] Commit `docs(printer): runbook de instalação`

---

## Notas transversais

- **Preços:** sempre validados no servidor (`create-order`). O frontend nunca decide preço.
- **Produtos:** pós-F1 vivem na tabela `products`, geridos na **aba Produtos** do admin. Nada hardcoded; loja lê via `get_menu()`.
- **Tags:** só em `src/lib/track.js`; IDs públicos em `boot-tracking.js`; segredos em Supabase.
- **`purchase`** só no pedido confirmado, com dedup.
- **Impressora** é redundância — nunca acopla o pedido ao papel.
- **DB/Edge Function/CSP** mudam → **vão a produção já**: testar no staging primeiro (REGRA DE OURO).
