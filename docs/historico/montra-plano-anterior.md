# Montra — contexto e plano anteriores

**Arquivo histórico, preservado em 26/09/2026.** Os dois textos abaixo são cópias do contexto e plano locais anteriores à redocumentação. As afirmações, decisões datadas, exemplos e marcadores foram preservados; não descrevem por si o código ou a produção actuais e não são instruções para retomar aquelas fases. Números de telefone privados são ocultados antes de arquivar. Não havia ligações Markdown a corrigir nos corpos originais.

Fontes: [CLAUDE local](<../../apps/web/app/(public)/CLAUDE.md>) e [ROADMAP local](<../../apps/web/app/(public)/ROADMAP.md>), agora guias curtos. Referências actuais: [site e checkout](../modulos/site-checkout.md), [Aparência](../modulos/aparencia.md), [conta do cliente](../modulos/conta-cliente.md), [Marketing](../modulos/marketing.md) e [agentes](../modulos/agentes.md). O [ROADMAP da raiz](../../ROADMAP.md) coordena a execução; a [auditoria](../AUDITORIA-DOCUMENTACAO.md) explica as divergências, incluindo conta por telefone/UUID, campanhas e marca em runtime.

Os caminhos de código e as referências a secções nos textos originais conservam o significado histórico. “Concluído”, “seguro” ou “sem PII” no arquivo não são novas validações. Em particular, The Box não descreve a montra activa, o carrinho evoluiu, o backend de conta existe, e as regras actuais de identidade seguem o [ADR 0003](../decisions/0003-conta-do-cliente-por-dispositivo.md).

---

## Documento original 1 — CLAUDE local

# CLAUDE.md — Front-end / Loja do cliente (Storefront "The Box")

> **Âmbito:** este ficheiro governa **apenas a loja do cliente** (`apps/web/app/(public)/`) — a parte
> que quem come usa no browser. O **painel interno** (`apps/web/app/(admin)/`) é outro mundo (tema iFood
> vermelho) e tem o seu próprio contexto; **não misturar**.
>
> A loja segue o design **"The Box"** (protótipo em `/The Box/` na raiz: `THE BOX.dc.html` + assets).
> É **whitelabel**: um design, **padrão para várias empresas**. Trocar de empresa = `config/brand.ts` + assets,
> **nunca** tocar na lógica nem nos componentes. Desenvolvido por **Niraslab**.

---

## 0. HAWSMASH: a loja usa a pele do 1.0, não "The Box"

> **Decisão (2026-08-21, dono do produto):** a loja pública desta instância **não** usa o layout
> "The Box" descrito neste ficheiro. Usa o **front do HAWSMASH 1.0** — o site que os clientes já
> conhecem de `hawsmash.com` — portado para o motor do 2.0 e adaptado às duas lojas.

| | |
|---|---|
| **Onde vive** | `apps/web/app/(public)/_storefront/` (`landing.css`, `storefront.tsx`, `sections.tsx`, `menu-banners.tsx`, `cart-drawer.tsx`, `icons.tsx`) |
| **Quem a usa** | `/` (escolha de loja) · `/l/[slug]` (loja) · `/upsell` (oferta antes do pagamento) · `/checkout` (só a voz: títulos, foco, cantos) |
| **De onde veio** | `Desktop/0001. Clientes/HawSmash` — `styles.css` + `src/app.jsx` do 1.0; fotos em `public/assets/storefront/` |
| **O que continua igual** | `useCart` e a forma de `localStorage['cart']`, `GET /api/menu`, `create_order`, tracking, `formatMT` — **nada da lógica mudou** |

**Regras próprias desta pele:**

- Continua a valer a §4 (whitelabel): o conteúdo editorial vive em `config/brand.ts` →
  `storefront.landing` (hero, marquee, história, rodapé) e as cores em `brand.theme` → `var(--hs-*)`.
  **Nenhum hex nem texto de marca dentro dos componentes.**
- Tudo o que é da pele fica debaixo da classe `.hs` — o painel e o POS têm temas próprios e não podem
  ser tocados por estas regras.
- Os resets (`img`, `a`, `button`) escrevem-se em `:where(.hs)`, para valerem 0 de especificidade.
  Com `.hs button` o reset ganhava às classes dos botões e comia bordas e dourado.
- O **carrinho pertence a uma loja** (`localStorage['cart_store']`, `lib/cart-store.ts`): ao entrar numa
  loja diferente da dona do carrinho, o carrinho é esvaziado — venha-se do diálogo de troca, de um link
  partilhado ou do histórico do browser.
- Os nomes acessíveis são contrato dos testes e2e (`e2e/loja.spec.ts`): `Escolhe a tua loja`,
  `Ver cardápio de <Loja>`, `Adicionar <Item>`, `Trocar de loja`, e o aviso `o teu carrinho é esvaziado`.
  Mudar-lhes o texto é mudar o teste — deliberadamente, nunca por acidente.
- **Upsell** (`/upsell`, entre o carrinho e o pagamento): duas ofertas — subir de gama a uma linha que
  levou a variante barata (HAW → WAGYU) e itens marcados `is_upsell` no painel (bebidas, batatas, natas).
  A decisão de mostrar/saltar é pura e testada (`lib/upsell.ts`); **nunca bloqueia a venda** e não insiste
  com quem já leva bebida. Textos e interruptor em Definições; que itens entram marca-se no Cardápio.
- **Bebidas**: cada bebida é um item com os sabores em `menu_item_variants` e **foto por sabor**
  (`menu_item_variants.photo_url`) — a foto do cartão troca com o sabor escolhido, como no 1.0.
- **"The Box" continua a ser a base whitelabel** para as outras instâncias do motor. O resto deste
  ficheiro descreve-a e mantém-se válido para elas — e para os ecrãs que a pele HAWSMASH ainda não
  cobre (`/m/[token]`, `/order-status`).

---

## ⚡ COMO TRABALHAR NESTE FRONT (regras para o agente)

1. **Uma fase do `(public)/ROADMAP.md` por sessão.** Não antecipar fases.
2. **Antes de codar:** ler este ficheiro + a fase atual no ROADMAP + o `CLAUDE.md` da raiz (regras de dinheiro/RLS/tracking que continuam a valer). Listar ficheiros a criar/alterar.
3. **Reaproveitar o motor, trocar só a pele.** A loja atual já está ligada ao backend — **não reescrever a lógica**, só o visual/estrutura:
   - Carrinho: `apps/web/utils/useCart.ts` (`cart, add, setQty, qtyOf, count, clear` — guarda `{ menuItemId, qty, notes }` em `localStorage['cart']`, que o `/checkout` lê). **Nunca mudar esta forma.**
   - Cardápio: `GET /api/menu` → `{ categories:[{ id, name, items:[{ id, name, description, price_cents, photo_url, available }] }], accepting_orders, zones }`.
   - Dinheiro: `formatMT` de `@delivery/core` (dá `"350 MT"` / `"MT 1.234,56"`). **NUNCA** `Intl … currency:'MZN'` (dá `MTn`).
   - Tracking: `apps/web/lib/analytics/track.ts` (`trackViewMenu`, `trackViewItem`, `trackAddToCart`, `trackBeginCheckout`, `trackPurchase`, `trackLead`).
4. **A marca vive em tokens, não no código.** Nome, cores, gradiente, fonte, hero e assets vêm de `config/brand.ts` → expostos como **CSS vars** no `(public)/layout.tsx`. Componentes leem `var(--st-…)`. **Proibido** hardcodar "THE BOX", `#e8174d`, nomes de ficheiros de imagem ou textos de marca dentro de componentes.
5. **Single-tenant.** Sem `tenant_id`, sem planos. (Igual à raiz.)
6. **Dinheiro só no servidor.** O client envia nomes/quantidades/zona/horário; o `create_order` recalcula tudo. O front mostra **preview**, nunca a verdade do preço.
7. **Mobile-first.** O design é um telemóvel. Layout em coluna, `max-width` ~480px centrado no desktop, fundo escuro à volta. Tudo tocável (alvos ≥ 40px).
8. **Definition of Done de cada fase:** `pnpm lint && pnpm --filter web build` verdes + checklist da fase no ROADMAP marcado + commit convencional (`feat(loja): …`). Verificar com o brand demo (The Box) **e** com um 2º brand (prova de whitelabel).

---

## 1. Visão

Loja de encomendas **mobile-first** ao estilo dos apps de delivery (iFood/Uber Eats), tema escuro premium.
Fluxo: **Home** (hero + cardápio) → **Produto** → **Carrinho** → **Checkout** → **Acompanhamento do pedido**.
O cliente usa **sempre o browser, zero instalação**. UI 100% **português**, moeda **MZN (`MT`)**.

---

## 2. Ecrãs (do design "The Box")

| Ecrã | Rota | Estado |
|---|---|---|
| **Home** | `/menu` (e `/` → redirect) | hero da marca + **carrosséis por categoria** (cards de produto) + bottom-nav |
| **Produto** | página `/menu/[itemId]` (ou overlay) | foto, ♥, nome, badge, ⭐, descrição, **preço dinâmico**, **Tamanho** (escolha única) + **Adicionais/upsell** (multi), qty, adicionar — **preços revalidados no servidor** (F8). **Opcional por item: as secções só aparecem se o dono as adicionar no admin; sem elas, produto "simples".** |
| **Carrinho** | drawer + `/checkout` | itens com qty, morada/zona, resumo (subtotal/entrega/total), finalizar |
| **Acompanhamento** | `/order-status/[orderId]` | **tracker** Recebido → Em preparo → Pronto/A caminho → Entregue (polling) |
| **Loja fechada** | `/menu` quando `!accepting_orders` | `WaitlistForm` (já existe) reskinada |
| **Meus Pedidos** | bottom-nav "Pedidos" (F7) | lista de pedidos do telefone (Ativos + Histórico) + "pedir de novo" — **depende de identificação** (§9) |
| **Perfil** | bottom-nav "Perfil" (F7) | nome/telefone, favoritos, "pedir de novo", sair — **depende de identificação** (§9) |

> **Estado:** Home/Produto/Carrinho/Checkout/Acompanhamento ✅ (F1–F5). **Pedidos** e **Perfil** ficam **inertes** (toast "Em breve") até à **F7** (§9), porque exigem identificação do cliente (ainda não no backend). Bottom-nav **nunca** tem links mortos nem ecrãs falsos com dados inventados.

---

## 3. Design system / tokens (The Box)

Fonte de verdade visual: `/The Box/THE BOX.dc.html`. Tokens base:

```
--st-bg:        #0d0d0d     /* fundo da loja */
--st-card:      #1a1a1a     /* cards de produto/resumo */
--st-line:      rgba(255,255,255,0.09)   /* bordas */
--st-primary:   #e8174d     /* vermelho da marca (CTA, ativo, ♥) */
--st-primary-2: #ff5f30     /* laranja (fim do gradiente) */
--st-grad:      linear-gradient(135deg,#e8174d 0%,#ff5f30 100%)  /* botões principais */
--st-star:      #f59e0b     /* estrelas de rating */
--st-text:      #ffffff
--st-muted:     #888        /* secundário */
--st-muted-2:   #bbb        /* descrições */
--font-store:   'Plus Jakarta Sans', sans-serif
```

Raios: cards 14–16px, botões 12–14px, pills 20px+. Cards de produto têm overlay gradiente na foto + ♥ no canto.
Bottom-nav: `#0f0f0f`, ícone+label, ativo a `--st-primary`. Botões principais usam `--st-grad`.

> **Estes valores são defaults do brand demo.** Vêm de `config/brand.ts` (ver §4) — outra empresa muda-os lá.
> **F12 (raiz §26):** o dono pode sobrepor as CORES em runtime via `settings.storefront_theme` (validado por Zod,
> merge no `layout.tsx`, fallback `brand.ts`). Componentes continuam a ler só `var(--st-…)` — nada muda para eles.

### Cartão de seleção — glassmorphism 3D (F9)

Todos os **cartões selecionáveis** (Tamanho, Adicionais, e as opções do checkout — Levantamento/Entrega, Agora/Horário, método de pagamento) usam **um único** estilo glass 3D:
- **Selecionado** → vidro com **tilt 3D** (`rotateX/rotateY` + lift `translateY`), **tint radial** da marca no canto, **label a `--st-primary`** com glow, e **neon no chão** (`--st-grad` desfocado por trás).
- **Não selecionado** → vidro liso, label cinza, valor branco (sem tilt/neon).

Whitelabel: o tint/glow/neon derivam de `--st-primary` / `--st-grad` (via `color-mix`), **nunca** cores fixas (o demo usava `#ff4da6`/`#ef4444` — proibido em componentes).
Implementação: classes `.glass-opt` / `.glass-opt.is-selected` em `globals.css` (o **contentor precisa de `perspective`** para o tilt). **Receita CSS completa na F9 do ROADMAP.** O componente `Opt` (checkout) e os cards de Tamanho/Adicionais (F8) passam a usar estas classes.

---

## 4. Whitelabel — o mecanismo (decisão fechada)

**Problema:** componentes não podem hardcodar marca; e `config/brand.ts` está na raiz do monorepo (fora do alias `@/*` da web).

**Solução canónica:**
1. Os tokens da loja vivem em `config/brand.ts` num bloco `storefront` (cores, gradiente, fonte, hero, assets, nome, tagline).
2. **Um único** ponto de importação: `(public)/layout.tsx` lê o `brand` e **injeta CSS vars** (`--st-*`, `--font-store`) num wrapper + carrega a fonte (`next/font`). **Com a F12 (raiz §26)**, este mesmo ponto faz o merge `{ ...brand.storefront, ...validado(settings.storefront_theme) }` — o override runtime entra aqui e SÓ aqui.
3. Todos os componentes da loja leem `var(--st-…)` (via `style`/Tailwind arbitrário `bg-[var(--st-card)]`). **Zero** hex de marca espalhado.
4. Assets por empresa em `apps/web/public/assets/<brand>/`. O brand demo é **The Box** em `public/assets/thebox/` (`hero.png`, `hero-shake.png`, `00.png`, `img1.png`, `2.png`…`12.png`).
5. Fotos de produto: usar `item.photo_url` do `/api/menu`; **fallback** determinístico para um asset do brand quando não há foto (loja demo fica cheia e usa os assets reais).

**Trocar de empresa = editar `config/brand.ts` + pôr assets em `public/assets/<brand>/`. Nada mais.**

---

## 5. Contrato com o backend (consome, nunca contorna)

A loja **só** fala com o servidor por estes caminhos (RPCs `SECURITY DEFINER`; `anon` nunca faz SELECT direto):

| Caminho | Para quê |
|---|---|
| `GET /api/menu` (`get_menu`) | cardápio + zonas + `accepting_orders` + **`storefront_layout`, `hero_image_url`, `banner_images`** (F10) |
| `useCart` → `localStorage['cart']` | estado do carrinho (lido pelo `/checkout`) |
| `/checkout` → `create_order(p_payload)` | **o servidor recalcula preços e taxa**; payload só traz nomes/qty/zona/horário/cliente |
| `GET` polling `get_order_status(orderId)` | acompanhamento |
| `attach_payment_proof` | comprovativo (fluxo manual) |
| `/api/waitlist` (`join_waitlist`) | loja fechada |
| `/api/feedback` (`submit_feedback`) | avaliação pós-pedido |

Eventos de tracking (ver raiz §16): `view_menu` (Home), `view_item` (Produto), `add_to_cart`, `begin_checkout`, `add_payment_info`, **`purchase` SÓ em `/order-status` quando `paid`/`approved`** (nunca no submit).

---

## 6. O que NUNCA fazer

- ❌ Hardcodar nome/cor/imagem da marca num componente — só via tokens de `brand.ts`.
- ❌ Float para dinheiro; `Intl currency:'MZN'`. Usar centavos + `formatMT`.
- ❌ Confiar no client para preço, taxa de entrega, desconto ou validade de horário.
- ❌ Confiar no client para o preço de **tamanho/adicionais** — o servidor **revalida** a variante + adicionais (pertencem ao item, ativos) e **recalcula** `unit_price = (variante ou base) + Σ adicionais` (F8). Ter variantes é OK **desde que o preço venha sempre da BD**.
- ❌ Disparar `purchase` antes de `paid`/`approved`.
- ❌ Mudar a forma de `localStorage['cart']` (`{ menuItemId, qty, notes }`) — o `/checkout` depende dela.
- ❌ Link morto na bottom-nav (ecrã inexistente). Inerte/"Em breve" até existir.
- ❌ `tenant_id`, planos, ou SELECT direto do `anon`.
- ❌ URL pública do bucket `payment-proofs` (privado → `createSignedUrl`).

---

## 7. Reaproveitar (copiar, não reinventar)

| Já existe | Onde |
|---|---|
| Carrinho | `apps/web/utils/useCart.ts` |
| Dinheiro | `@delivery/core` (`formatMT`, `Cents`) |
| Tracking | `apps/web/lib/analytics/track.ts` |
| Loja fechada | `WaitlistForm` em `(public)/menu/page.tsx` |
| Cardápio API | `apps/web/app/api/menu/route.ts` |
| Checkout | `(public)/checkout/page.tsx` |
| Acompanhamento | `(public)/order-status/[orderId]/page.tsx` |

---

## 8. Performance & acessibilidade (baseline)

- `next/image` para fotos (lazy + sizes); o hero pode ser `priority`.
- Alvos tocáveis ≥ 40px; contraste AA; `alt` em todas as imagens; foco visível.
- Carrosséis com scroll horizontal nativo (sem libs pesadas); `scroll-snap`.
- Evitar layout shift (reservar altura das imagens).
- SEO/OG por empresa (título/descrição/imagem de `brand.ts`).

---

## 9. Identificação / Conta — Pedidos & Perfil (F7)

A loja é **anónima por defeito**. Os ecrãs **Meus Pedidos** e **Perfil** exigem **identificar o cliente** —
**soft-login por telefone, sem OTP** (espelha o projeto-raiz `CLAUDE.md §18/§19`). Hoje o backend **ainda não** tem
isto (`customers` / `identify_customer` não existem), por isso Pedidos/Perfil ficam **inertes** até à F7.

**Mecanismo (a construir na F7):**
- **Gate opcional** (1 campo telefone, *skippável* — nunca bloqueia a venda) → RPC `identify_customer(p_phone, p_name?)`
  (SECURITY DEFINER) → cookie 1st-party **`dl_phone`** → liga o `phone` aos `analytics_events`.
- **Meus Pedidos:** RPC `get_customer_orders(p_phone)` → **Ativos** (mini-tracker) + **Histórico**; cada um abre
  `/order-status/[id]`; **"Pedir novamente"** repõe `localStorage['cart']`.
- **Perfil:** nome/telefone + resumo (nº pedidos, total gasto); **favoritos** (`localStorage['fav_items']` → opcional
  migrar para servidor); **Sair** (limpa `dl_phone`).
- As RPCs são **SECURITY DEFINER e devolvem SÓ RESUMOS**.

**Privacidade (decisão fechada — `// DECISÃO:` no código):**
- ❌ **NUNCA** devolver **morada, comprovativo ou dados de pagamento** na identificação soft (sem OTP) — quem souber o
  número veria PII alheia. Só resumos do próprio telefone. OTP no futuro → **ADR** em `/docs/decisions`.
- Enquanto a F7 não existir: **Pedidos/Perfil inertes** (toast "Em breve") — **nunca** um ecrã falso com dados inventados.

---

## 10. Formatos de Layout da Loja (F10)

O dono escolhe o **formato** visual da loja no painel admin (tab **"Layout da Loja"** → `/layout-loja`).
O formato ativo e as imagens vêm de `get_menu()` → campos `storefront_layout`, `hero_image_url`, `banner_images`.
O `menu/page.tsx` lê esses campos e renderiza a estrutura certa. **Nunca hardcodar** a ordem de secções.

> **⚠️ Esta F10 foi ABSORVIDA pela FASE 12 do ROADMAP da raiz** (spec `CLAUDE.md` raiz §26): os formatos passam de
> 3 para **1–5** (3 Grid mercado · 4 Lista compacta · 5 Editorial), e juntam-se **tema de cores runtime**
> (`storefront_theme`) e **conteúdo editável** (`storefront_content` — tagline/hero/rodapé/redes), tudo com
> fallback `brand.ts`. Implementar via F12.1–F12.3 da raiz; o desenho dos formatos 1–2 abaixo continua válido.

### Formatos disponíveis

**Formato 1 — Hero clássico** (default, atual)
```
┌─────────────────────┐
│      HERO           │  ← hero_image_url || brand.ts (altura ~400px)
├─────────────────────┤
│   [CÓDIGO AMIGO]    │
├─────────────────────┤
│  [cat] [cat] [cat]► │  ← carrosséis por categoria
│  [cat] [cat] [cat]► │
└─────────────────────┘
```

**Formato 2 — Hero + Mini Banners** (F10)
```
┌─────────────────────┐
│      HERO           │  ← hero_image_url || brand.ts (altura ~400px)
├─────────────────────┤
│ [ban][ban][ban][ban►│  ← mini banners retangulares 160×80px, scroll horiz. snap
├─────────────────────┤
│   [CÓDIGO AMIGO]    │
├─────────────────────┤
│  [cat] [cat] [cat]► │
└─────────────────────┘
```
Mini banners: até 5 imagens retangulares (`banner_images` de `settings`), scroll horizontal com `scroll-snap`,
sem autoplay (acessibilidade). Cada banner: `{ url, title: string|null, sort: int }`.
Imagens guardadas no bucket **público** `storefront-assets`.

**Formato 3** — *Em definição* (placeholder no admin — card cinza "Em breve")

### Regras de implementação
- `storefront_layout`, `hero_image_url`, `banner_images` são **campos públicos** → devolvidos por `get_menu()`,
  listados explicitamente no SELECT do RPC (nunca `select *`).
- Bucket `storefront-assets` é **público** (imagens de marketing, não PII). Upload autenticado via
  `POST /api/upload-storefront-asset` (route handler com `authenticated`).
- Se `banner_images` vazio no Formato 2 → não renderiza a faixa (não quebra o layout).
- Se `hero_image_url` null em qualquer formato → usa `ST.hero.image` de `brand.ts` (fallback whitelabel).
- ❌ **Nunca** mostrar `banner_images` ou `hero_image_url` junto de campos segredo (B) num RPC `anon`.

---

## Documento original 2 — ROADMAP local

# ROADMAP — Front-end / Loja do cliente (Storefront "The Box")

> Execução por **fases**. Uma fase por sessão. Ler `(public)/CLAUDE.md` + a fase atual antes de codar.
> **DoD de toda a fase:** `pnpm lint && pnpm --filter web build` verdes · checklist marcado · commit `feat(loja): …` ·
> testado com o brand demo (The Box) e mentalmente com um 2º brand (whitelabel não pode partir).
>
> Decisões fechadas (ver CLAUDE §2/§4): **produto simples** (sem tamanhos/adicionais até o backend suportar) ·
> **The Box = brand demo, loja ligada ao `/api/menu` real** · marca via tokens (`brand.ts` → CSS vars).

---

## F0 — Fundação whitelabel  ✅ concluída

Preparar o terreno para todos os ecrãs herdarem marca + fonte sem hardcode.

- [x] Copiar assets para `apps/web/public/assets/thebox/` (`hero.png`, `hero-shake.png`, `00.png`, `img1.png`, `2.png`…`12.png`)
- [x] `config/brand.ts`: bloco `storefront` (name, tagline, `primary`, `primary2`, `grad`, `star`, `font`, `hero{image,title,subtitle,cta}`, `fallbackImages[]`)
- [x] `(public)/layout.tsx`: importar `brand` (ponto único), injetar CSS vars `--st-*`/`--font-store` num wrapper, carregar **Plus Jakarta Sans** via `next/font`
- [x] Helper de imagem: `item.photo_url ?? fallback determinístico` dos `fallbackImages` (`imgFor` em `menu/page.tsx`)
- [x] alias `@brand` no `tsconfig` (`@brand` → `../../config/brand`)

**DoD:** build verde; uma página de teste mostra cores/fonte vindas só de `brand.ts`; trocar um valor em `brand.ts` muda o visual sem tocar em componentes.

---

## F1 — Home  ✅ concluída

Reconstruir `(public)/menu/page.tsx` ao estilo The Box, **mantendo toda a ligação atual** (`/api/menu`, `useCart`, tracking, waitlist).

- [x] Header: logo da marca (de `brand.ts`) + ♥ (contagem de favoritos local) + 🔔
- [x] **Hero** da marca (imagem + título + subtítulo + CTA "PEDIR AGORA" → scroll ao cardápio)
- [x] **Carrosséis por categoria** (cada `category` → secção + scroll horizontal de **cards de produto**: foto/fallback, ♥ favorito, nome, preço)
- [x] Card: botão Adicionar / stepper (qty) ligado ao `useCart` (`handleAdd` dispara `add_to_cart`)
- [x] `view_menu` uma vez ao carregar
- [x] **Barra flutuante do carrinho** + **drawer** reskinados (botão com `--st-grad`, contagem, subtotal, → `/checkout`)
- [x] **Bottom-nav** (Início / Cardápio / Pedidos / Perfil); Pedidos/Perfil inertes (toast "Em breve") até F4/Fase 6
- [x] `WaitlistForm` reskinada quando `!accepting_orders`
- [x] Responsivo: coluna `max-w-[480px]` centrada no desktop, fundo `--st-bg` à volta
- [x] _(F2)_ Tocar no card abre o ecrã de Produto

**DoD:** Home pixel-próxima do design com **dados reais** do cardápio; carrinho funciona; tracking dispara; build verde.

---

## F2 — Produto  ✅ concluída

Ecrã/sheet de detalhe **simples** (fiel ao schema plano). Overlay full-screen na `menu/page.tsx`.

- [x] Abrir produto (overlay ao tocar no card)
- [x] Foto grande (hero), botão voltar, ♥
- [x] Nome, badge (categoria), rating **omitido** (não existe no backend — não inventado)
- [x] Descrição, **preço grande** (`formatMT`)
- [x] Stepper de quantidade + "ADICIONAR AO CARRINHO" (`--st-grad`) → `useCart(add qty)` + fecha + toast
- [x] `view_item` ao abrir
- [x] **Sem** blocos de Tamanho/Adicionais — `// DECISÃO:` deixado a marcar onde entrariam

**DoD:** ✅ abrir/adicionar/voltar fluido; preço do servidor (`price_cents`); build + lint verdes.

---

## F3 — Carrinho & Checkout  ✅ concluída

- [x] Carrinho (drawer) estilo The Box: itens com qty, thumb, remover (stepper → 0), **resumo** — feito na F1
- [x] `/checkout` reskinado (tokens `var(--st-*)`): dados do cliente, **Levantamento/Entrega + zona**, **agendamento** (Agora/horário), pagamento (Manual: M-Pesa/e-Mola + upload comprovativo · Paysuite: Pagar Agora)
- [x] Taxa de entrega e total **recalculados no servidor** (`/api/create-order`); client só mostra preview
- [x] `begin_checkout` (entrar) + `add_payment_info` (escolher método)
- [x] Estados: zona + morada obrigatórias se entrega (`validate()`); slot validado no servidor

**DoD:** ✅ lógica intacta (manual + mock/paysuite); valores do servidor; build + lint verdes.

---

## F4 — Acompanhamento do pedido  ✅ concluída

- [x] `/order-status/[orderId]` com **tracker** estilo The Box (Recebido → Em preparo → Pronto/A caminho → Entregue), polling 5s do `get_order_status`
- [x] Resumo do pedido + estado de pagamento (badge + banners aguarda/cancelado) + feedback reskinado
- [x] **`purchase`** disparado **só** quando `status ∈ {paid, approved}` (guard `useRef` + `localStorage` — preservado intacto)
- [x] Botão "↻ Pedir novamente" (repõe `localStorage['cart']` a partir dos `order_items`)
- [x] Bónus: `payment/return` (fluxo Paysuite) também reskinado para os tokens da loja

**DoD:** ✅ tracker + polling + purchase guard intactos; build + lint verdes.

---

## F5 — Polish (perf · a11y · estados · SEO)  ✅ concluída

- [x] `next/image` em todas as fotos da loja (hero `priority`); `remotePatterns` (Supabase) no `next.config`; `scroll-snap` nos carrosséis
- [x] Estados vazios/erros/loading coerentes com o tema (`var(--st-*)`)
- [x] A11y: foco visível por teclado (`:focus-visible` global), `alt` em todas as imagens, alvos tocáveis
- [x] SEO/OG por empresa (`metadata` em `(public)/layout.tsx` a partir de `brand.ts` — título/descrição/imagem hero)
- [x] Loja fechada (`WaitlistForm`) reskinada — feito na F1

**DoD:** ✅ sem layout shift no hero (Image `fill` + `priority`); build + lint verdes.

---

## F6 — Whitelabel / Onboarding

- [ ] `docs` curto: "trocar de empresa" (editar `brand.ts` + assets em `public/assets/<brand>/`)
- [ ] 2º tema de exemplo (**Hot Box** — shake morango, `hero-shake.png`) só por `brand.ts`, **sem** tocar em componentes (prova viva de whitelabel)

**DoD:** trocar `brand.ts` de The Box → Hot Box muda a loja inteira sem editar componentes.

---

## F7 — Conta: Identificação · Meus Pedidos · Perfil  ✅ concluída

> Ativa os itens **Pedidos** e **Perfil** da bottom-nav (hoje inertes). Depende de **identificação do cliente**
> (soft-login por telefone, **sem OTP**) — ver `(public)/CLAUDE.md §9` e o projeto-raiz `CLAUDE.md §18/§19`.
> ⚠️ O backend ainda **não** tem `customers`/`identify_customer` — esta fase inclui (ou aguarda) esse trabalho.

### F7.0 — Backend  ✅
- [x] Migration `customers` (`20260614000023_customers.sql`) — `phone` pk + métricas; RLS `staff_all`, anon só via RPC
- [x] RPC `identify_customer(p_phone, p_name?)` SECURITY DEFINER → upsert + **resumo** (métricas, favoritos derivados, últimas compras). Nunca morada/comprovativo/pagamento
- [x] RPC `get_customer_orders(p_phone)` SECURITY DEFINER → pedidos do telefone (resumos + `items` p/ "pedir de novo")

### F7a — Identificação (soft-login, *skippável*)  ✅
- [x] **Modal de identificação** (telefone + nome opcional) — em vez de gate pré-hero forçado; abre ao tocar Pedidos/Perfil sem sessão ("Agora não" fecha, nunca bloqueia a venda)
- [x] `identify_customer` → cookie 1st-party `dl_phone` (+ `localStorage`); restaura a sessão ao recarregar

### F7b — Meus Pedidos  ✅
- [x] Nav "Pedidos" deixa de ser inerte → `get_customer_orders(dl_phone)`: **Ativos** + **Histórico** (badge de estado)
- [x] Cada pedido → "Acompanhar" abre `/order-status/[id]`; **"↻ Repetir"** repõe o carrinho

### F7c — Perfil  ✅
- [x] Avatar + nome/telefone + resumo (nº pedidos / total gasto)
- [x] **Favoritos** derivados (mais pedidos) com "+ Adicionar"; atalho "Ver os meus pedidos"; **Sair** (limpa `dl_phone`)

### Privacidade  ✅
- [x] Soft-login **sem OTP** → RPCs devolvem **só resumos**; **nunca** morada/comprovativo/pagamento. `// DECISÃO:` no código + CLAUDE §9. OTP futuro → ADR

**DoD:** ✅ identificar por telefone; Pedidos e Perfil mostram dados reais resumidos; sem PII sensível; build + lint verdes. ⚠️ **Aplicar a migration `0023`** (`pnpm db:migrate`) para as RPCs existirem.

---

## F8 — Produto avançado: Tamanhos + Adicionais (upsell)

> **Revê a decisão da F2** ("produto simples"): o ecrã de produto passa a ter **Tamanho** (escolha única)
> e **Adicionais** (multi-seleção, *upsell*), como o design Hot Box. ⚠️ **Exige backend** — o schema plano
> deixa de chegar. Regra de ouro mantém-se: **o preço é SEMPRE recalculado no servidor** (CLAUDE §6).

### F8.0 — Backend (schema + `create_order` + `get_menu`)
- [x] `menu_item_variants` (id, menu_item_id, name "Médio", price_cents, sort, is_default, active) — **tamanhos**
- [x] `menu_addons` (id, menu_item_id, name "Chantilly", price_cents, sort, active) — **adicionais**
- [x] `order_items`: + `variant_name_snapshot text null`, `addons jsonb default '[]'` (snapshot `[{name,price_cents}]`) — histórico imutável
- [x] `get_menu()` devolve `variants[]` e `addons[]` por item
- [x] `create_order` — payload por item passa a `{ menuItemId, qty, variantId?, addonIds?[], notes }`:
      servidor **valida** que variante/addons pertencem ao item e estão ativos, **recalcula**
      `unit_price = (variante ou base) + Σ addons`, e grava snapshots. **Preço do client ignorado.**
- [x] Admin → Cardápio: ao criar/editar um item, **CRUD opcional** de Tamanhos e Adicionais. **Se não adicionar nenhum, o item fica "simples".** (RLS `staff_all`)

### F8a — Página de Produto (front)
- [x] Ecrã dedicado `/menu/[itemId]` (ou overlay full-screen reaproveitado): foto, ♥, nome, badge, ⭐, descrição
- [x] **Renderização condicional** (decidido no admin, por item): a secção **Tamanho** só aparece se o item tiver variantes; **Adicionais** só se tiver addons. Item sem nada → continua "simples" (só qty + adicionar)
- [x] **Escolha o tamanho** — radio selecionável (→ reskin para o **cartão glass 3D da F9** `.glass-opt`), preço por tamanho
- [x] **Adicionais** — chips multi-seleção `+X MT` = *upsell* (→ glass `.glass-opt`, F9)
- [x] **Preço dinâmico** = tamanho + Σ adicionais (preview no client; **servidor é a verdade**)
- [x] Stepper de quantidade + ADICIONAR AO CARRINHO (gradiente)
- [x] `view_item` ao abrir; `add_to_cart` com variante + adicionais

### F8b — Carrinho / Checkout com variantes
- [ ] `useCart` guarda `{ menuItemId, qty, variantId?, addonIds?[], notes }` — **retro-compat** com linhas antigas (sem variante)
- [ ] Carrinho/checkout/resumo mostram tamanho + adicionais por linha; total recalculado no servidor

**DoD:** produto com tamanho+adicionais ponta-a-ponta; valores batem com o servidor; admin gere variantes/addons; build + lint verdes.

---

## F9 — Glassmorphism 3D nos cartões de seleção

> Aplicar **um** estilo glass 3D a **todos os cartões selecionáveis** (Tamanho + Adicionais da F8, e as
> opções do checkout). **Selecionado** = tilt 3D + tint da marca + neon (como o card "Médio" do demo);
> **não selecionado** = vidro liso (como o card "Grande"). Whitelabel: tudo de `--st-primary`/`--st-grad`.

### F9.0 — Receita CSS (em `apps/web/app/globals.css`)
> O contentor dos cartões precisa de `style={{ perspective: '1000px' }}` para o tilt.
```css
/* Cartão de seleção glassmorphism 3D — usa tokens --st-* (whitelabel) */
.glass-opt {
  position: relative; border-radius: 20px; cursor: pointer;
  background: linear-gradient(135deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.01) 100%);
  backdrop-filter: blur(30px); -webkit-backdrop-filter: blur(30px);
  box-shadow: 0 4px 15px rgba(0,0,0,0.5), inset 0 1px 1px rgba(255,255,255,0.35);
  transform-style: preserve-3d;
  transition: transform .4s cubic-bezier(.25,1,.5,1), box-shadow .4s ease;
}
.glass-opt::before { /* borda física de vidro */
  content: ""; position: absolute; inset: 0; border-radius: 20px; padding: 1.5px; pointer-events: none;
  background: linear-gradient(135deg, rgba(255,255,255,.4) 0%, rgba(255,255,255,.05) 50%, rgba(0,0,0,.4) 100%);
  -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor; mask-composite: exclude;
}
.glass-opt .glass-label { color: #8e8e93; font-weight: 500; }   /* não selecionado: cinza */

/* SELECIONADO: tint da marca + lift/tilt 3D + neon no chão */
.glass-opt.is-selected {
  background:
    radial-gradient(circle at 85% 85%, color-mix(in srgb, var(--st-primary) 25%, transparent) 0%, transparent 60%),
    linear-gradient(135deg, rgba(255,255,255,.06) 0%, rgba(255,255,255,.01) 100%);
  transform: translateY(-10px) rotateX(12px) rotateY(-8px) scale(1.03);
  box-shadow: -8px 20px 40px rgba(0,0,0,.7), inset 0 1.5px 1px rgba(255,255,255,.5);
}
.glass-opt.is-selected::after { /* neon no chão (cor da marca) */
  content: ""; position: absolute; inset: -1px; border-radius: 22px; padding: 1.5px; z-index: -1;
  background: var(--st-grad);
  -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor; mask-composite: exclude;
  opacity: .6; filter: blur(12px); transform: translateZ(-15px) scale(1.06) translateY(8px);
}
.glass-opt.is-selected .glass-label {
  color: var(--st-primary); font-weight: 700;
  text-shadow: 0 0 12px color-mix(in srgb, var(--st-primary) 50%, transparent);
}
/* opcional: alternar o lado do tilt por coluna → .glass-opt.tilt-right.is-selected { transform: …rotateY(8deg)… } */
```
- [x] Adicionar as classes acima a `globals.css`
- [x] `color-mix` tem fallback gracioso (browsers antigos ignoram o tint/glow; o lift + neon `--st-grad` continuam a indicar seleção); manter um ✓ ou borda como rede de segurança

### F9a — Refatorar o componente `Opt` (checkout)
- [x] `(public)/checkout/page.tsx`: o `Opt` passa a usar `className="glass-opt {is-selected}"` + `<span class="glass-label">` nos textos
- [x] Envolver cada grupo de opções num contentor com `style={{ perspective: '1000px' }}`
- [x] Aplicar a: Levantamento/Entrega, Agora/Horário, métodos manuais (M-Pesa/e-Mola) e Paysuite (M-Pesa/e-Mola/Cartão)

### F9b — Aplicar na Página de Produto (F8)
- [x] Cards de **Tamanho** e chips de **Adicionais** usam o mesmo `.glass-opt`/`is-selected`
- [x] Reutilizar o `Opt`/`.glass-opt` — **um só** estilo de seleção em toda a loja (não duplicar CSS)

**DoD:** seleção glass 3D consistente no checkout e na página de produto; derivada de `--st-primary`/`--st-grad` (whitelabel, troca de marca muda a cor do neon); build + lint verdes.

---

---

## F10 — Layout da Loja (Formatos + Hero + Mini Banners)

> O dono escolhe o **formato visual** da loja no painel admin. Lançamos com **2 formatos funcionais**
> (F1 atual + F2 Hero+Mini Banners) e F3 como placeholder. Ver spec completa em `(public)/CLAUDE.md §10`.

### F10.0 — BD + Bucket + API
- [ ] Migration aditiva: `settings` + colunas `storefront_layout smallint default 1`, `hero_image_url text null`, `banner_images jsonb default '[]'`
- [ ] Bucket **público** `storefront-assets` no Supabase Storage (RLS: `authenticated` pode INSERT; `anon` pode SELECT)
- [ ] `get_menu()` atualizado: devolver `storefront_layout`, `hero_image_url`, `banner_images` (explicitamente no SELECT, nunca `select *`)
- [ ] `POST /api/upload-storefront-asset` — route handler autenticado; faz upload para o bucket e devolve a URL pública

### F10.1 — Admin: aba "Layout da Loja" (`/layout-loja`)
- [ ] Link na sidebar do `(admin)/layout.tsx` (ícone de ecrã/layout)
- [ ] Nova página `(admin)/layout-loja/page.tsx`
- [ ] **Selector de formato**: 3 cards com wireframe visual CSS (ASCII-art em HTML puro, sem imagens)
  - Card F1 activo por defeito; borda vermelha + checkmark quando selecionado
  - Clicar → PATCH `settings.storefront_layout` imediatamente (sem botão "Guardar" extra)
- [ ] **Config do Formato 1** (aparece quando F1 selecionado):
  - Upload de imagem hero → `storefront-assets/hero.<ext>` → URL guardada em `settings.hero_image_url`
  - Preview da imagem atual; botão "Remover" (volta ao fallback brand.ts)
- [ ] **Config do Formato 2** (aparece quando F2 selecionado):
  - Upload hero (mesmo que F1)
  - Até **5 slots de mini banner**: cada slot tem upload de imagem (160×80 px recomendado), campo título opcional
  - Botões ↑↓ para reordenar; botão ✕ para remover; array guardado em `settings.banner_images`
- [ ] **Config do Formato 3**: card cinza com texto "Em breve — formato em definição"
- [ ] Guardar/atualizar via PATCH autenticado em `settings` (service role ou RPC `update_storefront_settings(p_layout, p_hero_url, p_banner_images)` restrita a `authenticated`)

### F10.2 — Storefront: renderização condicional (`menu/page.tsx`)
- [ ] Ler `menuData.storefront_layout`, `menuData.hero_image_url`, `menuData.banner_images`
- [ ] **Formato 1**: estrutura atual — Hero → Código → Carrosséis por categoria
- [ ] **Formato 2**: Hero grande → faixa `MiniBanners` → Código → Carrosséis por categoria
  - Componente `MiniBanners`: `div` com scroll horizontal, `scroll-snap-type: x mandatory`, `scrollbar-width: none`
  - Cada card: `160×80px`, `next/image` com `object-cover`, título em overlay semitransparente se presente
  - Se `banner_images` vazio → componente não renderiza (sem placeholder)
- [ ] **Formato 3**: renderiza como F1 (fallback até estar definido)
- [ ] Hero: `hero_image_url` se presente, senão `ST.hero.image` de `brand.ts`

**DoD:** trocar formato no admin muda a ordem de secções na loja em tempo real; hero e mini banners uploadados aparecem; bucket público serve as imagens sem signed URL; `pnpm lint && pnpm --filter web build` verdes · commit `feat(loja): F10 — layout da loja + mini banners`.

---

### Dependências do projeto-raiz (não bloquear a loja)
- Tamanhos/adicionais reais → agora planeado na **F8** (acima): migration `menu_item_variants`/`menu_addons` + `create_order`.
- "Meus Pedidos"/Perfil/favoritos persistentes → exige `customers`/identificação (Fase 6 do `ROADMAP.md` raiz).
- Indique-e-ganhe / brinde → Fases 5–6 do projeto-raiz.
