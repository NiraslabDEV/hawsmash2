# Relatórios, exportação e resumos automáticos

Este módulo reúne a leitura de vendas/aquisição, resultados de upsell, CSV contabilístico e resumos por email. Os valores de [caixa](caixa.md) pertencem ao turno/dia; não se deve substituir um fecho congelado por um relatório de vendas consultado mais tarde.

**Estado:** descrição da árvore auditada em 26/09/2026. O resumo mensal/Google já existia como trabalho local não commitado no início da auditoria. Não se verificaram scheduler, SMTP, Google, dados reais ou versão publicada.

## Perfis, filtros e fontes

O dono vê consolidado e lojas; o gerente consulta as suas lojas. Caixa e cozinha não entram em Análise. A exportação valida o token e conserva a identidade do utilizador na RPC; só o dono pede Todas. A autorização de BD continua necessária mesmo quando o menu esconde um ecrã.

| Percurso / RPC | Resultado |
|---|---|
| `/analise` → `get_sales_metrics` | Receita, pedidos, ticket, evolução, artigos, canais e horários, filtrados por loja/período/origem |
| `get_funnel_metrics` / `get_attribution_report` | Aquisição, etapas e atribuição de receita online |
| `get_upsell_metrics` | Vistas/aceites, unidades confirmadas, receita e margem estimada |
| `report_cmv` na aba Estoque | Consumo/custo/margem de produto; ver [estoque](estoque.md) |
| `export_sales_for_accounting` | Linhas de pagamentos para exportar sob o perfil/loja do utilizador |
| `get_daily_digest` | Vendas/caixa/incidentes por loja no resumo diário |
| `get_monthly_digest` | Mês por loja comparado com o anterior, artigos e contexto Google |
| `get_promotions_summary` na aba Promoções | 30 dias de 2x1, cupões, entrega grátis e desconto manual, com receita dos pedidos com promoção; ver [promoções](promocoes.md) |
| `get_coupon_usage` na aba Promoções | Utilizações de cada cupão, só para o dono |

As principais tabelas são `orders`, `order_items`, `payments`, `cash_sessions`, `cash_day_closes`, `analytics_events`, `order_attribution`, `order_upsells`, `promotions` e `google_profile_snapshots`. Catálogo e lojas dão nomes/contexto; os custos congelados pertencem às linhas vendidas. `get_dashboard_metrics` mantém um contrato consolidado herdado; a interface actual de vendas usa `get_sales_metrics`.

Períodos e apresentação usam Africa/Maputo. Todos/Online/POS é origem comercial, não meio de pagamento: entrega POS continua POS; online recebido em dinheiro e QR público continuam online. A exportação contabilística é independente desse filtro. As definições e limites de aquisição/margem estão em [marketing](marketing.md), incluindo o facto de margem estimada não ser lucro líquido.

## CSV contabilístico

No painel: **Análise → Vendas → Pronto para a contabilidade**. Existem dois layouts:

| Layout | Unidade da linha / como somar |
|---|---|
| Pagamentos detalhados | Uma linha por pagamento confirmed/refunded; somar valor do pagamento por estado, nunca repetir total do pedido em pagamentos mistos |
| Resumo por pedido | Uma linha por loja/número do pedido; total uma vez, confirmados e devolvidos separados |

O período filtra **criação do pedido**, não a data contabilística de recebimento/devolução. Conserva o estado do pedido, incluindo `cancelled`. Pedidos sem pagamentos confirmados/devolvidos ficam fora. `refunded` é o estado e montante gravados; não produz nota de crédito nem uma nova transacção fiscal.

Campos comuns por ordem:

```text
loja,data,hora,numero_pedido,numero_dia,canal,estado_pedido,cliente,telefone,subtotal_mt,taxa_entrega_mt,total_pedido_mt
```

No detalhe acrescentam-se:

```text
forma_pagamento,valor_pagamento_mt,estado_pagamento,referencia_pagamento,moeda,versao_formato
```

No resumo acrescentam-se:

```text
pagamentos_confirmados_mt,pagamentos_devolvidos_mt,formas_pagamento,moeda,versao_formato
```

Montantes têm duas casas decimais sem milhares; `moeda` é MZN para integração e `versao_formato` é 1. Datas têm formato AAAA-MM-DD e horas HH:mm no fuso da loja. Meios conservam os códigos gravados; no resumo ficam ordenados e separados por ` + `.

CSV Excel usa ponto e vírgula/vírgula decimal; padrão usa vírgula/ponto decimal. Ambos são UTF-8 com BOM e CRLF. Aspas interiores são duplicadas. Texto com prefixo de fórmula recebe apóstrofo, incluindo telefones com `+`; o integrador deve tratar esses campos como texto, sem remover apóstrofos indiscriminadamente.

### Autenticação, paginação e limites

GET `/api/reports/export-sales` recebe Bearer fora do URL, valida `getUser(token)` e chama a RPC com chave pública e JWT do utilizador. O cliente renova a sessão uma vez após 401. Não usa service role para ultrapassar a autorização.

A rota lê páginas até 500 registos, com contagem exacta, aceitando limites menores do servidor. Erros, contagem alterada/incompleta ou totais inconsistentes impedem gerar CSV parcial. Período máximo: 366 dias; limite: 50.000 pagamentos por ficheiro. Acima disso o utilizador reduz período/loja.

A paginação entre pedidos HTTP não é snapshot transaccional. Uma alteração que preserve a contagem pode não ser detectada integralmente. Usar períodos encerrados e conferir totais; snapshots fiscais exigem contrato próprio.

### Integração com software contabilístico

O formato é CSV genérico, **não um importador WinREST validado nem facturação fiscal certificada**. A pesquisa registada em 24/09/2026 apontava uma [integração WinREST via parceiro](https://ontop.pt/blog/integracao-winrest-woocommerce/) e a [documentação de importação Moloni](https://www.moloni.pt/suporte/posso-importar-dados-para-o-moloni); nenhuma prova compatibilidade deste ficheiro com a instalação do contabilista. Essas referências são histórico da pesquisa, não uma verificação nova.

Para fechar **B-112**, obter versão/módulo e especificação oficial aceite, identificar loja/série/referência externa, artigos, pagamentos e campos fiscais; decidir se o destino emite documentos ou recebe movimentos. Ensaiar numa empresa de testes venda simples/mista, entrega, desconto, anulação/devolução e reimportação sem duplicação. Não inferir impostos/NUIT do total pago nem atribuir um nome de fornecedor a um formato ainda não validado.

## Resumos diário e mensal

`/api/cron/digest` chama `get_daily_digest`, recolhe destinatários configurados, usa SMTP e grava `digest.sent` por loja com o estado da tentativa. O nome do evento não garante recepção: o payload distingue enviado, falhado e omitido por configuração/destinatário. O handler aceita data de referência; não deve ser apresentado como envio idempotente por data.

`/api/cron/monthly` exige `CRON_SECRET` e usa o último mês fechado por omissão. O parâmetro month escolhe o mês; force permite reenvio deliberado. Consulta `get_monthly_digest`, prepara o email e procura um envio anterior com estado sent para evitar repetição normal. Essa verificação não é uma exclusão transaccional entre duas chamadas simultâneas; não prometer entrega exactamente uma vez.

O resumo mensal inclui vendas por loja versus mês anterior, pedidos/cancelamentos, canais, pagamentos e artigos. A nota/contagem de avaliações vem da Places API (New), com chave de servidor e Place ID da loja. Guarda-se uma fotografia mensal em `google_profile_snapshots`; o Google fornece a contagem actual, não a série histórica. Um mês antigo sem fotografia não recebe um valor de hoje apresentado como histórico.

Falta de Place ID/chave, erro ou timeout Google mantém o resumo e explica a ausência por loja. Métricas de visualizações, chamadas e direcções do Perfil de Empresa ainda dependem de acesso GBP e não fazem parte desta entrega. O adapter usa apenas os campos necessários e timeout de 10 s; chamadas reais podem ter custo e não foram executadas nesta tarefa.

O scheduler externo deve chamar estes handlers no horário acordado; a presença de código não agenda envios. Digest/alerts/conversions só verificam Bearer se `CRON_SECRET` existir; monthly/reconcile recusam segredo ausente. A diferença permanece na [auditoria](../AUDITORIA-DOCUMENTACAO.md#5-código-que-viola-a-spec). Ver [crons](../referencia/crons.md), [ambiente](../referencia/ambiente.md) e **B-114**.

## Ficheiros, eventos e testes

- [Análise](<../../apps/web/app/(admin)/analise/page.tsx>) e [upsell](../../apps/web/components/admin/upsell-insights.tsx).
- [Exportação HTTP](../../apps/web/app/api/reports/export-sales/route.ts), [CSV](../../apps/web/lib/admin/accounting-export.ts) e [cliente Bearer](../../apps/web/lib/admin/export-client.ts).
- [Digest](../../apps/web/app/api/cron/digest/route.ts), [mensal](../../apps/web/app/api/cron/monthly/route.ts), [formatação mensal](../../apps/web/lib/reports/monthly.ts) e [Places](../../apps/web/lib/google/places.ts).
- [SMTP](../../apps/web/lib/email/transport.ts), segundo o [ADR 0004](../decisions/0004-email-smtp-hostinger.md).

Eventos directos: `digest.sent`, `monthly_digest.sent`; alterar Place ID grava `store.updated`. Consultar/exportar relatórios não grava um evento de auditoria próprio nesse handler. Os fechos têm eventos diferentes, descritos em Caixa.

Testes unitários de [admin/exportação](../../apps/web/lib/admin/__tests__/), [mensal](../../apps/web/lib/reports/__tests__/monthly.test.ts) e [Places](../../apps/web/lib/google/__tests__/places.test.ts); DB de [origens](../../packages/db/tests/analysis-origins.test.ts), [mensal](../../packages/db/tests/resumo-mensal.test.ts) e [funil](../../packages/db/tests/funil.test.ts); [e2e Análise](../../e2e/analysis.spec.ts) com configuração dedicada. O download e2e usa Next/cliente Supabase reais com Auth/RPC simulados em loopback; não emite documentos fiscais.

O registo de exportação de 24/09/2026 reportava 963 testes unitários, nove Playwright, lint/typecheck/build local. O registo de origens/upsell reportava os resultados descritos em Marketing e leitura em staging. Não foram repetidos aqui, nem demonstram publicação. **B-111** mantém a validação da interface em staging, **B-112** o adaptador contabilístico e **B-114** Google/agendador, no [registo de bloqueios](../../BLOQUEIOS.md). PDF/emails de caixa têm uma incompatibilidade de sessão estática registada na auditoria; não se conclui que estes relatórios funcionam ponta a ponta sem ensaio.
