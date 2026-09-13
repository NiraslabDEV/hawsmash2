# ADR 0005 — MCP público e WebMCP no Restaurant OS

Data: 2026-09-14. Estado: aceite para a primeira entrega do canal de encomendas.

## Contexto

O motor serve várias empresas, cada uma com domínio, deploy e base de dados próprios.
O cliente deve conseguir escolher comida através de um agente e continuar a encomenda
no restaurante certo. A integração é de produto e nasce no motor; instalações recebem-na por merge.

## Decisão

- Um endpoint `/api/mcp` por instalação, com o SDK MCP oficial e Streamable HTTP sem sessões.
- Quatro ferramentas públicas: `list_stores`, `get_menu`, `quote_order`, `prepare_checkout`.
- WebMCP regista ferramentas no documento das páginas públicas quando o navegador suporta a API.
- Ambos os transportes chamam o mesmo serviço validado com Zod. Acesso à BD apenas através dos
  RPCs públicos `list_public_stores` e `get_menu`, com chave pública e sem cookies de administrador.
- A empresa é determinada pela configuração do deploy. O agente escolhe uma loja dessa empresa,
  por `storeSlug` explícito. Não escolhe URL de backend, SQL, empresa ou nome de RPC.
- Preparar carrinho é leitura: não cria pedido, reserva stock, imprime nem cobra. O link contém
  somente IDs e quantidades/escolhas no fragmento; não leva contactos, morada, PIN ou preços.
- A página de revisão consulta novamente o servidor e só substitui o carrinho após acção explícita.
  O checkout existente continua a recalcular o preço definitivo e a gerir a encomenda/pagamento.
- Configuração reversível `AGENT_TOOLS_ENABLED=false` por omissão, sem migrations nem alterações
  ao schema operacional. A activação exige origem configurada; em produção é HTTPS.

As regras actuais do ChatGPT exigem checkout externo no domínio do comerciante para este caso.
Esta entrega permite o percurso público de encomenda; ferramentas de gestão e consultas de
dados privados precisam de uma integração autenticada, com autorização por acção e por loja.
O endereço público MCP, por si só, não concede essas permissões.

## Consequências verificáveis

Os mesmos IDs/quantidades podem ser repetidos sem criar encomendas duplicadas. Valores monetários
são centavos inteiros; a estimativa não aplica cupões nem promete stock reservado. Variantes,
adicionais, modificadores, canal e zona pertencem à loja/produto consultados.

O limite de pedidos protege cada processo web e é partilhado pelos dois transportes. Para várias
réplicas, o proxy precisa também de limite agregado antes da exposição pública. Não se trata
um cabeçalho de IP enviado pelo cliente como identidade. Falhas do canal não bloqueiam a loja.

O plugin é empacotado por instalação. Publicar HTTPS, registar a ligação no ChatGPT, validar a
identidade/política de privacidade e obter publicação no directório são passos separados.
WebMCP depende do navegador: a ausência da API mantém o funcionamento normal do site.

## Referências consultadas

- [Servidor MCP para plugins OpenAI](https://developers.openai.com/plugins/build/mcp-server)
- [Empacotamento de plugins](https://developers.openai.com/plugins/build/plugins)
- [Regras de checkout dos plugins](https://developers.openai.com/plugins/app-guidelines#checkout)
- [WebMCP, API imperativa do Chrome](https://developer.chrome.com/docs/ai/webmcp/imperative-api)
- [Transporte MCP oficial para TypeScript](https://ts.sdk.modelcontextprotocol.io/server)
