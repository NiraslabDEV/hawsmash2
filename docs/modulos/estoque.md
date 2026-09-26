# Estoque, ingredientes e ficha técnica

O módulo separa catálogo partilhado, disponibilidade por loja, stock de produto final e matéria-prima. Uma bebida pronta pode ser controlada em unidades do produto; um hambúrguer consome ingredientes segundo a ficha da variante. `/estoque` reúne produtos, ingredientes, receitas e CMV. Documento baseado em leitura do código de 26 de Setembro de 2026, sem nova contagem física ou execução de testes.

## Perfis e fronteiras

O dono gere custos e fichas técnicas, que afectam o catálogo partilhado. O gerente conta, recebe e lança quebras na loja a que tem acesso. O caixa pode marcar produtos disponíveis/esgotados através da RPC dedicada; isso não lhe dá permissão para alterar saldos, preços ou custos. A cozinha não passa a gerir dinheiro por consultar artigos.

| Dado | Âmbito |
|---|---|
| `menu_categories`, `menu_items` | Catálogo da empresa |
| `store_items` | Disponibilidade, preço override, `track_stock`, `stock_qty`, `low_stock_qty` por loja/produto |
| `stock_movements` | Livro de produto final com loja, delta, razão, pedido e autor |
| `ingredients` | Ingrediente, unidade e custo em centavos; catálogo comum |
| `store_ingredients` | `track`, quantidade e limiar por loja/ingrediente |
| `recipe_items` | Consumo por produto e variante opcional |
| `ingredient_movements` | Livro de matéria-prima e saldo posterior |
| `order_items.cost_cents` | Custo guardado no momento da venda |

Triggers criam as combinações de loja/produto e loja/ingrediente; uma linha ausente não deve ser interpretada como uma configuração implícita. Preço efectivo é o override da loja ou preço do catálogo. Disponibilidade combina o interruptor com a quantidade quando o controlo está ligado.

## Consumo e reposição

A venda de balcão, a aprovação manual e a confirmação digital consomem produto final e ingredientes na transacção correspondente. Mesas também consomem quando o pedido é lançado, não novamente quando a conta é paga. São feitas verificações/actualizações atómicas; falta de produto ou ingrediente produz erro e impede a transacção de concluir como se existisse stock.

A ficha soma linhas gerais (`variant_id=null`) e linhas da variante escolhida. Assim, ingredientes comuns contam em todas as variantes e ingredientes específicos ficam separados. `track=false` permite calcular custo sem bloquear a venda pelo saldo; o controlo só deve ser ligado depois da contagem inicial. O custo capturado na linha de venda não muda quando o custo do ingrediente é editado amanhã.

Anular/cancelar repõe segundo os consumos registados. As rotinas verificam movimentos anteriores para não consumir ou repor novamente no retry. Não corrigir stock apagando movimentos de venda; uma correcção manual é outro movimento com motivo.

Fontes: [1008 produto final](../../supabase/migrations/20260819230000_1008_stock.sql), [1024 ingredientes](../../supabase/migrations/20260827100000_1024_ingredientes_e_ficha_tecnica.sql), [1025 consumo na venda](../../supabase/migrations/20260827110000_1025_ficha_tecnica_na_venda.sql) e [1081 mesas](../../supabase/migrations/20260924060000_1081_mesas_no_balcao.sql).

## Operação e RPCs

| Acção | RPCs |
|---|---|
| Consultar produto final | `list_store_stock`, `list_stock_alerts`, `list_stock_movements` |
| Contar/ajustar/ligar controlo | `adjust_store_stock`, `set_stock_tracking` |
| Esgotar/restabelecer no balcão | `set_item_availability` |
| Consultar ingredientes | `list_store_ingredients`, `list_ingredient_movements` |
| Ajustar ingredientes | `adjust_store_ingredient`, `set_ingredient_tracking` |
| Catálogo/custo/ficha | `save_ingredient`, `list_recipes`, `save_recipe_item`, `delete_recipe_item` |
| Margem | `report_cmv` |

As leituras operacionais e alterações de saldo recebem loja; receitas/custos pertencem ao catálogo da empresa. O painel não deve trocar “Todas” por uma mutação global. Quantidades de matéria-prima seguem a unidade do ingrediente; a regra de centavos inteiros aplica-se ao **dinheiro**, não exige fingir que uma fracção de ingrediente é uma unidade inteira de produto.

[`/estoque`](../../apps/web/app/(admin)/estoque/page.tsx) contém o stock final; [ingredientes-section.tsx](../../apps/web/app/(admin)/estoque/ingredientes-section.tsx), [ficha-tecnica-section.tsx](../../apps/web/app/(admin)/estoque/ficha-tecnica-section.tsx) e [cmv-section.tsx](../../apps/web/app/(admin)/estoque/cmv-section.tsx) separam as outras responsabilidades. [availability-panel.tsx](../../apps/web/app/(pos)/pos/availability-panel.tsx) é o acesso reduzido do caixa. A [migration 1061](../../supabase/migrations/20260923120000_1061_esgotado_no_balcao.sql) define o seu contrato.

## Auditoria, falhas e limites

Movimentos distinguem venda, anulação, recepção, quebra, contagem e ajuste. Eventos incluem `stock.low`, `stock.out`, `stock.availability_changed`, `ingredient.low`, `ingredient.out`, `ingredient.adjusted`, `ingredient.tracking_changed`, `ingredient.created`/`updated` e `recipe.saved`/`deleted`. Acções de catálogo são globais; movimentos da loja devem conservar contexto da unidade e operador. Um evento inserido na mesma transacção que depois lança uma excepção não é prova de um alerta persistido fora dessa transacção.

Offline, o POS vende usando a cache e não consulta o saldo real. A sincronização pode revelar falta de stock ou outra divergência; a entrada deve ficar visível para resolução, nunca desaparecer em silêncio. Não anunciar disponibilidade offline como reserva garantida. Custo por preencher deve continuar explícito no CMV, sem margem inventada.

## Testes, decisões e pendências

Suites de BD: [stock](../../packages/db/tests/stock.test.ts), [stock-v2](../../packages/db/tests/stock-v2.test.ts), [recipes](../../packages/db/tests/recipes.test.ts), [item-availability](../../packages/db/tests/item-availability.test.ts) e [mesas](../../packages/db/tests/mesas.test.ts). [estoque.spec.ts](../../e2e/estoque.spec.ts) cobre o painel; os testes de disponibilidade/menu offline do POS cobrem a apresentação. Não foram executados nesta redocumentação.

[ADR 0001](../decisions/0001-multi-unidade.md) fixa catálogo comum e realidade por loja. [BLOQUEIOS](../../BLOQUEIOS.md) conserva B-017 (combos), B-020 (custos/destino de ingredientes) e B-102 (histórico de validação de recipes/account); consultar os estados nas entradas, não a sua posição numa lista histórica. Ver [auditoria](../AUDITORIA-DOCUMENTACAO.md) para diferenças de implementação ainda abertas.

---

## Contrato preservado da spec

Regras transferidas sem perda de conteúdo. O estado observado e os limites estão nas secções acima.

## 10. ESTOQUE (por loja)

- `store_items.track_stock/stock_qty/low_stock_qty` (§5.3). Baixa **na mesma transação** que confirma a venda
  (`create_counter_sale`, `confirm_payment`, `advance_order APPROVE`).
- `stock_movements (id, store_id, menu_item_id, delta, reason, order_id null, created_by, created_at)` —
  `reason ∈ ('sale','void','manual','waste','receive','count')`. **Todo** o movimento fica registado; é o que
  permite explicar um desvio em vez de o adivinhar.
- Chega a 0 → o item deixa de estar disponível **naquela loja** (site e POS), automaticamente.
- `low_stock_qty` atingido → alerta (§11.5) e destaque no painel.
- Reposição e contagem no painel (aba **Estoque**), sempre com motivo, sempre logadas.

### 10.1 Matéria-prima e ficha técnica (o que a cozinha gasta de verdade)

O estoque de **produto final** acima continua a valer para o que se compra pronto e se vende como está
(bebidas, natas). Não serve para um hambúrguer: o que acaba não é o "Classic Smash" — é a **carne WAGYU**,
que é a mesma do Double e do Signature. E como o desconto era por produto, um Classic HAW e um Classic
WAGYU baixavam o mesmo saldo.

```sql
ingredients        (id, name, unit, cost_cents, active, sort)          -- catálogo da empresa
store_ingredients  (store_id, ingredient_id, track, qty, low_qty)      -- a realidade de cada loja
ingredient_movements (… delta, qty_after, reason, order_id, created_by) -- o livro, append-only
recipe_items       (menu_item_id, variant_id null, ingredient_id, qty)  -- a ficha técnica
```

- **A ficha é por `(produto, variante)`.** Linha com `variant_id null` vale para todas as variantes
  (o queijo é o mesmo em HAW e WAGYU); linha com variante vale só para ela (é o que separa a carne).
  O consumo de uma venda é a soma das duas.
- **Baixa na mesma transacção da venda**, nos mesmos três caminhos do produto final. Falta de
  matéria-prima → `out_of_ingredient:<nome>` e a venda inteira reverte. Anulação repõe, uma só vez.
- **`track = false` conta para o custo mas não trava a venda.** É o estado de partida: um ingrediente
  com `qty 0` e controlo ligado fecharia os burgers todos ao primeiro pedido. Liga-se depois da 1.ª contagem.
- **`order_items.cost_cents` guarda o custo no momento da venda.** Mudar o custo da carne amanhã **não**
  reescreve a margem de ontem — é o que torna o relatório utilizável para decidir preço (`report_cmv`).
- **Custo é do `owner`; contagem é do `manager`.** Editar um custo ou uma ficha muda a margem de todo o
  histórico seguinte; contar, receber e lançar quebra é operação da loja.
- Custo em **centavos inteiros**, como todo o dinheiro (§17). Ingrediente sem custo aparece no painel como
  **"custo por preencher"** — nunca se inventa um número, porque uma margem errada com ar de certa é pior
  do que uma margem em falta.
