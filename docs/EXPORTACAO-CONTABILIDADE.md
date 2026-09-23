# Exportação para contabilidade e integração

## O que já sai do painel

Análise → Vendas → Pronto para a contabilidade:

- **Pagamentos detalhados**: uma linha por pagamento em estado `confirmed` ou `refunded`. Um pedido com pagamento misto ocupa várias linhas. Somar `valor_pagamento_mt`, separando os estados; **não somar `total_pedido_mt` nesta vista**.
- **Resumo por pedido**: uma linha por par loja/número de pedido. O total do pedido aparece uma vez. `pagamentos_confirmados_mt` e `pagamentos_devolvidos_mt` estão separados. O estado do pedido conserva-se, incluindo `cancelled`.
- **CSV para Excel**: separador `;`, vírgula decimal, UTF-8 com BOM e linhas CRLF.
- **CSV padrão**: separador `,`, ponto decimal, UTF-8 com BOM e linhas CRLF. Aspas duplicadas dentro de campos entre aspas.

Todos os montantes têm duas casas decimais, sem separadores de milhares. A coluna `moeda` é `MZN` (código para integração; a UI usa MT), e `versao_formato` é `1`. Datas `AAAA-MM-DD`, hora `HH:mm` em Africa/Maputo. O período filtra a **criação do pedido**, tal como a RPC existente; não é a data contabilística de recebimento/devolução.

Texto que começa por uma fórmula é prefixado com apóstrofo para abertura segura em folhas de cálculo; isto inclui telefones com `+`. O integrador deve tratar estas colunas como texto. Não remover globalmente apóstrofos legítimos.

## Contrato das colunas

Campos comuns, por ordem:

`loja,data,hora,numero_pedido,numero_dia,canal,estado_pedido,cliente,telefone,subtotal_mt,taxa_entrega_mt,total_pedido_mt`

No detalhe acrescentam-se:

`forma_pagamento,valor_pagamento_mt,estado_pagamento,referencia_pagamento,moeda,versao_formato`

No resumo acrescentam-se:

`pagamentos_confirmados_mt,pagamentos_devolvidos_mt,formas_pagamento,moeda,versao_formato`

Meios de pagamento mantêm os códigos gravados; no resumo são ordenados e separados por ` + `. `refunded` representa o estado actual do pagamento e o respectivo montante gravado, não cria uma nota de crédito nem uma nova transacção de devolução. Pedidos sem pagamentos confirmados/devolvidos não entram. Totais inconsistentes ou contagens incompletas impedem a geração do ficheiro.

## WinREST e outros programas

**Este é um CSV genérico documentado, não um importador WinREST validado nem um documento fiscal certificado.** Não existe nesta implementação a emissão ou registo automático de facturas noutro sistema.

A pesquisa de 24/09/2026 encontrou integrações WinREST via API, mas não um contrato público do fabricante para importar estes CSV de vendas na versão instalada. A [ONTOP, autora de uma integração WinREST/WooCommerce](https://ontop.pt/blog/integracao-winrest-woocommerce/), descreve uma API disponibilizada pelo software e o apoio de um parceiro implementador. Isto confirma uma via de integração, não o formato do ficheiro nem a compatibilidade desta instalação.

O [Moloni documenta](https://www.moloni.pt/suporte/posso-importar-dados-para-o-moloni) CSV para artigos/clientes/fornecedores e SAF-T(PT) para documentos históricos; isso não prova que um CSV de pagamentos possa emitir novas facturas. Não se presume compatibilidade nem certificação em Moçambique a partir de documentação portuguesa.

### Para validar um adaptador concreto (B-112)

1. Obter nome, versão e módulo de importação/API do programa usado pelo contabilista e uma especificação/exemplo oficial aceite.
2. Confirmar os identificadores de loja, série e referência externa; códigos de artigos e meios de pagamento; impostos/isenções, NUIT e restantes dados fiscais exigidos. Estes dados não são inventados a partir do total pago.
3. Definir se o destino recebe encomendas para emitir documentos ou apenas movimentos contabilísticos. SAF-T de documentos emitidos não é um substituto de uma API de emissão.
4. Ensaiar numa empresa de testes: venda simples, pagamento misto, entrega, desconto, anulação/devolução e reimportação do mesmo pedido sem duplicar documentos.
5. Só depois disponibilizar um formato com o nome do fornecedor. A emissão efectiva depende de autorização e configuração no software de destino.

## Autenticação e integridade

O browser envia o access token da sessão em `Authorization: Bearer`, sem colocá-lo no URL. Renova uma vez em caso de 401. O route handler valida com `getUser(token)` e chama a RPC com a chave pública e o token do utilizador; não usa service role. A autorização de perfil/loja continua na RPC existente.

A leitura usa páginas de até 500 registos com contagem exacta, aceita limites menores do servidor e não gera CSV parcial em caso de erro. Mudanças de contagem durante a leitura obrigam a repetir. Períodos até 366 dias, no máximo 50.000 pagamentos por ficheiro; acima disso é pedido um período menor. Estes limites são explícitos, nunca truncamento silencioso.

A paginação da RPC existente **não é um snapshot transaccional entre pedidos HTTP**: alterações que preservem a contagem durante a exportação não são integralmente detectáveis. Para fechos, usar períodos encerrados e conferir os totais; snapshots fiscais exigem um contrato próprio. Não houve alteração de schema/migration nesta correcção.

## Verificação

- Testes unitários da rota: sessão válida sem cookies (reproduziu 401 antes da correcção), ausência/expiração, permissão negada, filtros inválidos, 1201 pagamentos, limite reduzido no servidor e falha de página/contagem.
- Testes de CSV: centavos, pagamento misto sem duplicar venda, devoluções separadas, escaping, fórmulas, zero vendas e inconsistências.
- Testes do browser: download passa pelo route handler Next real e pelo cliente Supabase; apenas Auth/RPCs são simulados em loopback. O conteúdo do CSV descarregado é conferido. Não substitui staging (B-111).

Resultado final local: 963 testes Vitest, 9 testes Playwright, `pnpm lint` (com TypeScript) e build de produção aprovados. O build usou configuração local de Supabase; não validou uma instalação real. Captura revista: `output/playwright/analysis-exportacao.png`. O teste de download real mantém Auth/RPC simulados e não emite facturas.
