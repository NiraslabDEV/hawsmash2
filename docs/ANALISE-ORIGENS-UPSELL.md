# Análise por origem e upsells

## Origem comercial

- Vendas: Todos / Online / POS; POS tem também uma vista própria.
- POS = `client_sale_id` preenchido ou canal `counter`/`dine_in`. Entregas criadas no balcão continuam POS.
- Online pago no balcão continua online. O método de pagamento não classifica a origem.
- Aquisição exclui pedidos POS em todos os totais, canais, campanhas e descoberta. Eventos POS e telemetria de upsell não criam sessões no funil online.
- `get_sales_metrics` filtra todos os indicadores e a comparação anterior. `get_dashboard_metrics` mantém o contrato consolidado para consumidores existentes.
- Exportação contabilística continua independente do filtro de origem, claramente identificada no formulário.

## Upsells: medir sem inventar lucro

O site marca acompanhamentos e upgrades aceites; o POS marca os produtos adicionados nos passos de oferta. A marca acompanha apenas as unidades aceites, incluindo a fila offline. A redução da quantidade retira primeiro as unidades atribuídas. Adições normais ao carrinho não inflam a atribuição.

As RPCs de criação de pedidos guardam uma captura única, best-effort, depois do cálculo original. A falha da telemetria nunca cancela uma venda. Não se aceitam preços/custos do browser. Apenas itens presentes no pedido são atribuídos, limitados à quantidade vendida. Repetir uma venda não altera a captura, mesmo que o primeiro pedido não tivesse upsell.

Receita usa preços das linhas confirmadas e descontos repartidos proporcionalmente, sem entrega. Upgrades usam só a diferença das variantes, preservando adicionais já escolhidos e a campanha aplicada. A margem bruta estimada dos acompanhamentos usa o custo congelado em `order_items.cost_cents`; custos ausentes e upgrades sem custo diferencial ficam **Por apurar**. Não representa lucro líquido nem prova um aumento causal de vendas (isso exigiria um grupo de comparação).

A tabela compara produto, posição da oferta, vistas, aceitações, unidades confirmadas, receita e margem. Vistas/aceitações são observacionais, deduplicadas por sessão + artigo + posição; no POS, por venda + artigo + posição. Não dependem do pixel publicitário. A aceitação não significa pagamento. A contagem de vistas offline é best-effort; a atribuição das unidades vendidas fica na fila persistente.

## Limites explícitos

- O histórico sem marca de upsell não é reconstruído a partir de `is_upsell`: um produto marcado também pode ser comprado normalmente.
- Linhas ambíguas do mesmo artigo/variante/nota (por exemplo, modificadores diferentes) não são adivinhadas. A captura ignora a atribuição ambígua e mantém a venda.
- Custos e fichas técnicas precisam de estar completos para se interpretar margem. Upgrade sem custo diferencial não recebe margem fictícia.
- Falhas de rede/bloqueadores podem reduzir a contagem de ofertas vistas, sem esconder a receita registada no servidor.

## Verificação

Testes escritos antes da lógica reproduziram a contaminação por POS. Ensaio SQL transaccional: online em dinheiro, entrega POS, totais reconciliados, descontos, upgrades, custos ausentes, cancelamento, repetição, permissões de gerente e anónimo. Ensaios POS/checkout/stock/funil locais, testes de carrinho/fila offline, testes Playwright desktop/móvel/AA e aceitação real da oferta no browser.

## Publicação

Migrations 1073 e 1074 apenas no staging. Railway: o trigger de produção foi corrigido de `dev` para `main`, conforme `CLAUDE.md`; alteração do trigger não promove esta entrega para produção. Desenvolvimento visual concorrente do POS foi preservado no checkout principal e excluído desta entrega isolada.

Validação desta entrega: 973 testes unitários, 60 testes de base de dados (Supabase local por IPv4), 12 testes Playwright e lint/typecheck aprovados. Auditoria de segurança local sem problemas. As capturas mobile/desktop foram revistas.
