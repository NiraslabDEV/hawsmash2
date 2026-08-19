# Painel Admin — Delivery OS (Reskin iFood + Glassmorphism)

> Spec de implementação para IA. Tudo conectado ao código real.
> Ficheiro de referência: `apps/web/app/(admin)/`. Não inventar rotas, RPCs, colunas ou estados que não existam.

---

## 🎯 Objetivo

Reskin completo do painel admin ao estilo iFood (vermelho `#EA1D2C`) com **glassmorphism** em todos os
cards, modais e sidebar. A loja em questão é moçambicana — moeda MZN (`MT`), nunca `R$` ou `Intl currency MZN`.

---

## 🎨 Tokens de Design

### Paleta base
```
--bg-root:       #080809        /* fundo da página */
--bg-glass:      rgba(255,255,255,0.04)   /* card glassmorphism */
--bg-glass-hov:  rgba(255,255,255,0.07)
--border-glass:  rgba(255,255,255,0.08)
--blur:          12px           /* backdrop-filter: blur(12px) */

--red:           #EA1D2C        /* iFood red — cor primária */
--red-glow:      rgba(234,29,44,0.25)
--red-dim:       rgba(234,29,44,0.12)

--green:         #22C55E
--orange:        #F59E0B
--purple:        #8B5CF6
--blue:          #3B82F6
--danger:        #EF4444

--text-1:        #F0F0F2        /* texto principal */
--text-2:        #A8A8B0        /* texto secundário */
--text-mute:     #6F6F78        /* labels / meta */
```

### Classe Tailwind reutilizável para glass card
```
rounded-2xl border border-white/[0.08] bg-white/[0.04] backdrop-blur-[12px]
shadow-[0_4px_24px_rgba(0,0,0,0.4)]
```
Usar esta classe em TODOS os cards, modais, sidebar, topbar.

---

## 🧱 Estrutura Geral

```
┌──────────────────────────────────────────────────────────────────┐
│  TOPBAR  (sticky, glassmorphism, z-20)                           │
├─────────────────────┬────────────────────────────────────────────┤
│                     │                                            │
│  SIDEBAR (w-64)     │   MAIN CONTENT                             │
│  glass + blur       │   (pedidos / caixa / analise / …)          │
│                     │                                            │
│  rodapé: status     │                                            │
│  loja + ver loja    │                                            │
├─────────────────────┴────────────────────────────────────────────┤
```

---

## 📌 Sidebar — `apps/web/app/(admin)/layout.tsx`

### Estado real (já existente, não recriar)
```ts
const [badge, setBadge] = useState<number | null>(null);      // ativos + aguarda_pagamento
const [storeOpen, setStoreOpen] = useState<boolean | null>(null);
// fonte: supabase.rpc('get_order_stats') + settings.accepting_orders
```

### Rotas reais
| Label | href | ícone existente |
|---|---|---|
| Pedidos | `/pedidos` | `pedidos` |
| Cardápio | `/cardapio` | `cardapio` |
| Caixa | `/caixa` | `caixa` |
| Análise | `/analise` | `analise` |
| Avaliações | `/feedback` | `feedback` |
| Clientes | `/lista-espera` | `clientes` |
| Marketing | `/marketing` | `marketing` |
| Definições | `/definicoes` | `definicoes` |

### Estilo glassmorphism
```
aside: w-64 h-screen fixed flex flex-col
       bg-white/[0.03] backdrop-blur-[12px]
       border-r border-white/[0.08]

logo area: h-16 border-b border-white/[0.08]
  → logo: span.grid.place-items-center.w-8.h-8.rounded-lg.bg-[#EA1D2C] letra "D"
  → texto: "Painel Admin" font-bold text-white

nav item normal:
  flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium
  text-[#A8A8B0] hover:bg-white/[0.06] hover:text-white transition-all

nav item active:
  bg-[#EA1D2C]/12 text-[#EA1D2C]
  border-l-[3px] border-[#EA1D2C]
  shadow-[inset_0_0_16px_rgba(234,29,44,0.08)]

badge (pedidos ativos):
  min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-bold
  bg-[#EA1D2C] text-white

rodapé sidebar:
  border-t border-white/[0.08] p-4 space-y-3
  dot status: w-2.5 h-2.5 rounded-full bg-green-500 (ou red-500)
  botão "Ver loja": rounded-xl border border-white/[0.08] py-2
                    hover:bg-white/[0.06] transition-all text-sm font-medium
```

---

## 📌 Topbar — `apps/web/app/(admin)/layout.tsx`

### Estado real
```ts
const [user, setUser] = useState<User | null>(null);  // Supabase User
// avatar: user?.email?.[0]?.toUpperCase()
// role hardcoded: "Administrador"
// supabase.auth.signOut() → router.replace('/login')
```

### Estilo glassmorphism
```
header: sticky top-0 z-20 h-16
        bg-white/[0.03] backdrop-blur-[12px]
        border-b border-white/[0.08]
        flex items-center gap-3 px-4 lg:px-6

campo busca (desktop):
  flex items-center gap-2
  bg-black/20 border border-white/[0.08] rounded-xl px-3 py-2
  backdrop-blur-[8px]
  → input placeholder="Buscar pedido, cliente…" text-sm

notificações:
  botão ícone sino — sem badge real (ainda não existe RPC para isso)
  NÃO inventar contagem de notificações

avatar:
  w-8 h-8 rounded-full
  bg-[#EA1D2C]/20 text-[#EA1D2C] grid place-items-center text-sm font-bold
  → letra = user?.email?.[0]?.toUpperCase()

email / role:
  p.text-sm.font-medium.text-white (user?.email truncado)
  p.text-[11px].text-[#6F6F78] "Administrador"

botão Sair:
  text-sm text-[#A8A8B0] hover:text-[#EA1D2C] transition-colors
  → supabase.auth.signOut()
```

---

## 🚨 Banner Impressora Offline — `apps/web/app/(admin)/pedidos/page.tsx`

### Estado real
```ts
type DeviceStatus = {
  devices: Array<{ id: string; kind: string; last_seen_at: string; online: boolean }>;
  threshold_seconds: number;
};
// fonte: supabase.rpc('get_device_status')
// poll: setInterval(fetchDeviceStatus, 60000)  ← já implementado

const printer = deviceStatus?.devices.find((d) => d.kind === 'printer');
const printerOnline = !!printer?.online;
// Mostrar banner APENAS se !printerOnline && printer !== undefined
```

### Estilo glassmorphism
```
div: w-full rounded-2xl mb-6
     bg-[#EA1D2C]/[0.06] backdrop-blur-[12px]
     border border-[#EA1D2C]/25
     shadow-[0_0_24px_rgba(234,29,44,0.08)]
     flex items-center justify-between px-5 py-4

dot: w-2.5 h-2.5 rounded-full bg-[#EA1D2C] animate-pulse
texto: "Impressora Offline" font-semibold text-[#EA1D2C]
sub: "Verifique a conexão da impressora" text-sm text-[#A8A8B0]

botão "Reconectar":
  px-4 py-2 rounded-xl text-sm font-semibold
  bg-[#EA1D2C]/15 border border-[#EA1D2C]/30 text-[#EA1D2C]
  hover:bg-[#EA1D2C]/25 transition-all
  → onClick: fetchDeviceStatus()  (re-verifica estado)
```

---

## 📊 Cards de Métricas — `apps/web/app/(admin)/pedidos/page.tsx`

### Estado real
```ts
type Stats = {
  total_faturado: number;    // total de todas as vendas confirmadas (centavos)
  faturado_hoje: number;     // faturado hoje (centavos)
  pedidos_hoje: number;      // nº pedidos hoje
  ativos: number;            // approved + paid + in_preparation + ready
  aguarda_pagamento: number; // awaiting_payment + awaiting_approval
  em_preparo: number;        // in_preparation
  prontos: number;           // ready
  cancelados_hoje: number;   // cancelled hoje
  entregues_hoje: number;    // delivered hoje
  avg_rating: number | null; // média de order_feedback.rating
};
// fonte: supabase.rpc('get_order_stats')

// Formatação correta de dinheiro:
import { formatMT, type Cents } from '@delivery/core';
const money = (c: number) => formatMT(c as Cents);
// Resultado: "MT 1.390,00" — NUNCA usar Intl currency MZN (dá "MTn")
```

### Toggle faturado oculto (já existe)
```ts
const [hideFaturado, setHideFaturado] = useState(false);
// persiste em localStorage: key = 'pedidos_faturado_hidden'
```

### Grid de 6 cards — estilo glassmorphism
```
grid: grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-6

cada card:
  rounded-2xl border border-white/[0.08]
  bg-white/[0.04] backdrop-blur-[12px]
  shadow-[0_4px_24px_rgba(0,0,0,0.4)]
  p-4 flex flex-col gap-1
  hover:bg-white/[0.07] hover:border-white/[0.12] transition-all

label: text-[11px] uppercase tracking-wide text-[#6F6F78] font-medium
valor: text-2xl font-bold text-white
delta: text-xs font-medium (cor varia por card)
```

### Os 6 cards (valores reais)
```
1. Total Faturado (hoje)
   label: "Total Faturado (hoje)"
   valor: money(stats.faturado_hoje)
   toggle olho → hideFaturado (asteriscos se oculto)
   cor delta: text-[#22C55E]
   borda top accent: border-t-2 border-t-[#22C55E]/60

2. Pedidos (hoje)
   label: "Pedidos (hoje)"
   valor: stats.pedidos_hoje
   cor delta: text-[#22C55E]
   borda top accent: border-t-2 border-t-[#22C55E]/60

3. Em Preparo
   label: "Em preparo"
   valor: stats.em_preparo
   sub: "Em andamento" — text-[#F59E0B]
   borda top accent: border-t-2 border-t-[#F59E0B]/60

4. Prontos
   label: "Prontos"
   valor: stats.prontos
   sub: "Aguardando coleta" — text-[#8B5CF6]
   borda top accent: border-t-2 border-t-[#8B5CF6]/60

5. Cancelados (hoje)
   label: "Cancelados"
   valor: stats.cancelados_hoje
   cor: text-[#EF4444]
   borda top accent: border-t-2 border-t-[#EF4444]/60

6. Avaliação média
   label: "Avaliação média"
   valor: stats.avg_rating?.toFixed(1) ?? "—"  + " ⭐"
   sub: "Feedback dos clientes"
   borda top accent: border-t-2 border-t-amber-400/60
```

---

## 🔍 Barra de Filtros + Abas — `apps/web/app/(admin)/pedidos/page.tsx`

### Estado real
```ts
const [search, setSearch] = useState('');
const [statusFilter, setStatusFilter] = useState<string>('all');
// onChange → fetchOrders() já é chamado via useEffect([search, statusFilter])
```

### Abas reais
```ts
const TABS = [
  { key: 'all', label: 'Todos' },
  { key: 'awaiting_approval', label: 'Novos' },
  { key: 'paid', label: 'Pagos' },
  { key: 'approved', label: 'Aceitos' },
  { key: 'in_preparation', label: 'Em preparo' },
  { key: 'ready', label: 'Prontos' },
  { key: 'delivered', label: 'Entregues' },
  { key: 'cancelled', label: 'Cancelados' },
];
// count por aba: NÃO inventar — apenas a aba "Todos" mostra o total (orders.length)
// As restantes mostram o count filtrado do array local após fetch
```

### Estilo glassmorphism
```
wrapper filtros: rounded-2xl border border-white/[0.08] bg-white/[0.03]
                 backdrop-blur-[12px] p-4 mb-4 flex gap-3 flex-wrap

campo busca:
  flex-1 min-w-[200px] flex items-center gap-2
  bg-black/20 border border-white/[0.08] rounded-xl px-3 py-2.5
  → ícone lupa svg #6F6F78
  → input placeholder="Buscar pedido, cliente, telefone…"
    value={search} onChange={e => setSearch(e.target.value)}

abas:
  flex gap-1 flex-wrap mt-3
  aba inativa: px-3 py-1.5 rounded-xl text-sm text-[#A8A8B0]
               hover:bg-white/[0.06] hover:text-white transition-all
  aba ativa:   bg-[#EA1D2C]/15 border border-[#EA1D2C]/30
               text-[#EA1D2C] font-semibold rounded-xl px-3 py-1.5 text-sm
  badge count: span.ml-1.5.text-[11px].rounded-full.px-1.5
               bg ativo = bg-[#EA1D2C] text-white
               bg inativo = bg-white/[0.08] text-[#6F6F78]
```

---

## 📋 Tabela / Cards de Pedidos — `apps/web/app/(admin)/pedidos/page.tsx`

### Dados reais
```ts
type Order = {
  id: string;
  order_number: string;           // "ENC-0042"
  status: string;
  flow: string;                   // 'manual' | 'digital'
  fulfillment_type: string;       // 'pickup' | 'delivery'
  delivery_zone_id: string | null;
  address: string | null;
  customer_name: string;
  customer_phone: string;
  customer_email: string | null;
  scheduled_for: string | null;   // null = AGORA
  subtotal_cents: number;
  delivery_fee_cents: number;
  total_cents: number;
  payment_method: string;         // 'mpesa' | 'emola' | 'credit_card' | 'cash'
  payment_proof_path: string | null;
  notes: string | null;
  created_at: string;
  items: Array<{ id; menu_item_id; name; qty; unit_price_cents; station; notes }>;
};
// fonte: supabase.rpc('get_orders', { p_filters: { limit: 100, search?, status? } })
// retorna: { orders: Order[] }
```

### Status metadata (já definido no código)
```ts
const STATUS_META = {
  awaiting_approval: { dot: 'bg-amber-400',   text: 'text-amber-400',  label: 'Novo' },
  awaiting_payment:  { dot: 'bg-blue-400',    text: 'text-blue-400',   label: 'A pagar' },
  paid:              { dot: 'bg-blue-400',    text: 'text-blue-400',   label: 'Pago' },
  approved:          { dot: 'bg-emerald-400', text: 'text-emerald-400',label: 'Aceito' },
  in_preparation:    { dot: 'bg-orange-400',  text: 'text-orange-400', label: 'Em preparo' },
  ready:             { dot: 'bg-purple-400',  text: 'text-purple-400', label: 'Pronto' },
  delivered:         { dot: 'bg-green-500',   text: 'text-green-500',  label: 'Entregue' },
  cancelled:         { dot: 'bg-red-500',     text: 'text-red-500',    label: 'Cancelado' },
  payment_failed:    { dot: 'bg-red-500',     text: 'text-red-400',    label: 'Falhou' },
};
```

### Layout desktop: tabela glassmorphism
```
wrapper tabela:
  rounded-2xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-[12px]
  overflow-hidden shadow-[0_4px_24px_rgba(0,0,0,0.4)]

thead:
  bg-white/[0.03] border-b border-white/[0.06]
  th: px-4 py-3 text-[11px] uppercase tracking-wide text-[#6F6F78] font-medium text-left

  colunas: PEDIDO | CLIENTE | TIPO | HORÁRIO | TOTAL | STATUS | AÇÕES

tr normal: border-b border-white/[0.04] hover:bg-white/[0.04] transition-colors
tr expandido (detalhes): bg-[#EA1D2C]/[0.03] border-b-[#EA1D2C]/10

td PEDIDO:
  order_number em font-mono font-bold text-white
  created_at em text-[11px] text-[#6F6F78]

td CLIENTE:
  customer_name em font-medium text-white
  customer_phone em text-[11px] text-[#A8A8B0]

td TIPO:
  badge pickup:   "🏃 Levantamento" bg-blue-500/10 text-blue-400
  badge delivery: "🛵 Entrega"      bg-orange-500/10 text-orange-400
  (ambos: text-[11px] font-semibold rounded-full px-2 py-0.5)

td HORÁRIO:
  scheduled_for != null → format(parseISO(scheduled_for), "dd/MM 'às' HH:mm", { locale: pt })
  scheduled_for == null → "Agora"
  texto em text-sm text-[#A8A8B0]

td TOTAL:
  money(order.total_cents) em font-bold text-white
  payment_method:
    'mpesa'  → badge "M-Pesa" bg-[#00BF63]/10 text-[#00BF63]
    'emola'  → badge "e-Mola" bg-purple-500/10 text-purple-400
    'cash'   → badge "Dinheiro" bg-amber-500/10 text-amber-400
    (text-[11px] rounded-full px-2 py-0.5)

td STATUS:
  dot span + label do STATUS_META
  dot: w-2 h-2 rounded-full inline-block mr-1.5 (animate-pulse se in_preparation)

td AÇÕES:
  botão expand ▾ / ▴ → toggleExpand(order)
  [ver linha de ação abaixo]
```

### Linha expandida (detalhes do pedido)
```
Aparece quando expandedId === order.id
Glassmorphism extra: bg-white/[0.02] border-t border-white/[0.06]

Layout 3 colunas:
  col 1 — Itens:
    lista de order.items: qty × name  → money(unit_price_cents * qty)
    notes do item em italic text-[#6F6F78]
    se order.notes: "Obs: ..." em bloco separado

  col 2 — Entrega / Levantamento:
    pickup → "Levantamento em [settings.pickup_address]" (NÃO expor pickup_address
              se não vier no payload do RPC — usar texto genérico "Levantamento no local")
    delivery → address + "zona: delivery_zone_id" (se vier nome da zona no payload)
    scheduled_for → horário agendado (ou "Agora")

  col 3 — Pagamento + Ações:
    Subtotal: money(subtotal_cents)
    Taxa entrega: money(delivery_fee_cents)
    Total: money(total_cents) em font-bold text-white text-lg

    se payment_proof_path → botão "Ver comprovativo"
      → supabase.storage.from('payment-proofs').createSignedUrl(path, 3600)
      → abre em nova aba (signed URL privado — NUNCA URL pública)

    ActionButtons (ver abaixo)
```

### ActionButtons (lógica real — não alterar)
```ts
// awaiting_approval (flow=manual):
//   [Aprovar]  → advance(order, 'APPROVE')
//   [Negar]    → abre modal deny com motivo → advance(order, 'CANCEL', reason)

// paid / approved:
//   [Iniciar preparo] → advance(order, 'START_PREPARATION')

// in_preparation:
//   [Marcar pronto]   → advance(order, 'MARK_READY')

// ready:
//   [Enviar] ou [Entregue] → advance(order, 'DELIVER')

// qualquer ativo → [Cancelar] (abre modal com motivo obrigatório)

// advance() → supabase.rpc('advance_order', { p_order_id, p_event, p_reason? })
// após APPROVE → POST /api/conversions/fire + POST /api/emails/send-approval-email
// após CANCEL  → POST /api/emails/send-rejection-email

// Estilo dos botões:
// Aprovar:         bg-emerald-600 hover:bg-emerald-500 text-white
// Iniciar preparo: bg-orange-600  hover:bg-orange-500  text-white
// Marcar pronto:   bg-purple-600  hover:bg-purple-500  text-white
// Entregar:        bg-green-600   hover:bg-green-500   text-white
// Negar/Cancelar:  bg-white/[0.06] text-red-400 hover:bg-red-900/20
// todos: px-3 py-1.5 text-xs font-semibold rounded-xl transition-all
```

### Modal Negar/Cancelar (glassmorphism)
```
overlay: fixed inset-0 bg-black/70 backdrop-blur-[4px] z-50 flex items-center justify-center

modal:
  w-full max-w-md
  rounded-2xl border border-white/[0.10] bg-white/[0.06] backdrop-blur-[20px]
  shadow-[0_20px_60px_rgba(0,0,0,0.6),0_0_40px_rgba(234,29,44,0.08)]
  p-6 space-y-4

título: "Motivo da recusa" text-lg font-bold text-white
textarea:
  w-full rounded-xl bg-black/30 border border-white/[0.08]
  text-sm text-white placeholder-[#6F6F78] p-3 focus:outline-none
  focus:border-[#EA1D2C]/50 transition-colors
  value={denyReason} onChange={e => setDenyReason(e.target.value)}
  minLength: mensagem não enviada se vazio (botão disabled)

botões:
  Cancelar: bg-white/[0.06] hover:bg-white/[0.10] text-[#A8A8B0] rounded-xl px-4 py-2
  Confirmar: bg-[#EA1D2C] hover:bg-[#c8161f] text-white rounded-xl px-4 py-2 font-semibold
             disabled se !denyReason.trim()
```

### Toast de feedback (success / error)
```ts
const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
// auto-dismiss após 3s (setTimeout)
```
```
posição: fixed bottom-6 right-6 z-50
card:
  rounded-2xl border backdrop-blur-[16px] px-5 py-3 font-medium text-sm
  success: border-[#22C55E]/30 bg-[#22C55E]/10 text-[#22C55E]
  error:   border-[#EA1D2C]/30 bg-[#EA1D2C]/10 text-[#EA1D2C]
  shadow-[0_4px_24px_rgba(0,0,0,0.4)]
```

### Layout mobile: cards em vez de tabela
```
md:hidden — cada pedido vira card glassmorphism:
  rounded-2xl border border-white/[0.08] bg-white/[0.04] backdrop-blur-[12px] p-4 mb-3
  linha 1: order_number (font-mono bold) + badge status (dot + label)
  linha 2: customer_name + fulfillment badge
  linha 3: money(total_cents) bold + payment_method badge
  linha 4: created_at / scheduled_for
  expandido → toca card → mostra itens + ActionButtons
```

---

## 📄 Paginação (opcional — estado atual é offset local)

O fetch atual traz `limit: 100` de uma vez. Se implementar paginação:
```ts
// adicionar ao p_filters: { limit: 20, offset: page * 20 }
// supabase.rpc('get_orders') já aceita esses campos
```
```
rodapé tabela: flex items-center justify-between text-sm text-[#6F6F78] px-4 py-3
  "Exibindo X de Y pedidos"
  botões < > : rounded-xl border border-white/[0.08] px-3 py-1.5
               hover:bg-white/[0.06] transition-all
  página ativa: bg-[#EA1D2C] text-white border-transparent
```

---

## 🔄 Realtime (não implementado ainda — pode adicionar)

```ts
// Para pedidos em tempo real — adicionar ao useEffect em pedidos/page.tsx:
supabase
  .channel('orders')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, fetchOrders)
  .subscribe();
// Limpar canal em cleanup do useEffect
// NÃO ativar sem confirmar com o dono (aumenta conexões Supabase)
```

---

## 🚫 O que NÃO fazer (regras do CLAUDE.md)

- ❌ `Intl` com `currency: 'MZN'` — dá "MTn". Usar só `formatMT` de `@delivery/core`
- ❌ URL pública do bucket `payment-proofs` — sempre `createSignedUrl`
- ❌ Inventar RPCs (`get_notifications`, `get_kitchen_queue`, etc.) — só existem:
  `get_order_stats`, `get_orders`, `get_device_status`, `advance_order`, `get_order_status`
- ❌ `tenant_id` em qualquer query/componente
- ❌ Mostrar `subtotal_cents` ou `delivery_fee_cents` do client (sempre do server)
- ❌ Confirmar pedido antes de `paid` (digital) ou `approved` (manual)
- ❌ Adicionar `Todos os canais` dropdown — não há campo `channel` na tabela `orders`
- ❌ Mostrar `R$` — moeda é `MT` (Meticais moçambicanos)

---

## ✅ Checklist de Implementação

- [x] Sidebar: glassmorphism + active item com glow + badge pedidos ativos
- [x] Topbar: glassmorphism + busca (⌘K) + avatar email + botão sair
- [x] Banner impressora: só aparece se `!printerOnline && printer !== undefined`
- [x] 6 KPI cards: glass, accent top border, valores de `get_order_stats()`
- [x] Deltas reais "▲/▼ % vs ontem" (migration `0022` estende `get_order_stats`)
- [x] Barra filtros: glass, campo busca + chip de data + dropdown de status
- [x] Abas com badge count REAL (de `stats.status_counts`)
- [x] Tabela desktop: glass, thead muted, row hover, expand, coluna Endereço
- [x] Linha expandida: 3 cols (itens / entrega / pagamento + comprovativo + ações)
- [x] ActionButtons: lógica inalterada, botões com rounded-xl
- [x] Modal negar: glass + blur overlay, textarea, disabled sem motivo
- [x] Toast: fixed bottom-right, glass colorido por tipo, auto-dismiss 3s
- [x] Paginação local (10/página): "Exibindo X a Y de N" + ‹ › + nºs
- [x] Mobile: cards em vez de tabela
- [x] Formatar todo dinheiro com `formatMT` de `@delivery/core` (MT, nunca R$)
