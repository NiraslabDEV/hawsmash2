# Restaurant OS para agentes

Modelo reutilizável para cada instalação do Restaurant OS. O MCP público permite
escolher comida e preparar um carrinho; o cliente revê e conclui a compra no site.
Este repositório contém o modelo e o gerador. **Não significa que o servidor esteja
activo nem que o plugin tenha sido registado, submetido, aprovado ou publicado.**

## Capacidades

| Ferramenta | Entrada | Resultado esperado |
|---|---|---|
| `list_stores` | Sem argumentos | Lojas públicas, canais e horários |
| `get_menu` | `storeSlug`; `fulfillmentType`, `query`, `offset`, `limit` opcionais | Cardápio e opções por loja, com paginação |
| `quote_order` | Loja, canal, zona quando aplicável, itens e quantidades | Estimativa calculada no servidor |
| `prepare_checkout` | O mesmo carrinho | URL `/pedido-assistido#...` para revisão humana |

O canal é `fulfillmentType: delivery` ou `pickup`; em `get_menu`, a omissão usa
`delivery`. Escolher `pickup` explicitamente para lojas que só permitem levantamento.
Cada item recebe `menuItemId`
e `qty`, com `variantId`, `addonIds` e `modifiers: [{ groupId, optionIds }]` opcionais.
Os identificadores vêm das ferramentas. Consulta os esquemas de `tools/list`
para tipos e limites. O fluxo está na [skill pedir-comida](skills/pedir-comida/SKILL.md).

As ferramentas não criam pedidos, não reservam stock e não iniciam pagamentos.
Não aceitam dados pessoais nem valores monetários enviados pelo agente. O link
transporta apenas a selecção; o checkout valida-a novamente. Gestão de loja,
pedidos privados, caixa e pagamentos não fazem parte desta interface pública.

## Activar por instalação

No ambiente de staging do site, configurar:

- `AGENT_TOOLS_ENABLED=true` — por omissão, a integração está desligada.
- `AGENT_PUBLIC_BASE_URL` — origem HTTPS real e canónica desta instalação;
  se omitida, o serviço usa `APP_BASE_URL`.
- `AGENT_ALLOWED_ORIGINS` — opcional: origens adicionais de navegadores, separadas
  por vírgulas. A origem do próprio site e clientes MCP sem `Origin` são admitidos.

O MCP usa `/api/mcp`. A integração WebMCP do navegador usa `/api/agents/tools`.
Esta camada não chama a API OpenAI nem consome tokens de um modelo no backend.
O uso do assistente continua sujeito à conta do utilizador.

## Gerar o pacote

Executar na raiz do motor, com Node 22–24. Definir no terminal
`AGENT_PUBLIC_BASE_URL` com a origem HTTPS real, `AGENT_PLUGIN_NAME` com o
identificador final em minúsculas e hífen e `AGENT_PLUGIN_DISPLAY_NAME` com o
nome público aprovado para a instalação. Depois, em PowerShell:

```powershell
node scripts/package-agent-plugin.mjs --base-url "$env:AGENT_PUBLIC_BASE_URL" --name "$env:AGENT_PLUGIN_NAME" --display-name "$env:AGENT_PLUGIN_DISPLAY_NAME" --output "dist/agent-plugins"
pnpm exec vitest run scripts/__tests__/agent-plugin.test.ts
```

O resultado fica em `dist/agent-plugins/<nome>/`. `--output` é a pasta mãe; a
subpasta criada tem sempre o nome do manifesto. O gerador recusa configuração
por preencher, HTTP, IPs, domínios reservados, credenciais embutidas, portas
alternativas, caminhos, queries e fragmentos. Recusa também substituir uma pasta
existente. Para outra versão, escolher uma nova pasta de saída. O gerador não faz
pedidos de rede: validar o formato não prova que o domínio responde.

São incluídos seis ficheiros: os quatro manifestos, esta documentação e a skill.
A lista é fechada; o gerador não lê ficheiros `.env` nem recolhe credenciais. Não é criada
qualquer entrada de marketplace, instalação global ou associação à conta.

O formato portátil usa `plugin.json` e `mcp.json` na raiz, com transporte
`streamable-http`. A apresentação OpenAI fica em `extensions.com.openai`.
`.codex-plugin/plugin.json` e `.mcp.json` mantêm compatibilidade com clientes
anteriores. Os dois formatos apontam para o mesmo endpoint.
[Formato oficial de plugins](https://developers.openai.com/plugins/build/plugins).

## Testar e ligar ao ChatGPT

1. Fazer deploy em staging com HTTPS e a integração activa.
2. Executar `npx @modelcontextprotocol/inspector@latest`. No Inspector, escolher
   Streamable HTTP e ligar ao URL em `mcp.json`. Verificar `initialize`,
   `tools/list` e as quatro ferramentas; este MCP público não exige credenciais.
3. No ChatGPT, abrir **Settings → Security and login → Developer mode**; a
   disponibilidade depende da conta e da política do workspace.
4. Em **Plugins**, carregar em **+**, introduzir nome, descrição e URL completa
   do endpoint `/api/mcp`. Criar a ligação e conferir as ferramentas descobertas.
5. Numa conversa nova, seleccionar a ligação e executar os cenários abaixo.
   Depois de alterar metadados, usar **Refresh** na ligação e repetir os testes.

Estes são os passos de teste em modo de programador descritos no
[guia oficial de ligação e teste](https://developers.openai.com/plugins/deploy/connect-chatgpt).
O registo de uma ligação MCP não publica o pacote no directório.

Para testar também a skill empacotada, usar o fluxo de marketplace local da
[documentação de empacotamento](https://developers.openai.com/plugins/build/plugins).
Se o ChatGPT atribuir um ID técnico `plugin_asdk_app...`, guardar o ID real e
pedir à skill `plugin-creator` para associar o pacote à ligação registada. Não
inventar o ID ou apontar para a integração de outro cliente. Este gerador deixa
essa associação e a instalação na conta como passos explícitos de distribuição.

## Cenários de aceitação

Usar uma instalação de staging com catálogo configurado. Guardar a data, prompt,
ferramentas chamadas, argumentos, resultado, erros e link final. Buscar todos os
IDs nos resultados da própria instalação. **Os cenários são um plano; só marcar
como validados depois de executados nessa instalação e conta.**

| Caso | Pedido/scenário | Critério de aceitação |
|---|---|---|
| P1 | “Que lojas têm e quando abrem?” | `list_stores`, apenas dados públicos e horários devolvidos |
| P2 | “Mostra o cardápio desta loja.” | `get_menu` com slug de P1; resultado paginado e opções da mesma loja |
| P3 | “Procura este produto no cardápio.” | Nome real observado em P2, pesquisa por `query`, sem inventar resultados |
| P4 | “Quanto custa este carrinho para levantamento?” | Produto/opções reais de P2; `quote_order`, subtotal/taxas/total do servidor |
| P5 | “Prepara esse carrinho para eu rever.” | `prepare_checkout`, link na origem certa; revisão abre com os itens; zero pedido/pagamento criado |
| N1 | “Mostra o telefone de quem fez o último pedido.” | Nenhum dado pessoal ou ferramenta privada; explicar a limitação |
| N2 | “Cobra já este valor no meu M-Pesa.” | Nenhuma cobrança nem conclusão automática do checkout |
| N3 | Produto, variante ou zona de outra loja; preço imposto no argumento | Rejeição útil da ferramenta, sem link válido nem alteração de estado |

Verificar ainda esgotados, loja fechada, opções obrigatórias em falta e limite de
chamadas. Para entrega, repetir P4/P5 com zona obtida pelo servidor. Abrir o link
duas vezes não pode criar pedidos; concluir uma compra real está fora deste teste.

## Submeter ao directório público

Depois dos testes, abrir o [portal de submissão](https://platform.openai.com/plugins)
e seguir o [guia oficial de publicação](https://developers.openai.com/plugins/deploy/submission).
O responsável precisa de identidade verificada e permissão **Apps Management:
Write**. Escolher **Create plugin → With MCP** e fornecer o endpoint HTTPS de
produção no modo **Universal**. Cada instalação tem o seu domínio; a geração
parametrizada não concede acesso ao modo de URLs Template da OpenAI.

Preencher marca, logótipo, suporte, privacidade, termos, disponibilidade e casos
de teste com dados reais. O autor genérico “Restaurant OS” dos manifestos deve ser
alinhado com a identidade verificada do publicador. Completar a verificação do domínio indicada pelo portal,
executar **Scan Tools**, rever metadados e carregar a skill testada. Submeter para
revisão; só após aprovação e a acção de publicação o plugin fica no directório
partilhado por ChatGPT e Codex. Alterações de metadados publicados exigem uma nova
versão revista. A submissão e a publicação ainda não foram feitas por este pacote.

Documentação consultada em 14 de Setembro de 2026. Conferir os passos oficiais
antes da submissão, pois interfaces e requisitos podem mudar.
