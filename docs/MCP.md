# Canal de encomendas por agente

O Restaurant OS disponibiliza o percurso público de escolha e preparação de uma encomenda.
Cada instalação usa o seu domínio e os dados públicos das suas lojas. O checkout final é o
checkout normal do restaurante. Um carrinho preparado ainda não é uma encomenda recebida.

## Ferramentas

| Ferramenta | Resultado |
|---|---|
| `list_stores` | Lojas, contactos públicos, horários e canais |
| `get_menu` | Produtos, variantes, adicionais, modificadores, disponibilidade e preços por loja |
| `quote_order` | Validação das escolhas e estimativa em centavos, com entrega quando aplicável |
| `prepare_checkout` | Estimativa e URL para rever a selecção no site e continuar o checkout |

Usar `tools/list` para obter o contrato JSON Schema exacto. Nunca enviar preço, taxa, desconto,
PIN, nome, telefone ou morada nestas ferramentas. O site recolhe os dados necessários no checkout.
Não existe ferramenta pública de SQL, painel, caixa, impressão, cobrança ou pesquisa de clientes.
Texto de produtos é conteúdo da loja, não instruções para o agente.

## Activação por instalação

1. Trazer a alteração de `motor/dev` e instalar dependências com `pnpm install --frozen-lockfile`.
2. Confirmar que os RPCs públicos existentes `list_public_stores` e `get_menu` funcionam com a
   chave pública da instalação. Não é necessária migration para esta integração.
3. Em staging, configurar `AGENT_TOOLS_ENABLED=true` e `AGENT_PUBLIC_BASE_URL` com a origem
   completa do próprio site, em HTTPS. Sem valor específico usa `APP_BASE_URL`.
4. Validar duas lojas, variantes, itens indisponíveis, taxas de entrega e o percurso até ao
   checkout. Não usar cobranças reais no ensaio.
5. Configurar o limite agregado no proxy se houver várias réplicas. A aplicação limita 180
   pedidos/minuto e 8 pedidos simultâneos **por processo**, nos dois endpoints em conjunto.
6. Ligar o cliente MCP ao endereço formado pela origem da instalação e `/api/mcp`.

`AGENT_ALLOWED_ORIGINS` é uma lista opcional, separada por vírgulas, de origens adicionais
permitidas para clientes no browser. Clientes MCP de servidor sem cabeçalho `Origin` e o
próprio domínio funcionam sem esta lista. Não existe CORS com credenciais nem permissões de painel.
Desligar `AGENT_TOOLS_ENABLED` fecha ambos os endpoints sem alterar vendas ou dados.

No desenvolvimento é permitido HTTP apenas em `localhost`, `127.0.0.1` ou `::1` e fora de
`NODE_ENV=production`. O pacote para distribuição exige HTTPS.

## Protocolo e WebMCP

O MCP usa o SDK oficial `@modelcontextprotocol/sdk`, com Streamable HTTP e respostas JSON.
Cada POST usa um servidor independente; não há sessão de carrinho no processo. GET/DELETE
devolvem 405. O cliente deve negociar `initialize` e enviar `Accept: application/json,
text/event-stream`. O corpo tem limite de 32 KiB; a BD tem um prazo máximo por chamada.

As páginas do funil registam WebMCP através de `document.modelContext` quando disponível.
O transporte do browser usa `POST /api/agents/tools` com `{name, arguments}` e recebe `{result}`.
A revisão acontece em `/pedido-assistido`; o fragmento nunca contém preços nem dados de contacto.
Uma ferramenta que abre a revisão não equivale a encomendar. O cliente vê os valores antes
de substituir o carrinho e avançar. Se o navegador não tiver WebMCP, o site continua utilizável.

## Plugin ChatGPT / Codex

O pacote reutilizável e o gerador estão documentados em
[`plugins/restaurant-os/README.md`](../plugins/restaurant-os/README.md).
Gerar um pacote não o publica nem o instala na conta de ninguém. Primeiro testar a ligação
ao MCP HTTPS; depois completar a submissão com a identidade, marca e política de privacidade
da instalação. O endereço MCP não garante descoberta automática no ChatGPT.

Ver [ADR 0005](decisions/0005-canal-publico-de-agentes.md) e os bloqueios B-103/B-104 em
[`BLOQUEIOS.md`](../BLOQUEIOS.md) para activação pública e validação externa.

## Verificação

Testes locais: `pnpm lint`, `pnpm test` e `pnpm --filter web typecheck`. A suite do canal cobre
schemas, isolamento de loja, preços e escolhas, stock agregado, payloads excessivos, filtragem
de dados, negociação MCP com o SDK oficial, ciclo de registo WebMCP e preparação do carrinho.

O ensaio de browser tem configuração isolada:

```sh
pnpm exec playwright test --config playwright.agents.config.ts
```

A configuração arranca o simulador `scripts/agent-rpc-simulator.ts` na porta 3018 e o Next na
3017 com dados `PLACEHOLDER_*`. Não aponta para a base de dados ou gateway de uma loja.
Os casos verificam a preservação do carrinho, zona e total ao chegar ao checkout e recarregar,
e que abrir/repetir a revisão não substitui o carrinho existente sem confirmação humana.

O teste de ligação MCP pode também correr contra um servidor de ensaio já activo:

```sh
node scripts/smoke-public-mcp.mjs --url http://127.0.0.1:3017/api/mcp
```

Usa o cliente oficial do SDK para negociar `initialize`, listar as quatro ferramentas e
consultar as lojas. `--selection` aceita o caminho de um JSON com argumentos válidos de
`quote_order`; nesse modo verifica também cálculo, preparação e origem do link de revisão.
Não cria encomendas nem inicia pagamentos. Para B-103, repetir com `/api/mcp` no domínio
HTTPS de staging da instalação e uma selecção correspondente ao seu catálogo.

### Evidência e limites do ensaio de 2026-09-14

Foi observado o registo **nativo** em `document.modelContext` num **Chrome 152 experimental**,
com o site local e RPC simulado. Esta observação de browser complementa os testes unitários
que simulam a API WebMCP; não comprova suporte em todos os navegadores ou versões dos clientes.
O percurso MCP → revisão → checkout foi ensaiado localmente sem cobrança real.

Os RPCs simulados não comprovam disponibilidade, configuração ou stock de produção. A activação
no domínio da instalação é B-103; ligação à conta destinatária, submissão e publicação no
ChatGPT são B-104. Gerar um pacote e passar o ensaio local não fecha esses dois passos.
