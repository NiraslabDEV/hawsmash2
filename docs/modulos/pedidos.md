# Pedidos, aprovação e senhas

O pedido é o registo comum da encomenda online, venda de balcão e consumo em mesa. Tem loja, origem/canal, itens, estado operacional e referências financeiras. `/pedidos` é o painel de acompanhamento; o POS apresenta pedidos online e senhas. Documento baseado em leitura do código de 26 de Setembro de 2026, sem novo ensaio de runtime.

## Perfis e fluxos

O dono consulta todas as lojas; gerente, caixa e cozinha ficam sujeitos às lojas atribuídas. “Todas” serve a leitura consolidada: mutações devem referir uma encomenda e loja concretas. O caixa pode aprovar comprovativos no POS e marcar disponibilidade. A cozinha só avança preparação (em preparo → pronto → entregue); aprovar é de owner/manager/cashier; cancelar é de owner/manager, e do caixa só antes de haver dinheiro — imposto em `advance_order` pela 1097. A cozinha ainda lê valores (V-03, B-116). Ver a [auditoria §5.1](../AUDITORIA-DOCUMENTACAO.md).

| Origem | Percurso de referência |
|---|---|
| Online manual | `draft → awaiting_approval → approved → in_preparation → ready → delivered` |
| Online digital | `draft → awaiting_payment → paid → in_preparation → ready → delivered`; falha definitiva usa `payment_failed` |
| Balcão | Nasce pago; segue a preparação/chamada permitida pela RPC operacional |
| Mesa | É lançado antes de cobrar, segue para cozinha e liquida-se na conta da mesa; ver [Mesas](mesas.md) |

O estado muda por `advance_order(p_order_id,p_event,p_reason)` e pelas RPCs financeiras próprias, nunca por um `update orders.status` arbitrário no navegador. A anulação de venda passa por `void_sale`, preserva histórico e repõe os consumos segundo os movimentos gravados. Um timeout de pagamento não é uma falha definitiva; ver [Pagamentos](pagamentos.md).

O [`order-machine.ts`](../../packages/core/src/order-machine.ts) é um modelo puro herdado, coberto por testes, mas só contempla fluxos digital/manual e mantém perfis antigos. Não é o contrato completo do POS/mesas nem a autorização activa da BD. Para alterar regras, consultar a cadeia de migrations aplicada e os testes de integração, não apenas esse ficheiro.

## Leitura, paginação e realtime

[`get_orders(p_filters)`](../../supabase/migrations/20260913225235_1045_paginacao_pedidos.sql) serve filtros e paginação. O [painel](../../apps/web/app/(admin)/pedidos/page.tsx) e o [quadro POS](../../apps/web/app/(pos)/pos/orders-board.tsx) lêem a fonte novamente quando chega realtime; o payload do evento não deve montar um pedido incompleto. Há actualização periódica como recuperação quando realtime falha.

Os itens e metadados pertencem ao pedido da loja. O comprovativo vive no bucket privado `payment-proofs`; a visualização do painel usa `createSignedUrl` com validade limitada, não URL pública. Aprovar/recusar envia efeitos auxiliares de email/tracking depois da operação principal. Falhar esses efeitos não deve esconder nem reverter o pedido.

Não inferir que uma página ou uma consulta sem paginação representa o histórico completo. B-105 conserva a validação da paginação na instalação; [orders-pagination.spec.ts](../../e2e/orders-pagination.spec.ts) usa a configuração Playwright isolada e não é incluído pelo comando E2E predefinido.

## Alterações e chamada

`update_order_details` permite corrigir morada e horário com autorização, motivo/identificação da operação conforme o contrato SQL. Não é um editor livre de preços ou pagamentos. A [migration 1072](../../supabase/migrations/20260924000000_1072_alterar_morada_e_hora.sql) grava `order.address_changed` e `order.schedule_changed` e prepara papel de alteração (`print.change_job_queued`) quando aplicável. O [adaptador POS](../../apps/web/lib/pos/order-edit.ts) traduz os dados e erros do fluxo.

`reprint` cria uma nova via auditada e marcada como reimpressão. A impressão original e as suas tentativas não devem ser confundidas com uma reimpressão deliberada.

`orders.order_number` identifica o histórico com prefixo da loja; `daily_number` identifica a senha do dia da loja. A [migration 1076](../../supabase/migrations/20260924010000_1076_senhas_no_balcao.sql) acrescenta `call_ticket(p_store_id,p_daily_number)` e actualiza `get_store_queue`. A [aba Senhas](../../apps/web/app/(pos)/pos/senhas-tab.tsx) e as TVs consomem esse circuito; guardar UTC e apresentar/calcular o dia em `Africa/Maputo` evita misturar a numeração entre dias e unidades.

## Dados, RPCs e ficheiros

| Responsabilidade | Fonte |
|---|---|
| Registo | `orders`, `order_items`, `order_counters`; numeração por loja |
| Dinheiro | `payments`; conta de mesa em `table_bills`; [Pagamentos](pagamentos.md) |
| Operação | `event_log`, `print_jobs`, movimentos de stock; [Estoque](estoque.md) e [Impressão](impressao.md) |
| Site | [`/api/create-order`](../../apps/web/app/api/create-order/route.ts), [`/api/order-status/[orderId]`](../../apps/web/app/api/order-status/[orderId]/route.ts), [`/api/attach-proof`](../../apps/web/app/api/attach-proof/route.ts) |
| Painel | [pedidos/page.tsx](../../apps/web/app/(admin)/pedidos/page.tsx); `get_orders`, `get_order_stats`, `advance_order`, `reprint` |
| POS | [order-decision.tsx](../../apps/web/app/(pos)/pos/order-decision.tsx), [online-orders-tab.tsx](../../apps/web/app/(pos)/pos/online-orders-tab.tsx), [delivery-orders.ts](../../apps/web/lib/pos/delivery-orders.ts) |

Auditoria de criação/transição, aprovação, anulação e alterações deve permitir recuperar autor e loja. Os eventos globais ou de serviço não têm necessariamente um operador humano; não atribuir a uma pessoa um evento com `actor_user_id` nulo.

## Verificação e limites

Testes de BD: [pos-pedidos-online](../../packages/db/tests/pos-pedidos-online.test.ts), [alterar-pedido](../../packages/db/tests/alterar-pedido.test.ts), [senhas](../../packages/db/tests/senhas.test.ts), [mesmo-produto-varias-linhas](../../packages/db/tests/mesmo-produto-varias-linhas.test.ts), [RLS](../../packages/db/tests/rls.test.ts). Testes puros do POS cobrem quadros, alertas, alterações e senhas. A [auditoria](../AUDITORIA-DOCUMENTACAO.md) separa implementação, divergências e o que não foi executado.

[ADR 0001](../decisions/0001-multi-unidade.md) rege o isolamento; [ADR 0007](../decisions/0007-modelos-do-talao.md) rege o papel. Confirmar B-105 e as dependências de pagamento/hardware em [BLOQUEIOS](../../BLOQUEIOS.md). A presença de um pedido pago com impressão pendente é possível e deve ser tratada no painel; falha do papel não autoriza voltar a cobrar.

---

## Contrato preservado da spec

Este diagrama é a intenção original. O módulo acima enumera estados/eventos efectivos, incluindo mesas já implementadas. O diagrama resumido não é uma tabela exaustiva das transições actuais.

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
