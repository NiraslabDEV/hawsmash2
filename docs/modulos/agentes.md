# Canal de encomendas por agente

Este módulo permite consultar lojas, escolher produtos e preparar uma selecção para o checkout do restaurante. Um carrinho preparado não é uma encomenda: não reserva stock, não cobra, não imprime e não cria pedidos.

**Estado:** implementação presente na árvore auditada em 26 de Setembro de 2026. O ensaio local referido abaixo não demonstra activação no domínio de uma instalação nem publicação no ChatGPT. As decisões estão no [ADR 0005](../decisions/0005-canal-publico-de-agentes.md).

## Quem usa e o que pode fazer

Agentes e browsers usam apenas dados públicos, sem sessão de staff. A empresa é a do deploy; a loja é escolhida por `storeSlug`. Não existe ferramenta pública de SQL, caixa, painel, impressão, cobrança ou pesquisa de clientes.

| Ferramenta | Resultado |
|---|---|
| `list_stores` | Lojas, contactos públicos, horários e canais |
| `get_menu` | Produtos, variantes, adicionais, modificadores, disponibilidade e preços da loja |
| `quote_order` | Escolhas validadas e estimativa em centavos, com entrega quando aplicável |
| `prepare_checkout` | Estimativa e URL de revisão no domínio da instalação |

O contrato exacto obtém-se com `tools/list`. Os argumentos não incluem preço, desconto, PIN, nome, telefone ou morada. O texto de produtos é conteúdo da loja, não uma instrução para o agente. Cupões e reserva de stock não fazem parte da estimativa.

## Fluxo e transportes

1. O agente consulta lojas e cardápio e envia IDs, quantidades e escolhas ao serviço comum validado com Zod.
2. O serviço consulta novamente o catálogo e calcula a estimativa. Variantes, adicionais, modificadores e zona têm de pertencer à selecção consultada.
3. A preparação devolve uma URL de `/pedido-assistido` com a selecção no fragmento. O fragmento não transporta preços nem contactos.
4. A revisão volta a consultar preços/disponibilidade. Só uma confirmação explícita substitui o carrinho existente.
5. O [checkout normal](site-checkout.md) recolhe os dados e recalcula o preço definitivo no servidor.

O MCP usa o SDK oficial, Streamable HTTP e respostas JSON. Cada POST cria um servidor independente; o processo não guarda sessões de carrinho. O cliente negocia `initialize` e envia `Accept: application/json, text/event-stream`. GET e DELETE estão tratados mas devolvem 405. O corpo tem limite de 32 KiB e as consultas à BD têm timeout.

O WebMCP regista ferramentas em `document.modelContext`, quando essa API existe, nas páginas do funil. O transporte do browser usa POST `/api/agents/tools` com nome e argumentos. Sem WebMCP o site continua utilizável. Abrir a revisão não equivale a encomendar.

## Dados, RPCs e auditoria

Este canal não acrescenta tabelas nem migrations. Lê indirectamente lojas, horários, catálogo e disponibilidade através de `list_public_stores` e `get_menu`, com chave pública e sem cookies de administrador. Não aceita URL de backend nem nome de RPC escolhido pelo chamador.

Não grava eventos de operação em `event_log`: preparar uma selecção é leitura. Se a pessoa concluir a compra, os eventos são os do percurso normal de [pedidos](pedidos.md), [pagamentos](pagamentos.md) e [marketing](marketing.md).

| Código / rota | Responsabilidade |
|---|---|
| [Serviço e schemas](../../apps/web/lib/agents/) | Validação, leitura pública, orçamento de pedidos, MCP/WebMCP e fragmento |
| [Handler MCP](../../apps/web/app/api/mcp/route.ts) | `/api/mcp` |
| [Handler do browser](../../apps/web/app/api/agents/tools/route.ts) | `/api/agents/tools` |
| [Revisão da selecção](<../../apps/web/app/(public)/pedido-assistido/page.tsx>) | Revalidação e confirmação humana |
| [Registo WebMCP](<../../apps/web/app/(public)/agent-tools.tsx>) | Ferramentas nas páginas elegíveis |
| [Pacote do plugin](../../plugins/restaurant-os/README.md) | Empacotamento reutilizável por instalação |

## Configuração da instalação

Por omissão, `AGENT_TOOLS_ENABLED` fica desligada. Activar em staging exige origem configurada em `AGENT_PUBLIC_BASE_URL`, com fallback para `APP_BASE_URL`. Em produção a origem tem de usar HTTPS. HTTP de desenvolvimento só é aceite em localhost/loopback fora de produção; o pacote distribuído exige HTTPS.

`AGENT_ALLOWED_ORIGINS` permite origens adicionais de browser, separadas por vírgulas. O próprio domínio e clientes MCP sem cabeçalho Origin não precisam dessa lista. Não há CORS com credenciais de painel.

O orçamento é partilhado pelos dois transportes: 180 pedidos por minuto e oito em simultâneo **por processo**. Várias réplicas precisam também de limite agregado no proxy. Um cabeçalho de IP fornecido pelo cliente não é tratado como identidade. Desligar a flag fecha os transportes e preserva o checkout normal.

A sequência operacional é instalar dependências, conferir as duas RPCs públicas com a chave pública, configurar staging, ensaiar duas lojas/escolhas/indisponibilidades/taxas e só depois ligar o cliente ao MCP HTTPS da instalação. O ensaio não requer cobrança real. Gerar o plugin não o instala, não o publica nem garante descoberta no ChatGPT; identidade, marca, política de privacidade e submissão são passos separados.

## Testes, evidência e limites

- [Testes de domínio/transporte](../../apps/web/lib/agents/__tests__/) cobrem schemas, escolhas/preços, stock agregado, filtragem de dados, limites, negociação MCP e registo WebMCP.
- [E2E](../../e2e/agents.spec.ts) usa a [configuração dedicada](../../playwright.agents.config.ts): simulador RPC na porta 3018 e Next na 3017, com dados sintéticos. Confere carrinho, zona, total, reload e confirmação antes da substituição.
- [Smoke MCP](../../scripts/smoke-public-mcp.mjs) negocia com o cliente oficial, lista ferramentas e consulta lojas; uma selecção de ensaio permite verificar estimativa/preparação. Não cria pedidos nem inicia pagamentos.

Comandos de ensaio, num ambiente isolado preparado para testes: `pnpm exec playwright test --config playwright.agents.config.ts` e `node scripts/smoke-public-mcp.mjs --url http://127.0.0.1:3017/api/mcp`. Lint, testes unitários e typecheck são verificações separadas; ver [testes](../referencia/testes.md).

O registo de 14/09/2026 descreve WebMCP nativo num Chrome 152 experimental e percurso MCP → revisão → checkout com RPC simulado. Não demonstra suporte universal de browsers, disponibilidade/stock da instalação ou publicação externa. A validação HTTPS permanece em **B-103** e a ligação/publicação no ChatGPT em **B-104**, no [registo de bloqueios](../../BLOQUEIOS.md). Esta reorganização documental não repetiu esses ensaios.
