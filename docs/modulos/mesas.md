# Mesas, QR e conta aberta

O módulo junta pedidos feitos pelo QR e pedidos lançados pelo operador na mesma mesa da mesma loja. A cozinha recebe o pedido antes do pagamento; a conta é liquidada no fim. Existe no código actual, embora a delimitação inicial da Fase 1 deixasse `dine_in` preparado para depois. Essa história de planeamento não deve ser lida como ausência da implementação das migrations 1081/1092.

## Perfis e canais

O dono cria, activa/desactiva e remove mesas em `/mesas`. A equipa autorizada lê as mesas da sua unidade; operações de lançamento e cobrança no POS verificam o dispositivo, utilizador e loja. O cliente público resolve um QR por token, através de RPC; não recebe acesso directo à tabela.

O número é único dentro da loja: mesa 2 de uma unidade é diferente da mesa 2 da outra. `get_table_by_token(p_token)` devolve a mesa activa e a sua loja. O pedido do QR tem de pertencer à mesma unidade. Sem rede, mesas não funcionam como conta local offline; o balcão pode continuar no percurso offline próprio do [POS](pos.md).

## Lançar e acompanhar

1. `pos_table_overview(p_device_id)` devolve as mesas e contas da loja vinculada.
2. O operador escolhe a mesa, prepara o carrinho e chama `launch_table_order(p_payload)` com `clientSaleId`, `deviceId`, `tableId` e escolhas de itens.
3. A BD calcula o preço da loja, variantes e adicionais; atribui senha/número; grava `flow`, canal e fulfillment `dine_in`, estado `in_preparation` e pagamento `no_payment`.
4. Produto final e ingredientes baixam na mesma transacção. Falta de stock reverte o lançamento; repetição da chave não deve criar outro consumo.
5. A comanda entra na fila de impressão e o pedido segue para a cozinha. Falha do papel é registada como efeito auxiliar e não elimina o pedido.

A conta aberta usa uma definição comum: pedidos da mesa e loja **criados desde o início do dia em Africa/Maputo**, ainda sem `table_bill_id`, em preparação/prontos/entregues. Não é a soma de toda a dívida histórica. Contas não liquidadas antes da mudança de dia requerem atenção operacional; não desaparecem dos dados por deixarem de aparecer na conta corrente.

Desde a 1092, o nome é da conta aberta, não um atributo permanente da mesa. Um nome introduzido num pedido é herdado pelos seguintes da mesma conta, incluindo o QR. O pedido guarda `Mesa N · Nome`; o cartão mostra esse nome. Depois de fechar, a próxima conta não deve herdar a anterior.

## Liquidar a conta

`close_table_bill(p_payload)` recebe `clientCloseId`, dispositivo, mesa, `expectedTotalCents`, parcelas de pagamento e dinheiro recebido quando aplicável. O total esperado do cliente é apenas uma comparação de concorrência: o servidor soma os pedidos, não adopta esse valor como preço.

A RPC bloqueia a conta durante a operação. Se outro pedido entrou desde que o operador abriu o pagamento, devolve `table_bill_changed` para recarregar e rever. Duas caixas a fechar a mesma mesa não devem criar duas contas; repetir `clientCloseId` recupera o fecho existente autorizado para a loja.

O fecho grava `table_bills`, liga os pedidos por `table_bill_id`, reparte os pagamentos pelos pedidos e calcula troco no servidor. Essa repartição alimenta a caixa por método sem voltar a cobrar ou descontar o stock. A impressão da conta completa e a gaveta quando há dinheiro são efeitos associados. Conta por pagar não entra como dinheiro contado no [fecho de caixa](caixa.md).

A versão actual exclui a anulação de uma conta já fechada como operação própria. Não usar apagamento de `table_bills`, pedidos ou pagamentos como “correcção”; documentar o caso e seguir um procedimento autorizado.

## Papel e senha

A 1092 usa `stores.kitchen_ticket_copies` para imprimir a comanda nas vias da loja e acrescenta uma senha pequena no balcão. A comanda mantém o formato herdado de mesa, artigos por pessoa e indicação de pagamento posterior; o novo payload de senha inclui loja, mesa, nome, senha e número do pedido. Um bridge anterior ao formato pequeno pode imprimir a representação legada maior. A conta liquidada usa o talão completo com pagamentos e troco.

Ver [Impressão](impressao.md) para layout, destino de vias e diferença entre job idempotente e garantia física de exactamente um papel. O layout dos talões completos não converte automaticamente todas as comandas legadas de mesa num modelo diferente.

## Dados, RPCs, ficheiros e eventos

| Área | Fontes |
|---|---|
| Mesas | `tables`: loja, número, token e activo; gestão em [mesas-section.tsx](../../apps/web/app/(admin)/mesas-section.tsx) |
| Conta | `table_bills`: chave única de fecho, dispositivo, pedidos, total, pagamentos, recebido/troco, operador e data |
| Pedido | `orders.table_id`, `orders.table_bill_id`, `order_items`; numeração e stock comuns |
| POS | [mesas-tab.tsx](../../apps/web/app/(pos)/pos/mesas-tab.tsx), [tables.ts](../../apps/web/lib/pos/tables.ts) e chamadas em [pos-shell.tsx](../../apps/web/app/(pos)/pos/pos-shell.tsx) |
| SQL | [1081 mesas](../../supabase/migrations/20260924060000_1081_mesas_no_balcao.sql), [1092 nome/senha](../../supabase/migrations/20260925110000_1092_mesa_com_nome_e_senha.sql) |
| Integração pública | `create_order`, `get_table_by_token`, ligação do QR à loja e hook `private.after_qr_table_order` |

Eventos de operação incluem `table.order_launched`, `table.bill_closed`, `print.table_comanda_queued`, `print.table_senha_queued`, `print.table_comanda_failed` e `print.table_bill_failed`. A gestão do painel usa mutações directas à tabela `tables`, protegidas por RLS; não inventar uma RPC `save_table` ou prometer um evento de configuração que esse caminho não grava. As chamadas de update/delete do painel filtram por ID; o âmbito depende também da policy e merece leitura conjunta com a [auditoria](../AUDITORIA-DOCUMENTACAO.md).

## Testes, limites e decisões

[mesas.test.ts](../../packages/db/tests/mesas.test.ts) cobre o contrato de BD; [tables.test.ts](../../apps/web/lib/pos/__tests__/tables.test.ts) cobre o adaptador do POS; [caixa.test.ts](../../apps/web/lib/pos/__tests__/caixa.test.ts) cobre o aviso de contas abertas; [senha.test.ts](../../packages/receipt/src/__tests__/senha.test.ts) cobre o novo papel. Não foram executados nesta redocumentação.

[ADR 0001](../decisions/0001-multi-unidade.md) rege a loja; [ADR 0007](../decisions/0007-modelos-do-talao.md) rege os modelos completos, sem apagar as excepções de mesas. As migrations de dados 1082/1093 pertencem à instalação; não são um número universal de mesas para outro restaurante. Consultar B-006 e o estado dos ensaios em [BLOQUEIOS](../../BLOQUEIOS.md). A conta corrente por dia, a ausência de operação de estorno de conta e o requisito de rede são limites existentes, não novas regras decididas por esta documentação.
