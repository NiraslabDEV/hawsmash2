# Definições do POS por loja

> Cada loja configura o seu balcão no painel (aba **POS**, `/definicoes-pos`): meios de pagamento,
> upsell, notas rápidas e comportamento do ecrã. Sem deploy, sem reiniciar o terminal.
>
> **Migration:** `1067_definicoes_do_pos.sql` · **Contrato:** `apps/web/lib/pos/settings.ts` ·
> **Decisão:** [ADR 0006](decisions/0006-definicoes-do-pos-por-loja.md)
>
> Este documento serve dois leitores: quem mantém o HAWSMASH e quem vai **levar o módulo para outro
> projecto** copiado deste. Para isso, ir direito à §5.

---

## 1. O que se configura

| Secção | O que muda no balcão | Valor de fábrica |
|---|---|---|
| **Meios de pagamento** | Quais aparecem no ecrã de pagamento, o nome do botão e a ordem. Pagamento misto ligado/desligado | Os quatro ligados: Dinheiro, M-Pesa, e-Mola, Cartão · misto permitido |
| **Upsell** | Liga/desliga o ecrã entre o carrinho e o pagamento; por passo (acompanhar, sobremesa): ligado, título, frases e **produtos** (os do Cardápio ou uma lista escolhida para a loja, com ordem) | Ligado, com frases neutras (não falam de nenhum produto) e os produtos do Cardápio |
| **Notas rápidas** | Os atalhos da nota do artigo e da nota do pedido ("SEM CEBOLA"). No POS **somam-se** | 8 atalhos genéricos |
| **Tipo de pedido ao abrir** | Balcão, Levantamento ou Entrega. Se o canal estiver desligado na loja ou sem rede, abre em Balcão | Balcão |
| **Nome e telefone no balcão** | Mostra ou esconde as barras de cliente na venda de balcão (entrega e levantamento pedem sempre) | Mostra |
| **Segundos da confirmação** | Quanto tempo fica o ecrã "venda registada" (1–15 s) | 3 s |
| **Som de pedido novo** | Toca quando chega um pedido online. Desligado, o botão Pedidos continua a piscar | Ligado |
| **Impressão** | Vias por pedido (1–3), o modelo de cada via (Completo, Compacto, Cozinha) e os blocos do Completo. Aplica-o o **mini-PC** — ver §11 | 2 vias, Completo em todas, tudo ligado (o papel de sempre) |

**Produtos do upsell.** Sem lista escolhida (`productIds` vazio), um passo oferece os marcados como
upsell no **Cardápio**, no passo da sua categoria (`cardapioStepProducts`: sobremesa no fim,
acompanhamentos antes das bebidas). Com lista, oferece exactamente esses, pela ordem da loja — mesmo
que não estejam marcados no Cardápio. Nos dois casos o POS salta o que está esgotado ou já no carrinho,
e um id de produto apagado cai sem barulho. O painel não deixa o mesmo produto em dois passos, e
"Escolher para esta loja" arranca da lista do Cardápio. Os ids são do catálogo, partilhado entre lojas,
por isso *Copiar para outra loja* leva a lista tal como está.

Os **números** de M-Pesa/e-Mola continuam na aba **Lojas**. Aqui só se decide o ecrã.

---

## 2. Como funciona

```
Painel · aba POS ──save_pos_settings()──▶ store_pos_settings (1 linha por loja, config jsonb)
                                                   │            └─▶ event_log: store.pos_settings_changed
                                                   ▼
POS da loja ◀──get_pos_settings()── ao arrancar e a cada 2 min (junto com o cardápio)
     │
     └─ resolvePosSettings(config) ─▶ localStorage (offline usa a última cópia)
```

- **O `config` é jsonb e pode vir incompleto.** O POS e o painel lêem-no com `resolvePosSettings`,
  campo a campo, por cima de `FACTORY_POS_SETTINGS`. Uma chave em falta ou estragada cai no valor de
  fábrica; as outras ficam. É por isso que acrescentar uma definição nova **não precisa de migration**.
- **O painel grava o objecto inteiro**, já limpo pelo mesmo resolver. O que se vê depois de guardar
  é exactamente o que o balcão usa.
- **Uma loja sem linha** usa o valor de fábrica. O painel avisa ("ainda usa os valores de fábrica").

---

## 3. Regras que não se negoceiam

1. **A venda nunca pára (Regra 1).** Ler as definições nunca lança (`fetchPosSettings` devolve `null`
   e fica o que já estava: cache ou fábrica). Com todos os meios desligados, o **dinheiro volta a
   estar ligado**; o painel nem deixa desligar o último.
2. **Não é regra de dinheiro (Regra 2).** Esconder o cartão no POS é uma escolha de ecrã.
   `create_counter_sale` **não** a impõe, porque uma venda offline feita antes da mudança tem de
   continuar a sincronizar (§7.5). O que tiver de ser imposto pelo servidor não é uma definição do
   POS: é uma coluna com RPC própria.
3. **Por loja (Regra 3).** RLS por `auth_can_store(store_id)`. A escrita só passa pela RPC; não há
   policy de insert/update/delete, nem para o dono. Gate: `packages/db/tests/pos-settings.test.ts`.
4. **Quem pode:** `owner` em qualquer loja; `manager` na sua loja (é operação da loja, §6);
   `cashier`/`kitchen` só **lêem** (o POS precisa) e não vêem a aba.
5. **Tudo fica registado:** `event_log` com `type = 'store.pos_settings_changed'`, o autor, a loja e
   `payload.changed` com as secções que mudaram (`payments`, `upsell`, `quickNotes`…). É o que
   responde a "quem tirou o cartão do POS?".
6. **Conteúdo não é código (§18.2/§18.3).** Frases e notas de uma casa vivem na BD. O valor de
   fábrica é neutro: não fala de WAGYU, natas nem de nenhum produto.
7. **Upsell do balcão ≠ upsell da loja online.** O online continua em `settings.upsell_enabled`
   (aba Definições); o do balcão é este, por loja.

---

## 4. Ficheiros

| Ficheiro | Papel | Noutro projecto |
|---|---|---|
| `supabase/migrations/…_1067_definicoes_do_pos.sql` | Tabela, RLS, grants, `get_pos_settings`, `save_pos_settings` | **Copiar** (renumerar) |
| `supabase/migrations/…_1068_definicoes_do_pos_desta_instalacao.sql` | Dados **desta** casa (frases e notas que estavam no código) | **Não copiar** |
| `apps/web/lib/pos/settings.ts` | Contrato: tipos, fábrica, resolver, limites, leitura (`fetchPosSettings`) e cache offline. Só depende de `@delivery/receipt` (o `printing`) | **Copiar** |
| `packages/receipt/` (`@delivery/receipt`) | O papel da casa: formatos do talão, modelos (`layout.ts`), ESC/POS (`encode.ts`), pré-visualização (`preview.ts`). Só depende de `@delivery/core` | **Copiar** o pacote inteiro |
| `supabase/migrations/…_1071_vias_do_talao_no_painel.sql` | RPC `set_store_ticket_copies` (vias por pedido) | **Copiar** (renumerar) |
| `apps/web/app/(admin)/definicoes-pos/print-section.tsx`, `ticket-preview.tsx` | Secção Impressão e o talão desenhado no ecrã | **Copiar** |
| `services/print-bridge/src/print-layout.ts` | O bridge lê o layout, aplica-o e guarda cópia em disco | **Copiar** |
| `services/print-bridge/src/escpos.ts`, `types.ts`, `config.ts`, `index.ts` | Adaptador para o pacote, re-export dos tipos, `printLayoutFile`, arranque da sincronização | Adaptar — ver §11.5 |
| `services/print-bridge/src/__tests__/talao-bytes.test.ts`, `print-layout.test.ts` | O papel byte a byte e a sincronização | **Copiar** — o retrato grava-se **antes** de trocar o formatador |
| `apps/web/lib/pos/notes.ts` | Atalhos de nota que somam (e tiram com segundo toque) | **Copiar** |
| `apps/web/lib/pos/__tests__/settings.test.ts`, `notes.test.ts` | Testes do contrato | **Copiar** |
| `apps/web/app/(admin)/definicoes-pos/page.tsx`, `step-products.tsx` | A aba do painel e o selector de produtos do upsell | **Copiar** (ajustar cores se o painel for outro) |
| `packages/db/tests/pos-settings.test.ts` | Isolamento entre lojas, perfis, auditoria | **Copiar** |
| `e2e/definicoes-pos.spec.ts` | Dono grava pelo painel e a BD fica certa | **Copiar** |
| `apps/web/app/(admin)/layout.tsx` | Entrada `POS` no menu + ícone | Adaptar (2 linhas) |
| `apps/web/app/(pos)/pos/pos-shell.tsx` | O POS a usar as definições | Adaptar — ver §6 |
| `apps/web/app/(pos)/pos/touch-keyboard.tsx` | Sugestões do teclado somam | Adaptar (usa `notes.ts`) |
| `apps/web/app/(pos)/pos/use-new-order-alert.ts` | 3.º parâmetro `sound` | Adaptar |
| `apps/web/lib/pos/pos-upsell.ts`, `upsell-scripts.ts` | Funil aceita `steps` da loja; `pickScript` | Adaptar |

> **Rota:** a aba é `/definicoes-pos` e não `/pos-…` de propósito — o service worker do POS
> (`public/pos-sw.js`) trata qualquer caminho que comece por `/pos` como POS.

---

## 5. Levar para outro projecto — checklist

### 5.1 Pré-requisitos no projecto de destino
Confirmar antes de copiar (todos os projectos copiados do HAWSMASH já os têm):

- [ ] Tabela `public.stores (id uuid)`.
- [ ] Helpers `private.auth_role()` e `private.auth_can_store(uuid)`. Se tiverem outro nome, trocar
      na 1067 — são as **únicas** dependências de segurança.
- [ ] Tabela `public.event_log (store_id, actor_user_id, type, payload)`.
- [ ] Perfis `owner` / `manager` / `cashier` em `staff_profiles`.
- [ ] Cliente Supabase em `@/utils/supabase/client` e alias `@/lib/...`.
- [ ] **Para a Impressão:** o talão completo em vias (migrations 1062–1064, `stores.kitchen_ticket_copies`)
      e o print-bridge deste repositório. Sem isso, copiar só a parte do ecrã do POS e deixar a §11 de fora.

### 5.2 Passos
1. **Copiar** os ficheiros marcados "Copiar" na §4.
2. **Renumerar a migration** para o próximo número livre do destino (`1NNN_definicoes_do_pos.sql`), com
   timestamp posterior à última migration de lá. Não mudar o conteúdo.
3. **Manter os grants** da 1067. Esta família de projectos não dá privilégios por omissão a tabelas
   novas — sem eles até a leitura com policy falha (`permission denied for table`). Num projecto que
   dê, os grants são inofensivos.
4. **Menu do painel:** acrescentar `{ href: '/definicoes-pos', label: 'POS', icon: 'pos', roles: ['owner', 'manager'] }`
   e o ícone `pos` no `layout.tsx` do admin.
5. **Ligar o POS** (§6). É a única parte que depende de como o ecrã de venda do destino foi escrito.
6. **Dados da casa:** se o destino tinha notas/frases escritas no código, há duas saídas:
   - poucas lojas → deixar a fábrica e preencher na aba POS depois do deploy (preferível);
   - muitas lojas → uma migration de dados como a 1068, **guardada pela marca** (`where exists (select 1 from brand_settings where name ilike '<marca>%')`)
     e com `on conflict do nothing`, para nunca pisar o que o dono já gravou.
7. **Staging primeiro** (§2 do CLAUDE.md): aplicar a migration no staging, correr os testes (§8) e o e2e.
8. **Verificar no terminal real:** mudar uma frase na aba POS, esperar até 2 min (ou bloquear e
   desbloquear o POS) e confirmar no ecrã do balcão.
9. **Impressão (§11.5):** gravar o retrato de bytes do bridge do destino **antes** de trocar o
   formatador, trocar, confirmar que o retrato não mudou, gerar o `.exe` e instalá-lo em cada loja fora
   do horário. Por fim, imprimir um talão de cada modelo em papel.

---

## 6. Pontos de integração no POS

O que o ecrã de venda tem de fazer. No HAWSMASH está tudo em `pos-shell.tsx`.

```ts
// Estado — arranca na fábrica; a da loja chega a seguir.
const [posSettings, setPosSettings] = useState<PosSettings>(FACTORY_POS_SETTINGS);
const payMethods = useMemo(() => enabledPaymentMethods(posSettings), [posSettings]);
const quickNotes = posSettings.quickNotes;

// Ao arrancar: cache primeiro (offline), depois a BD.
const cached = readCachedPosSettings(localStorage, storeSlug);
if (cached) setPosSettings(cached);
const lidas = await fetchPosSettings(supabase, storeId);   // nunca lança; null = fica o que está
if (lidas) { setPosSettings(lidas); writeCachedPosSettings(localStorage, storeSlug, lidas); }
// …e o mesmo no refresh periódico do cardápio (MENU_REFRESH_MS = 2 min).
```

| Onde | Antes (no código) | Depois |
|---|---|---|
| Botões de pagamento | `const METHODS = [...]` | `payMethods` (ligados, pela ordem e com o nome da loja) |
| "Pagamento misto" | sempre visível, `['cash','mpesa']` | só se `allowMixed && payMethods.length >= 2`; usa os 2 primeiros ligados |
| Meio desligado a meio | — | efeito que volta a um só meio e limpa as parcelas |
| Notas rápidas | `const NOTAS_RAPIDAS = [...]` | `quickNotes` (teclado + nota do artigo), a somar com `toggleNoteChip` |
| Funil de upsell | `settings.upsell_enabled` global + frases no código | `buildPosUpsellFunnel({ enabled: posSettings.upsell.enabled, steps: posSettings.upsell.steps, … })` |
| Tipo de pedido | `'counter'` fixo | `posSettings.cart.defaultFulfillment`, só se o canal estiver disponível (`canalPermitido`) |
| Nome/telefone no balcão | sempre | `posSettings.cart.askCustomerOnCounter` |
| Ecrã "venda registada" | `3000` ms | `posSettings.sale.confirmationSeconds * 1000` — **só em vendas sem dinheiro**. Com dinheiro o ecrã mostra o troco gravado pelo servidor e só sai com OK (`lib/pos/sale-confirmation.ts`) |
| Alarme de pedido novo | sempre | `useNewOrderAlert(storeId, boardOpen, posSettings.alerts.newOrderChime)` |

---

## 7. Acrescentar uma definição nova

Por esta ordem — e sem migration:

1. **`settings.ts`:** o campo no tipo `PosSettings`, o valor em `FACTORY_POS_SETTINGS`, a linha no
   `resolvePosSettings` (tolerante: valor inválido → fábrica) e, se for texto, um limite em `POS_LIMITS`.
2. **Teste** em `settings.test.ts`: lixo nesse campo cai na fábrica sem levar os outros.
3. **Painel:** o controlo em `definicoes-pos/page.tsx`.
4. **POS:** usar `posSettings.<campo>` no ecrã.
5. **Este documento:** a linha na tabela da §1.

Se a definição for algo que o **servidor tem de impor** (preço, taxa, quem pode anular), não é uma
definição do POS — é uma coluna com RPC e teste de RLS (Regra 2).

---

## 8. Testes

```bash
# contrato e notas (sem base de dados)
pnpm --filter web exec vitest run lib/pos/__tests__/settings.test.ts lib/pos/__tests__/notes.test.ts lib/pos/__tests__/pos-upsell.test.ts

# isolamento entre lojas, perfis e auditoria (Supabase local a correr)
cd packages/db && npx vitest run tests/pos-settings.test.ts

# e2e da aba (contra o staging, como o resto da suite)
npx playwright test e2e/definicoes-pos.spec.ts
```

---

## 9. Formato gravado

Exemplo de `store_pos_settings.config` (todas as chaves são opcionais):

```json
{
  "payments": {
    "methods": [
      { "id": "cash", "enabled": true, "label": "Dinheiro" },
      { "id": "mpesa", "enabled": true, "label": "M-Pesa" },
      { "id": "emola", "enabled": true, "label": "e-Mola" },
      { "id": "credit_card", "enabled": false, "label": "Cartão" }
    ],
    "allowMixed": true
  },
  "upsell": {
    "enabled": true,
    "steps": {
      "companion": {
        "enabled": true,
        "title": "Falta acompanhar?",
        "scripts": ["Qual bebida vai levar?"],
        "productIds": ["<id do menu_item>", "<id do menu_item>"]
      },
      "dessert": { "enabled": false, "title": "E para fechar?", "scripts": [], "productIds": [] }
    }
  },
  "quickNotes": ["SEM CEBOLA", "SEM MOLHO", "PARA LEVAR"],
  "cart": { "defaultFulfillment": "counter", "askCustomerOnCounter": true },
  "sale": { "confirmationSeconds": 3 },
  "alerts": { "newOrderChime": true },
  "printing": {
    "templates": { "controlo": "completo", "cliente": "cozinha", "cozinha": "completo" },
    "show": { "logo": true, "storeContacts": true, "thanks": true, "qr": true, "footer": true },
    "bigItems": true
  }
}
```

Os `id` de pagamento são fechados (`cash`, `mpesa`, `emola`, `credit_card`) — são os que
`create_counter_sale` aceita. Um meio que falte na lista entra no fim, **desligado**.

---

## 10. Problemas comuns

| Sintoma | Causa | O que fazer |
|---|---|---|
| Mudei no painel e o POS não mudou | O POS lê a cada 2 min | Esperar, ou bloquear e desbloquear o POS |
| POS sem rede não vê a mudança | Offline usa a última cópia guardada | Normal; actualiza quando a rede voltar |
| `permission denied for table store_pos_settings` | Faltam os grants | Ver §5.2 passo 3 |
| `pos_settings_denied` | Quem tenta não é dono nem gerente **dessa** loja | Aba Equipa |
| "Quem tirou o cartão do POS?" | — | `event_log` onde `type = 'store.pos_settings_changed'` |
| Mudei o modelo do talão e o papel não mudou | O mini-PC lê a cada minuto, ou tem o programa antigo | Esperar 1 min; ver no log do bridge `[Layout] Talão actualizado`; se nunca aparecer, actualizar o `.exe` (§11.5) |
| O talão saiu no modelo errado depois de um corte de rede | Sem rede o bridge usa a última cópia (`data/print-layout.json`) | Normal; corrige-se sozinho quando a rede volta |
| "Quem mudou as vias?" | — | `event_log` onde `type = 'store.ticket_copies_changed'` |

---

## 11. Impressão (talão)

Decisão: [ADR 0007](decisions/0007-modelos-do-talao.md). Contrato: `packages/receipt`.

### 11.1 O que se escolhe

| | Onde vive | Quem aplica |
|---|---|---|
| **Vias por pedido** (1, 2 ou 3) | `stores.kitchen_ticket_copies` — RPC `set_store_ticket_copies` (1071) | A base de dados, ao criar os trabalhos de impressão |
| **Modelo de cada via** e **blocos do Completo** | `store_pos_settings.config.printing` | O print-bridge, ao montar o papel |

| Modelo | Leva | Para quê |
|---|---|---|
| **Completo** | Tudo, como sempre: logo, morada, senha, cliente, tipo, horário, artigos com preço, nota, totais, pagamento, agradecimento, QR, rodapé | O papel da casa (valor de fábrica) |
| **Compacto** | Senha, cliente, tipo, horário, artigos com preço em letra normal, totais, pagamento, rodapé. Sem logo, morada, agradecimento nem QR | Menos papel, o dinheiro todo |
| **Cozinha** | Senha, cliente, tipo, entrega, horário, artigos e notas a dobrar, nota do pedido. **Sem preços nem pagamento** | A via que fica na cozinha |

- Com **1 via**, sai um talão sem rótulo; com **2**, controlo (balcão) + cliente (cozinha); com **3**,
  mais a via da cozinha. A via única e a **reimpressão** usam o modelo da via de controlo.
- Os interruptores (logo, morada e telefone, agradecimento, QR, rodapé, artigos em letra alta) afinam
  **só o Completo**. O Compacto e o Cozinha são fixos — é o que os mantém testados.
- **Não mudam:** a comanda curta e o talão curto (mesa e POS sem rede), o fecho de caixa e a gaveta.

### 11.2 Como chega ao papel

```
Aba POS ──save_pos_settings──▶ store_pos_settings.config.printing
                                            │
print-bridge (mini-PC) ◀── lê ao arrancar e a cada 60 s ──┘
     ├─ guarda cópia em data/print-layout.json (sem rede, e depois de reiniciar sem rede)
     └─ buildFullTicket(payload, layout) → encodeEscPos → impressora
Painel: buildFullTicket(exemplo, layout) → renderPreview → o talão desenhado no ecrã
```

O mesmo código (`buildFullTicket`) desenha o papel e a pré-visualização: o que o dono vê é o que sai.
Um erro a ler o layout nunca pára a impressão — fica o que estava; sem nada, o de fábrica.

### 11.3 A garantia do papel de sempre

`services/print-bridge/src/__tests__/talao-bytes.test.ts` guarda os **bytes** de 9 formatos, gravados
antes de os modelos existirem. Com o layout de fábrica têm de sair iguais — no CI e em qualquer cópia
deste módulo. Se um mudar de propósito, actualiza-se o retrato **e** imprime-se em papel.

### 11.4 Acrescentar um modelo novo

1. `packages/receipt/src/layout.ts`: o nome em `TicketTemplate`, a descrição em `TICKET_TEMPLATES` e o
   valor aceite em `resolvePrintLayout`.
2. `packages/receipt/src/tickets.ts`: o que leva, em `optionsFor` (ou um ramo próprio em `buildFullTicket`).
3. Testes em `packages/receipt/src/__tests__/layout.test.ts` — o que sai e o que **não** sai.
4. Imprimir em papel antes de o oferecer às lojas. O painel mostra-o sozinho (lê `TICKET_TEMPLATES`).

### 11.5 Levar o mini-PC para esta versão

1. No repositório: `BRAND_LOGO_FILE=/nao/existe.b64 npx vitest run services/print-bridge` verde
   (o logo local muda os bytes; o CI não o tem).
2. Gerar o `.exe` (`services/print-bridge/README.md`) e trocá-lo **fora do horário** (Qui–Sáb as lojas
   estão abertas), como em `docs/INSTRUCOES-POS-MAPUTO.md`. O `.env` e o `brand-logo.b64` ficam.
3. No arranque, o log mostra a leitura do layout; `data/print-layout.json` aparece ao lado do `.env`.
4. Imprimir um pedido de teste e comparar com a pré-visualização da aba POS.

Um mini-PC que ainda não foi actualizado ignora o layout e imprime o Completo — dá para actualizar
loja a loja, sem pressa de fazer as duas no mesmo dia.
