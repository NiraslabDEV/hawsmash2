# Plano de atendimento no site

Plano de Fase 2: tabelas, rotas e widget ainda não existem. `chat_threads`, `chat_messages`, `chat_topics` e `stores.chat_enabled` são propostos. Néo confundir com MCP/WebMCP já implementado. B-021 contém decisões de operação pendentes.

## 19. ATENDIMENTO NO SITE — chat guiado + balcão *(Fase 2 · ideia fechada em 2026-08-28)*

> **Não entra na Fase 1.** Não é nenhum dos cinco não-negociáveis da abertura (§0). Fica aqui escrito
> para que quem o construir depois não tenha de reinventar as regras — nem as parta.

**O que é:** uma bolha de conversa que abre no site do cliente, com **duas camadas**:

1. **Guiada (a que responde sozinha).** O cliente clica numa dúvida de uma lista curta
   ("Fazem entrega para a Matola?", "Quanto tempo demora?", "Aceitam cartão?") e a resposta sobe
   com **atraso e indicador de escrita**, como uma conversa a sério. Não há ninguém do outro lado:
   está tudo escrito de antemão. Cada resposta pode abrir **novas opções** (árvore) ou empurrar
   para uma acção (`ver cardápio`, `escolher loja`, `falar com o balcão`).
2. **Humana (a que empilha no POS).** Se nenhuma opção servir, a conversa passa para o **POS da
   loja**, numa gaveta lateral onde as conversas se empilham por ordem de espera, com badge e som.
   O caixa responde com o teclado de ecrã que já existe (`touch-keyboard.tsx`).

### 19.1 Regras que não se negoceiam

- **A conversa nunca trava a venda** (regra 1). É gaveta lateral no POS, nunca modal. Chat em baixo,
  POS a vender na mesma. **Offline o chat pausa** — é online-only, e isso escreve-se no manual da equipa.
- **`store_id` em `chat_threads` e `chat_messages`** (regra 3), RLS por `auth_can_store()`, com teste
  de isolamento no gate de CI (§11.4). A Matola não lê uma conversa de Maputo.
- **`anon` nunca faz SELECT** (§17). Só RPCs `SECURITY DEFINER`: abrir conversa, enviar, e ler desde
  um `p_since`. O cliente é identificado por **token opaco** guardado no browser — mesmo padrão do
  `get_table_by_token`. **Rate-limit** obrigatório, no espírito do `create_order` (6/hora por telefone):
  sem isso o widget é um megafone para spam.
- **O cliente faz polling** (≈4 s aberto, 15 s minimizado); **o POS usa realtime**, e só para disparar
  `refetch` (§11.3). `anon` não pode subscrever a tabela — abrir SELECT para o realtime funcionar seria
  trocar a regra por conveniência.
- **`stores.chat_enabled`** — kill switch por loja, como o `accepting_orders` (§5.6).
- **As perguntas e as respostas são dados, nunca código** (§18.2/§18.3). Vivem numa tabela
  (`chat_topics`) e editam-se no painel pelo `owner`. Um restaurante seguinte muda as suas dúvidas
  sem deploy — e sem que um `if` saiba o nome do cliente.
- **A bolha só aparece com a loja aberta** (`store_hours`) **e com POS vivo** (`devices.last_seen_at`
  dentro dos 5 min, §11.5). Uma conversa que ninguém vai ler é pior do que não haver conversa.
- **Sem resposta humana em ~3 min → mensagem automática** com **deep link do WhatsApp da loja**.
  O cliente sai dali com um caminho, nunca com um visto azul.
- **O widget responde como HAWSMASH, não como uma pessoa inventada.** O atraso de escrita é ritmo de
  interface; quando entra alguém a sério no balcão, o ecrã diz que entrou. Fingir um nome de atendente
  é uma mentira que se descobre ao segundo cliente que ligar a perguntar por ela.

### 19.2 O que ainda falta decidir
Quem responde, em que horário, e quais são as dúvidas da lista — **[`BLOQUEIOS.md` B-021](../../BLOQUEIOS.md)**.
