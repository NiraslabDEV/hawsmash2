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
| **Onde vive** | `apps/web/app/(public)/_hawsmash/` (`landing.css`, `storefront.tsx`, `sections.tsx`, `menu-banners.tsx`, `cart-drawer.tsx`, `icons.tsx`) |
| **Quem a usa** | `/` (escolha de loja) · `/l/[slug]` (loja) · `/upsell` (oferta antes do pagamento) · `/checkout` (só a voz: títulos, foco, cantos) |
| **De onde veio** | `Desktop/0001. Clientes/HawSmash` — `styles.css` + `src/app.jsx` do 1.0; fotos em `public/assets/hawsmash/` |
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
