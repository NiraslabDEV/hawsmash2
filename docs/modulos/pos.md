# POS de balcão

O POS é a PWA touch de `/pos`, vinculada a uma loja e operada com a sessão individual de cada pessoa. Regista vendas, acompanha pedidos online, chama senhas e dá acesso à caixa e às mesas. Este documento descreve o código auditado em 26 de Setembro de 2026; a existência de código e testes não prova a instalação nem o funcionamento no equipamento real.

## Perfis e entrada

`cashier`, `manager` e `owner` operam o balcão dentro do acesso à loja. O dono tem acesso global; o terminal continua vinculado à sua unidade. `kitchen` não recebe permissões financeiras por conseguir ver um cartão na entrada. A autorização efectiva está nas RPCs, não nos botões.

O vínculo usa `bind_pos_device`. A entrada corrente apresenta `pos_login_cards` e envia cartão/PIN a [`POST /api/pos/login`](../../apps/web/app/api/pos/login/route.ts). O servidor verifica `pos_login_with_pin` e cria uma sessão Supabase da pessoa. Email/palavra-passe continuam a servir o vínculo e a configuração inicial do PIN. `set_own_pos_pin`, `pos_pin_status`, `lock_pos_device` e `unlock_pos_device` completam esse ciclo. O PIN tem 4–6 dígitos; falhas repetidas activam espera crescente. O bloqueio por inactividade é uma definição da loja (Definições → POS → "Bloquear o POS sem uso", `session.lockAfterMinutes`): de fábrica **nunca** desde 30/09 — a pessoa entra uma vez e fica o turno inteiro; o POS volta aos cartões no botão Bloquear ou na troca de turno. A loja pode escolher 5, 15, 30 ou 60 minutos ([session.ts](../../apps/web/lib/pos/session.ts)). Com alguém no POS, o ecrã fica ligado (Screen Wake Lock, [use-screen-wake-lock.ts](../../apps/web/app/(pos)/pos/use-screen-wake-lock.ts)); nos cartões, o Windows volta a decidir.

Detalhes de acesso, criação e revogação estão em [Equipa](equipa.md). Uma primeira entrada ou troca de utilizador não deve ser descrita como autenticação offline: a rota de login depende de Supabase Auth.

## Venda e degradação

1. O terminal lê `get_menu` da sua loja, categorias, variantes, adicionais e disponibilidade. A cache é actualizada à entrada e a cada 15 segundos; o ADR 0006 fixa dois minutos, divergência V11 da auditoria.
2. O operador monta o carrinho, escolhe balcão/levantamento/entrega, notas e cliente quando aplicável. Os extras pertencem à linha concreta: separar uma unidade de uma linha múltipla evita aplicar o extra a todas.
3. O pagamento admite dinheiro, M-Pesa, e-Mola, cartão e parcelas mistas. O POS calcula uma pré-visualização do troco; o servidor recalcula e grava o resultado definitivo. Registar M-Pesa no balcão não é chamar automaticamente a API do fornecedor.
4. A venda online chama `create_counter_sale(p_payload)`, com `clientSaleId`, dispositivo, IDs/quantidades/escolhas e pagamentos. A BD valida loja/perfil, recalcula preços, consome stock e ficha técnica, grava pedido/pagamentos e prepara impressão. A mesma chave recupera a venda existente.
5. A confirmação mostra a senha e os valores devolvidos. Com dinheiro, o troco fica visível até OK; nas restantes vendas aplica-se o tempo configurado. Impressora, email, visor e tracking são efeitos auxiliares.
6. Sem rede, só o balcão usa a fila IndexedDB. Guarda primeiro a venda e tenta imprimir/abrir gaveta pela LAN. Entrega e mesas precisam de servidor. O estado indica quantas vendas aguardam sincronização.
7. A reconexão chama **`sync_counter_sale`**, não apenas `create_counter_sale`. A RPC compara a venda offline com o preço actual, assinala divergências para revisão e reconhece as vias já impressas. A fila remove a entrada apenas após sucesso; as falhas conservam a entrada e repetem com espera crescente até 60 segundos.

Fontes: [pos-shell.tsx](../../apps/web/app/(pos)/pos/pos-shell.tsx), [offline-store.ts](../../apps/web/lib/pos/offline-store.ts), [offline-sales.ts](../../apps/web/lib/pos/offline-sales.ts), [offline-sync.ts](../../apps/web/lib/pos/offline-sync.ts) e [migration 1065](../../supabase/migrations/20260923190000_1065_sync_offline_reconhece_via_de_controlo.sql). Offline usa preços e disponibilidade em cache, não conhece o stock actual e depende de os dados locais do navegador permanecerem disponíveis.

## Definições da loja

`/definicoes-pos` configura o ecrã através de `store_pos_settings.config`, uma linha JSON por loja. `owner` e `manager` da loja escrevem por `save_pos_settings`; a equipa autorizada lê por `get_pos_settings`. Os números das carteiras continuam em Lojas. O upsell online continua nas definições próprias do site.

| Secção | Contrato e comportamento |
|---|---|
| `payments` | Quatro IDs fechados: `cash`, `mpesa`, `emola`, `credit_card`; nome, ordem, activo e `allowMixed`. Um meio omitido reaparece desligado; se todos estiverem desligados, o resolver conserva dinheiro. |
| `upsell` | Ligado/desligado e passos `extras`, `companion`, `dessert`; cada passo tem título, frases, estado e lista ordenada `productIds`. Lista vazia usa os produtos marcados no Cardápio. Ignora produtos apagados, esgotados ou já no carrinho. |
| Extras | Usa `menu_addons` do produto, nunca um preço inventado na configuração. O passo só aparece quando há adicionais elegíveis; separa a unidade alterada numa linha própria. |
| `quickNotes` | Atalhos de artigo e pedido somam-se; um segundo toque retira o atalho. |
| `cart` | Canal inicial e pedido de nome/telefone no balcão. Canal indisponível ou offline cai em balcão. |
| `sale` | Confirmação de 1–15 segundos, por omissão 3; dinheiro exige OK. |
| `session` | `lockAfterMinutes`: minutos sem toques até voltar aos cartões e pedir o PIN; 0 = nunca (fábrica), tecto 240. Valor estragado ou negativo cai em nunca, não num bloqueio instantâneo. Lojas que gravaram antes do campo ficam com o de fábrica. |
| `alerts` | Som do pedido novo. Desligar o som conserva o aviso visual. |
| `printing` | Modelos por via e interruptores do talão completo. O número de vias fica separado, em `stores.kitchen_ticket_copies`. Ver [Impressão](impressao.md). |

[settings.ts](../../apps/web/lib/pos/settings.ts) contém tipos, `FACTORY_POS_SETTINGS`, `POS_LIMITS`, `resolvePosSettings`, leitura e cache. O resolver aplica fábrica campo a campo; lixo num campo não apaga os restantes. `fetchPosSettings` mantém cache/fábrica quando falha. A última configuração é guardada em `localStorage` por loja. O painel grava o objecto resolvido inteiro e o POS relê-o com o menu.

Estas escolhas são apresentação. Esconder um pagamento não pode impedir a sincronização de uma venda anterior. Preços, taxas, permissões e estado financeiro continuam a ser regras do servidor. `event_log` regista `store.pos_settings_changed`, autor, loja e secções alteradas.

## Dados e integrações

| Área | Tabelas/RPCs principais |
|---|---|
| Terminal e equipa | `devices`, `staff_profiles`, `staff_stores`; vínculo, PIN, login e bloqueio |
| Catálogo | `menu_items`, variantes/adicionais, `store_items`; `get_menu` |
| Venda | `orders`, `order_items`, `payments`; `create_counter_sale`, `sync_counter_sale`, `void_sale` |
| Pedidos online | `get_orders`, `advance_order`, `update_order_details`, `reprint`; [Pedidos](pedidos.md) |
| Caixa/mesas | RPCs próprias descritas em [Caixa](caixa.md) e [Mesas](mesas.md) |
| Papel/stock | `print_jobs`, movimentos de stock e ingredientes, `event_log` |

Eventos relevantes incluem `counter.sale_created`, `pos.login`, `pos.login_failed` e os eventos de configuração. A anulação exige autorização e motivo; não apaga a venda. Os estados da BD são a autoridade: o modelo exportado por `packages/core/src/order-machine.ts` é herdado e não descreve sozinho o POS actual.

## Manutenção e portabilidade

Para acrescentar uma preferência: alterar o tipo/fábrica/resolver em `settings.ts`, escrever o teste de valor inválido, acrescentar controlo no painel e consumidor no POS. Só uma preferência tolerante dispensa migration; uma regra imposta pelo servidor exige schema/RPC/teste próprios.

Para copiar o módulo, confirmar `stores`, `event_log`, perfis e helpers `private.auth_role`/`private.auth_can_store`; transportar a [migration 1067](../../supabase/migrations/20260923210000_1067_definicoes_do_pos.sql) com grants, o contrato, notas, funil, painel e testes. Renumerar no destino e validar primeiro em staging. **Não copiar os dados de cliente da 1068.** A rota fica `/definicoes-pos`: o service worker trata caminhos iniciados por `/pos` como POS. Integrar cache antes da leitura de rede, refresh periódico, pagamentos mistos, limpeza de parcelas quando um método desaparece, som, notas e confirmação. Para impressão, transportar também `@delivery/receipt`, a RPC de vias e o bridge compatível, conservando o retrato de bytes anterior.

## Testes, limites e decisões

Os testes unitários estão em [lib/pos/__tests__](../../apps/web/lib/pos/__tests__). Cobrem carrinho, troco, configuração, cache/menu offline, sincronização, impressão local, sessão, confirmação, pedidos, senhas, caixa e mesas. Os testes de BD incluem [pos.test.ts](../../packages/db/tests/pos.test.ts), [pos-card-login.test.ts](../../packages/db/tests/pos-card-login.test.ts), [pos-settings.test.ts](../../packages/db/tests/pos-settings.test.ts) e [pos-pedidos-online.test.ts](../../packages/db/tests/pos-pedidos-online.test.ts). Há [E2E POS](../../e2e/pos.spec.ts) e [E2E definições](../../e2e/definicoes-pos.spec.ts). `pnpm test` na raiz não inclui as suites de `packages/db/tests`; o gate de BD é separado. Resultados unitários na [validação documental](../validation/revisao-documental-2026-09-26.md); SQL, E2E e hardware não foram executados.

Decisões: [ADR 0001](../decisions/0001-multi-unidade.md), [ADR 0006](../decisions/0006-definicoes-do-pos-por-loja.md) e [ADR 0007](../decisions/0007-modelos-do-talao.md). Consultar o estado actual de B-003, B-004, B-006, B-018 e B-110 em [BLOQUEIOS](../../BLOQUEIOS.md), sem deduzir resolução a partir do código. As divergências encontradas nesta passagem estão na [auditoria](../AUDITORIA-DOCUMENTACAO.md).


## Integração e portabilidade — detalhes

Conteúdo consolidado do guia anterior de definições do POS. Os ensaios relatados são históricos; não foram repetidos em hardware nesta revisão.

## 4. Ficheiros

| Ficheiro | Papel | Noutro projecto |
|---|---|---|
| `supabase/migrations/20260923210000_1067_definicoes_do_pos.sql` | Tabela, RLS, grants, `get_pos_settings`, `save_pos_settings` | **Copiar** (renumerar) |
| `supabase/migrations/20260923210500_1068_definicoes_do_pos_desta_instalacao.sql` | Dados **desta** casa (frases e notas que estavam no código) | **Não copiar** |
| `apps/web/lib/pos/settings.ts` | Contrato: tipos, fábrica, resolver, limites, leitura (`fetchPosSettings`) e cache offline. Só depende de `@delivery/receipt` (o `printing`) | **Copiar** |
| `packages/receipt/` (`@delivery/receipt`) | O papel da casa: formatos do talão, modelos (`layout.ts`), ESC/POS (`encode.ts`), pré-visualização (`preview.ts`). Só depende de `@delivery/core` | **Copiar** o pacote inteiro |
| `supabase/migrations/20260923233000_1071_vias_do_talao_no_painel.sql` | RPC `set_store_ticket_copies` (vias por pedido) | **Copiar** (renumerar) |
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
8. **Verificar no terminal real:** mudar uma frase na aba POS, esperar pelo refresh de 15 s (ou bloquear e
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
// …e o mesmo no refresh periódico do cardápio (MENU_REFRESH_MS = 15 s; decisão original: 2 min).
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
3. **Painel:** o controlo em `apps/web/app/(admin)/definicoes-pos/page.tsx`.
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
      "extras": { "enabled": true, "title": "Algum extra no lanche?", "scripts": ["Quer adicionar algum extra no seu lanche?"], "productIds": [] },
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
| Mudei no painel e o POS não mudou | O POS lê a cada 15 s | Esperar, ou bloquear e desbloquear o POS |
| POS sem rede não vê a mudança | Offline usa a última cópia guardada | Normal; actualiza quando a rede voltar |
| `permission denied for table store_pos_settings` | Faltam os grants | Ver §5.2 passo 3 |
| `pos_settings_denied` | Quem tenta não é dono nem gerente **dessa** loja | Aba Equipa |
| "Quem tirou o cartão do POS?" | — | `event_log` onde `type = 'store.pos_settings_changed'` |
| Mudei o modelo do talão e o papel não mudou | O mini-PC lê a cada minuto, ou tem o programa antigo | Esperar 1 min; ver no log do bridge `[Layout] Talão actualizado`; se nunca aparecer, actualizar o `.exe` (§11.5) |
| O talão saiu no modelo errado depois de um corte de rede | Sem rede o bridge usa a última cópia (`data/print-layout.json`) | Normal; corrige-se sozinho quando a rede volta |
| "Quem mudou as vias?" | — | `event_log` onde `type = 'store.ticket_copies_changed'` |

---



---

## Contrato preservado da spec

O sincronizador chama `sync_counter_sale`; `create_counter_sale` no envio offline é o desenho anterior. O intervalo observado de menu/definições é 15 s; os 2 min abaixo continuam a ser a decisão do ADR 0006 (V11). Desconto no carrinho e atalhos F2/F9 não estão implementados. A inserção de impressão SQL do POS é protegida.

## 7. POS DE BALCÃO — o módulo novo

> Ecrã touch no balcão de cada loja. **Vender em menos de 15 segundos**, com a mão, sem teclado.

### 7.1 Fluxo
1. Operador entra pelo **seu cartão + PIN**: o ecrã mostra a grelha da equipa **daquela loja** e um
   teclado de números. O PIN certo abre a **sessão Supabase daquela pessoa** (nunca uma sessão do
   terminal) — é o que mantém cada venda assinada por quem a fez (§6). Email e palavra-passe ficam
   só para dois momentos: vincular o terminal e criar o primeiro PIN. O dispositivo já sabe a loja.
2. Grelha de categorias → produtos (alvos grandes, foto opcional, esgotado a cinzento e **não clicável**).
3. Carrinho lateral: quantidade ±, nota por item, remover, **descontos só com perfil ≥ manager**.
4. Tipo: **Balcão (comer/levar)** · **Delivery no balcão** (pede nome/telefone/zona) · **Levantamento**.
5. Pagamento: **Dinheiro** (teclado numérico → troco em ecrã grande) · **M-Pesa** · **e-Mola** · **Cartão**.
   Pagamento misto (dinheiro + móvel) é suportado no schema (`payments` N linhas por pedido).
6. **Finalizar** → grava, **imprime os dois talões completos** (VIA DE CONTROLO + VIA DO CLIENTE, §8.3), **abre a gaveta** (se dinheiro),
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
- **Entrar e render turno são o mesmo ecrã:** bloquear o POS devolve a grelha de cartões. Quem se ausentou
  volta ao seu turno com o seu PIN; quem rende toca no próprio cartão e a sessão passa a ser dele. O PIN
  errado tem travão (5 erros → espera que duplica até 15 min) — sem isso, quatro algarismos adivinham-se.
- Atalho físico opcional: tecla `F9` = abrir gaveta (com permissão), `F2` = repetir último talão.
- **Nunca** um `confirm()` do browser em fluxo de venda — diálogos próprios, grandes.

### 7.7 Definições do POS por loja (aba **POS**)
Meios de pagamento (ligados, nome, ordem, misto), upsell do balcão (passos, títulos, frases e produtos), notas
rápidas, tipo de pedido ao abrir, nome/telefone no balcão, segundos da confirmação e som de pedido
novo são **dados da loja** em `store_pos_settings` (1067), editados pelo `owner` ou pelo `manager`
da loja e registados em `event_log`. O POS lê-os com `resolvePosSettings` por cima do valor de
fábrica (`apps/web/lib/pos/settings.ts`), guarda a última cópia para offline e relê a cada 2 min.
São escolhas de **ecrã**, não regras de dinheiro: o servidor não as impõe. O upsell da loja online
continua em `settings`. Contrato, portabilidade e checklist de cópia:
[`docs/modulos/pos.md`](pos.md) · [ADR 0006](../decisions/0006-definicoes-do-pos-por-loja.md).
