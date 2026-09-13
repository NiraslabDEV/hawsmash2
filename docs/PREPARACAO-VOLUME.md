# Preparação para delivery com volume

Este plano prepara o motor para uma operação com 8.000 pedidos/mês, até 1.500 num dia,
rajadas de 30 pedidos/minuto e mais de 100 pedidos abertos. São **cenários de aceitação**,
não capacidade já medida. As instalações seguintes reutilizam o código e configuram lojas,
horários, menus, contas de pagamento, equipa e impressoras próprias.

## O que já existe e o que falta

| Frente | Evidência no motor | Trabalho que ainda exige implementação ou validação |
|---|---|---|
| Loja e conta do cliente | Menu, checkout, agendamento, estados, moradas e histórico; `apps/web/app/(public)/`, API de conta, migrations 1034/1038/1039 | Dados da instalação e ensaio real de compra, rede e recuperação |
| Várias cozinhas | `stores`, permissões por loja, menus/preços/zonas/horários e painel; migrations 1001–1011 | Configurar cada cozinha, testar papéis e consolidado na BD de staging |
| Pagamentos | Provider M-Pesa, simulador, referência estável, confirmação comum; `packages/payments/`, `apps/web/lib/payments/` | Credenciais, limites reais do fornecedor, concorrência de cobranças, reconciliação contínua e alertas no painel |
| Conciliação com extracto | Conferência local de ficheiros normalizados, descrita abaixo | Adaptador do extracto real, obtenção diária, persistência auditada, revisão no painel; não é a consulta de estado ao M-Pesa |
| Painel de pedidos | Ecrã com acções, filtros, itens, reimpressão e paginação por servidor na migration 1045 | Aplicar/validar a migration; construir fila por prazo prometido, cores por atraso e prioridade operacional. Não inventar prazo para pedido imediato |
| Entregas agrupadas | Pedidos têm loja, zona e estado | Lotes de despacho por loja/zona, atribuição ao estafeta e histórico; impedir agrupar lojas distintas. Agrupar por zona não calcula a melhor rota |
| Stock e ficha técnica | Produto, ingredientes, receitas, movimentos e custo guardado na venda; migrations 1024–1026 | Configurar receitas reais, testar consumo/anulação/concorrência e fechar os testes de integração pendentes |
| Impressão | Fila persistente, reimpressão, retentativas e bridge por loja | A escolha entre kitchen/counter ainda não é failover. Implementar reserva e tratar resultado incerto para não imprimir duas vezes; validar com duas impressoras |
| Relatórios | Agregados por loja e CMV; migrations 1026/1037, exportação 1028 | Exportação deve paginar além do limite da API; medir planos/índices com 96.000 pedidos/ano antes de decidir pré-cálculos adicionais |
| Marketing e medição | Configuração, atribuição 1029 e outbox de conversões 1030 | Confirmar entrega real a Meta/Google. Email marketing separado, consentimento, desinscrição, retornos, segmentos e automações ainda são trabalho próprio |
| Pesquisa e agentes | Metadados, MCP/WebMCP e pacote de plugin | Sitemap, robots, dados estruturados do menu/empresa e páginas de dúvidas; validação do domínio. MCP não garante indexação nem citação por IA |
| Infraestrutura, suporte e carga | Health, dispositivos, filas, scripts e testes funcionais | Dimensionamento do deploy/BD, métricas de pico, alertas entregues, restauro e ensaio de carga. Instância separada não prova hardware dedicado nem elasticidade automática |

O KDS completo é uma evolução separada. A preparação do painel de pedidos não deve ser
apresentada como KDS já entregue. Contas de Google Maps/email e hardware são activação e
operação; não se criam contas nem se contratam serviços a partir deste plano.

## Primeira passagem: corrigir limites antes de aumentar capacidade

1. **Paginar pedidos na BD.** O `LIMIT/OFFSET` antigo estava depois do `jsonb_agg` e o painel
   paginava apenas o lote que carregava. O contrato corrigido devolve uma página e o total
   filtrado, com desempate por ID. Eventos realtime provocam nova leitura; polling cobre a queda.
2. **Reconciliar pela loja do pedido.** A configuração global não pode escolher a conta usada
   para consultar pagamentos de outras cozinhas. Usar paginação por cursor, concorrência
   limitada, cancelamento e continuação explícita quando o orçamento de execução termina.
3. **Preparar a conferência de extractos.** Uma função pura compara referências/centavos e
   devolve ocorrências. Esta camada é independente do formato do fornecedor e não escreve na BD.

Activação depende de B-105/B-106/B-107 em [`BLOQUEIOS.md`](../BLOQUEIOS.md).

### Executar a reconciliação de estado

`GET /api/cron/reconcile` exige `Authorization: Bearer` com `CRON_SECRET` configurado.
Sem segredo responde 503; com credencial errada responde 401 antes de consultar dados.
O processo consulta a conta configurada para a loja de cada pedido e nunca inicia uma cobrança.

Uma passagem lê até 300 pedidos (páginas de 50), com até 3 consultas simultâneas, prazo
de consulta de 20 segundos e orçamento de 50 segundos. O critério inicial inclui pedidos
com pelo menos 5 minutos. Estes limites são configuração de implementação a medir no
ensaio; não representam uma capacidade prometida do M-Pesa.

O scheduler precisa de seguir `nextCursor` em `?cursor=...` enquanto `completed=false` e
de iniciar uma passagem nova, sem cursor, depois de concluir a anterior. `completed`
significa que percorreu o conjunto dessa passagem; pode continuar a haver pagamentos pendentes.
Inspeccionar `reason`, `pending`, `providerFailed`, `errors` e `skipped`; um HTTP 200 sozinho
não prova que o dinheiro ficou resolvido. Erro de leitura devolve 503 com possibilidade de retoma.

Manter uma única execução coordenada por instalação: ainda não há lease persistente entre
réplicas. A confirmação reutiliza a idempotência do domínio, mas execuções paralelas podem
duplicar consultas ao fornecedor. O resultado `providerFailed` não muda o estado nem roda
referências neste cron; a transição auditada para falha definitiva e o alerta persistente
ficam na V3. As confirmações continuam a passar pela função comum `confirmOrderPaid`.

## Conferir ficheiros normalizados

```powershell
New-Item -ItemType Directory -Path output -Force | Out-Null
pnpm exec tsx scripts/reconcile-payment-statement.ts --input scripts/fixtures/payment-statement.example.json --output output/conferencia-exemplo.json
```

O exemplo tem apenas dados `PLACEHOLDER_*`. O comando não liga à rede, não lê `.env`, não
consulta contas e não confirma, devolve ou cobra pagamentos. Recusa substituir um ficheiro
existente. Códigos de saída: **0** referências fornecidas conferidas; **2** relatório com
ocorrências para revisão; **1** entrada/destino inválido, sem relatório válido.

Contrato em `packages/payments/src/statement.ts`:

- Versão 1, provider `mpesa`, moeda `MZN`, uma `storeId` explícita por ficheiro.
- `periodStart` incluído e `periodEnd` excluído, em UTC com milissegundos. Um dia de Maputo
  começa às 22:00 UTC do dia anterior. Não inferir fuso a partir de texto ambíguo do extracto.
- `ledger`: um registo por pagamento/tentativa normalizado com ID, loja, referência, centavos,
  data e estado `confirmed`, `pending` ou `failed`.
- `statement`: ID de movimento, loja, referência, centavos, data e tipo `payment`, `refund`
  ou `fee`. Taxas e devoluções aparecem separadas e **exigem revisão** nesta primeira versão.
- Referências opacas são comparadas exactamente, sem mudar maiúsculas, eliminar caracteres
  ou emparelhar só por valor. IDs repetidos, lojas misturadas e movimentos fora do intervalo
  são erros; referências repetidas são ambiguidade visível, não deduplicação silenciosa.
- Valores são centavos inteiros. `parseStatementAmount` converte texto com separador decimal
  explícito e duas casas, sem float, milhares ou arredondamentos adivinhados.

O adaptador futuro deve provar como liga a referência interna à referência do extracto. Deve
paginar a origem até ao fim e indicar o período/tipo de data usado. Uma liquidação no dia
seguinte pode criar ocorrências legítimas: cruzar períodos na revisão, sem mudar o dia em silêncio.
Um relatório `matched` compara somente os ficheiros fornecidos; não prova que o fornecedor
exportou todos os movimentos, que o saldo da conta bate certo ou que houve confirmação na API.
Ficheiros reais e relatórios financeiros ficam fora do Git, com acesso restrito à operação.

## Próximas entregas, em ordem

| Ordem | Entrega | Critério para fechar |
|---|---|---|
| V1 | Paginação, reconciliação por loja e conferência normalizada | Testes locais e posterior validação da migration, scheduler e extracto em staging |
| V2 | Fila de cozinha por prazo e agrupamento por zona | Mais de 100 pedidos visíveis/pagináveis, filtros correctos, atraso calculado só com prazo conhecido, nenhum despacho entre lojas |
| V3 | Pagamento sob carga e operação contínua | Várias lojas/contas, dupla tentativa, cancelamento, saldo insuficiente, timeout, retorno tardio e alarme por pendência; nenhum desconhecido convertido em falha |
| V4 | Reserva de impressão | Falha antes/depois de enviar bytes, reinício do bridge, falta de papel e reimpressão auditada; venda sempre preservada |
| V5 | Marketing e presença | Canal de campanhas separado, desinscrição/retornos testados, segmentos/automações, conversões recebidas, sitemap/robots/schema validados |
| V6 | Relatórios, carga e abertura | Exportação completa, planos medidos, teste de restauro, formação e ensaios abaixo com relatório |

### Cenários de carga para o ambiente de ensaio

1. Preparar dados sintéticos por loja e um histórico de 96.000 pedidos, em BD descartável.
2. Medir a linha de base com tráfego normal; depois 30 encomendas num minuto, incluindo
   repetições da mesma tentativa. Medir pedidos persistidos, latência p50/p95/p99 e erros.
3. Exercitar dezenas de pagamentos simultâneos com simulador, cancelamentos e respostas
   tardias; repetir a mesma referência e confirmar ausência de duplicação no livro de pagamentos.
4. Manter mais de 100 pedidos activos enquanto chegam outros; verificar páginas, acções,
   queda de realtime, impressão e retomada de rede. Um teste de arrays não prova isto.
5. Repetir com infraestrutura degradada e medir backlog/recuperação; os limites de resposta
   e a política de escala ficam registados depois de medir o ambiente, sem prometer latência zero.
6. Só depois validar a ligação real ao M-Pesa e hardware no ambiente aprovado. Cobrança real
   é uma etapa própria, com autorização; os ensaios de código desta preparação não gastam dinheiro.

## Verificação local

```sh
pnpm lint
pnpm test
pnpm exec vitest run packages/payments/src/__tests__/statement.test.ts scripts/__tests__/payment-statement-cli.test.ts
pnpm exec playwright test --config playwright.orders.config.ts
```

A suite de extractos inclui 1.500 movimentos e uma discrepância na última linha; valida
correcção sobre o lote e não débito de encomendas HTTP. Resultados com simuladores não
substituem staging, testes reais de RLS, prova de capacidade ou disponibilidade do fornecedor.

O teste de navegador arranca um Next e um simulador locais nas portas 3019/3020, com
autenticação/RPCs simuladas no contexto de teste. Usa 125 pedidos, chega à página 13 e
verifica filtros e resposta atrasada. O teste SQL de instalação fica em
`supabase/tests/orders_pagination.sql`; correr apenas contra a base local de testes com
`supabase test db --local supabase/tests/orders_pagination.sql` depois das migrations.
