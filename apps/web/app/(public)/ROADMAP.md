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
