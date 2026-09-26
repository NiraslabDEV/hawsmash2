# Caixa, turnos e fecho do dia

A caixa controla o dinheiro físico e separa-o dos restantes meios de pagamento. Está em `/caixa` no painel e na aba Caixa do POS. O fecho do turno regista a contagem; o fecho do dia agrega turnos já fechados. Um fecho não é uma factura fiscal nem uma transferência de fundos. Descrição baseada no código auditado em 26 de Setembro de 2026, sem novo ensaio de BD ou hardware.

## Perfis e unidade

As RPCs de caixa verificam autenticação, perfil `owner`/`manager`/`cashier` e `auth_can_store`, recusando `kitchen`. Isto não garante ausência de acesso financeiro noutros módulos: desde a 1097, `advance_order` impõe o perfil (o caixa não cancela venda paga; a cozinha não aprova nem cancela) e `confirm_payment` é só do servidor; a leitura de valores pela cozinha continua aberta (V-03, B-116). Ver a [auditoria §5.1](../AUDITORIA-DOCUMENTACAO.md). O POS mostra a loja vinculada ao dispositivo, mesmo se a pessoa tiver outras lojas; “Todas” no painel é consolidação de leitura. A regra de produto atribui ao caixa a operação da sua caixa; a implementação SQL organiza a sessão aberta **por loja**, serializada com um lock. Não interpretar a mudança de operador como criação automática de uma gaveta independente.

## Fluxo do turno

1. `get_cash_dashboard` devolve sessão, vendas por método, movimentos e esperado do servidor.
2. `open_cash_session(p_store,p_float)` abre com fundo inicial inteiro não negativo. O servidor impede duas sessões abertas na mesma loja. Há caminhos de venda que abrem uma sessão automaticamente quando necessário; convém abrir o turno explicitamente para registar o fundo real.
3. `add_cash_movement` grava `sangria`, `reforco`, `despesa` ou `troco_inicial`, com montante positivo e motivo. O movimento pertence à sessão aberta e à loja.
4. O operador conta fisicamente a gaveta. `close_cash_session(p_store,p_counted,p_reason)` calcula o esperado, compara a contagem e exige motivo quando a diferença supera `settings.cash_diff_tolerance_cents`.
5. O servidor congela o relatório. Impressão, PDF e email são saídas desse relatório, não novos cálculos a partir dos preços de hoje.

O esperado é fundo inicial + vendas recebidas em dinheiro + reforços + troco inicial acrescentado − sangrias − despesas. M-Pesa, e-Mola e cartão aparecem separados: não são notas dentro da gaveta. Os montantes de pagamento, incluindo mistos e contas de mesa, vêm do livro de pagamentos. O período segue o último fecho aplicável; não é “desde a meia-noite UTC”. Datas são guardadas em UTC e apresentadas em `Africa/Maputo`.

Fontes: [1007 caixa](../../supabase/migrations/20260819220000_1007_cash.sql), [dashboard](../../supabase/migrations/20260819222000_f5_cash_dashboard.sql), [artigos no fecho](../../supabase/migrations/20260926120000_1095_artigos_no_fecho.sql) e [adaptador POS](../../apps/web/lib/pos/caixa.ts).

## Fecho do dia

`get_cash_day(p_store)` mostra turno aberto, turnos fechados ainda não agregados e último fecho do dia. `close_cash_day(p_store,p_request_id)` exige não haver turno aberto e pelo menos um turno pendente. Usa o mesmo lock da abertura/fecho de turno, liga os turnos por `cash_sessions.day_close_id` e grava `cash_day_closes`.

O dia soma os relatórios congelados dos turnos; não recalcula as vendas. Cada turno pertence a um único fecho do dia. Repetir a mesma loja e `p_request_id` devolve o mesmo relatório com indicação de duplicado. Uma nova chave não permite incorporar novamente os mesmos turnos. O papel usa `kind=cash_close` com informação `day`, mantendo compatibilidade com o formato anterior do bridge. A listagem de artigos vendidos foi acrescentada pela 1095; fechos históricos sem esse bloco não ganham retrospectivamente dados inventados.

Fonte: [migration 1091](../../supabase/migrations/20260925100000_1091_fecho_do_dia.sql), [day.ts](../../apps/web/lib/cash/day.ts) e [day-closes.tsx](../../apps/web/app/(admin)/caixa/day-closes.tsx).

## Internet, mesas e repetição

As operações de caixa exigem servidor; vendas de balcão podem continuar na fila offline. A interface avisa sobre vendas por sincronizar: só entram no servidor quando sincronizadas. Fechar sem resolver a fila pode fazer a receita aparecer num período posterior, por isso o aviso é operacionalmente relevante.

Mesas ainda por pagar não são dinheiro em caixa. O POS mostra mesas abertas e o total pendente; liquidá-las chama `close_table_bill`, não `close_cash_session`. Ver [Mesas](mesas.md). Fechar o turno não liquida implicitamente contas de mesa.

A idempotência explícita do fecho do dia e da conta da mesa não deve ser atribuída a todas as RPCs. `add_cash_movement` não recebe uma chave de pedido; repetir deliberadamente a chamada pode criar outro movimento. Numa resposta incerta, conferir o livro antes de lançar novamente. Esta descrição regista o contrato existente sem alterar as regras do produto.

## Dados, rotas e auditoria

| Área | Fontes e funções |
|---|---|
| Livro | `cash_sessions`, `cash_movements`, `cash_day_closes`, `orders`, `payments`, `table_bills` |
| POS | [caixa-tab.tsx](../../apps/web/app/(pos)/pos/caixa-tab.tsx) |
| Painel | [caixa/page.tsx](../../apps/web/app/(admin)/caixa/page.tsx) e listagem de fechos diários |
| PDF | [`GET /api/cash-sessions/[id]/report`](../../apps/web/app/api/cash-sessions/[id]/report/route.ts); [report.ts](../../apps/web/lib/cash/report.ts) |
| Email | [`/api/emails/send-cash-close-email`](../../apps/web/app/api/emails/send-cash-close-email/route.ts), [`/api/emails/send-cash-day-email`](../../apps/web/app/api/emails/send-cash-day-email/route.ts) |
| Papel | `print_jobs` e formatos em [Impressão](impressao.md) |

Eventos centrais: `cash.session_opened`, `cash.session_auto_opened`, `cash.movement_added`, `cash.session_closed`, `cash.day_closed` e falhas auxiliares como `cash.day_close_print_failed`. Os eventos operacionais incluem autor e loja. O dinheiro não pode depender do sucesso SMTP ou da impressora.

## Testes e pendências

Testes puros de leitura, entradas e relatório estão em [lib/cash/__tests__](../../apps/web/lib/cash/__tests__) e [POS caixa](../../apps/web/lib/pos/__tests__/caixa.test.ts). As suites de BD são [cash](../../packages/db/tests/cash.test.ts), [cash-v2](../../packages/db/tests/cash-v2.test.ts), [cash-day](../../packages/db/tests/cash-day.test.ts) e [mesas](../../packages/db/tests/mesas.test.ts). Os formatos têm testes de fecho de turno/dia e artigos em `@delivery/receipt`. Não foram executados nesta passagem; `pnpm test` na raiz não substitui o gate de BD.

[ADR 0001](../decisions/0001-multi-unidade.md) rege a unidade; [ADR 0004](../decisions/0004-email-smtp-hostinger.md) rege o envio SMTP. Consultar B-006 para hardware/ensaio de abertura e B-012 para o estado histórico da configuração de email em [BLOQUEIOS](../../BLOQUEIOS.md). A [auditoria](../AUDITORIA-DOCUMENTACAO.md) contém as divergências que não foram corrigidas por esta documentação.

---

## Contrato preservado da spec

O bloco SQL seguinte é o desenho inicial. O módulo acima distingue turnos, movimentos e fechos do dia actuais. Os endpoints PDF/email aceitam o Bearer da sessão do browser (antes só cookies, e respondiam 401 — R-03, corrigido a 26/09); o painel descarrega o PDF autenticado. Sangria, reforço e despesa levam `p_request_id` (1098): repetir o mesmo movimento não o conta duas vezes.

## 9. CAIXA (por loja, por turno)

```sql
cash_sessions  (id, store_id, shift_label, opened_by, opened_at, opening_float_cents,
                closed_by, closed_at, counted_cash_cents, expected_cash_cents,
                difference_cents, difference_reason, report jsonb)
cash_movements (id, session_id, store_id, type, amount_cents, reason, created_by, created_at)
                -- type: 'sangria' | 'reforco' | 'despesa' | 'troco_inicial'
```
- **Esperado em caixa** = fundo inicial + vendas em **dinheiro** − sangrias + reforços − despesas.
  Vendas em M-Pesa/e-Mola/cartão entram no relatório **separadas** (não estão na gaveta).
- Fecho: contagem → diferença. Diferença acima de `settings.cash_diff_tolerance_cents` **exige motivo**.
  Imprime o fecho, gera PDF e envia email ao dono (herdado do 1.0 `send-caixa` e do motor `close_cash_session`).
- **Conta desde o último fecho** — nunca "desde a meia-noite UTC" (bug real corrigido no motor; não repetir).
- Consolidado das duas lojas num ecrã, com a decomposição por loja, por turno e por forma de pagamento.
- **Turno e dia (1091):** o turno fecha com a contagem e a pessoa seguinte abre o seu, no POS (aba Caixa).
  No fim, o **fecho do dia** (`close_cash_day`) junta os turnos fechados **desde o último fecho do dia** —
  cada turno pertence a um só (`cash_sessions.day_close_id`). Soma o que os turnos congelaram, não recalcula;
  diz quem abriu e fechou cada turno; exige nenhum turno aberto; é idempotente por `p_request_id`; imprime
  (como `cash_close` com `day`, legível pelo bridge antigo) e envia email ao dono.
