# Emails no painel

`/emails`, só para o dono, com selector de loja. Migration **1104**.

## Utilização

1. **Configuração:** servidor SMTP, porta TLS/STARTTLS, utilizador, palavra-passe,
   remetente e responder-para. Guardar e testar a ligação; o teste não envia emails.
   A palavra-passe fica no Vault, não regressa ao painel e não entra em `event_log`.
   O destinatário adicional dos relatórios edita o `stores.owner_email` existente.
   `OWNER_EMAIL` continua o destinatário central configurado no Railway.
2. **Transaccionais:** uma sequência por evento (pagamento confirmado, pronto,
   entregue, cancelado). Editar assunto, pré-visualização e blocos de título,
   texto, imagem HTTPS, botão HTTPS e separador. Variáveis: `{{nome}}`, `{{loja}}`,
   `{{pedido}}`, `{{total}}`. Reordenar blocos e etapas, acrescentar até 12 emails.
3. **Promoções e funis:** criar, editar, duplicar, activar, pausar ou arquivar.
   Gatilho manual (botão de inscrição dos contactos) ou novo contacto com consentimento.
   Uma campanha simples é um funil de uma etapa. Comprar não inscreve em marketing.
4. **Contactos:** nome, email e origem/data do consentimento; cancelamento por loja.
   Não se reactiva um cancelado por adicionar o mesmo endereço.
5. **Histórico:** fila, envio em curso, aceite pelo SMTP, falha, cancelado ou incerto.
   Páginas de 50, horários de Maputo. Aceite pelo SMTP não prova entrega/leitura.

## Sequências e segurança

A primeira espera conta desde o evento/inscrição. Cada espera seguinte conta desde
o envio real anterior. Minutos, horas ou dias; máximo 365 dias por etapa. UTC na BD.
Guardar altera **novas** inscrições; cada inscrição congela assunto, conteúdo e
intervalos. Pausar impede novos envios; retomar liberta os vencidos. Arquivar cancela
mensagens ainda na fila. Um envio SMTP já iniciado pode terminar.

O trigger dos pedidos só escreve na fila e é best-effort: nunca chama SMTP nem
reverte uma venda por falha de email. Aprovações/recusas antigas não enviam uma
segunda mensagem quando o evento já foi entregue à fila. Códigos de acesso,
comprovativos ao dono e relatórios conservam o conteúdo operacional do sistema.

Chave única `(flow_id,event_key,recipient,step_index)` impede inscrições duplicadas.
Claim com `FOR UPDATE SKIP LOCKED`, até cinco mensagens por chamada. Consentimento
e estado são revistos imediatamente antes do envio. Cancelamento por token aleatório
com POST de confirmação; GET de um scanner não cancela. HTML escapado, sem HTML livre.

**DECISÃO:** SMTP não garante exactamente um envio durante falha de rede. Não há
retries automáticos: falha fica visível e envio interrompido passa a incerto após
10 minutos. Confirmar no fornecedor antes de criar nova campanha. A etapa seguinte
só é agendada depois de a anterior ficar aceite e persistida.

Configuração do painel tem prioridade sobre envs SMTP para a loja. Emails gerais e
relatórios usam a primeira configuração activa na ordem das lojas. As envs SMTP
antigas continuam como alternativa dos emails operacionais. Desligar no painel
suspende sempre a fila dos novos funis.

## Instalação e ensaios

- Aplicar 1104 primeiro em staging; publicar o código.
- `APP_BASE_URL`: origem HTTPS do ambiente, para os links de cancelamento.
- Vault: `app_cron_base_url` e `app_cron_secret`, iguais aos do ambiente.
- `scripts/sql/install-email-cron.sql`: `app-emails`, de minuto a minuto,
  `/api/cron/emails`, Bearer `CRON_SECRET`. HTTP síncrono no scheduler, nunca na venda.
- `scripts/sql/test-email-studio.sql`: transacção desfeita; consentimento, isolamento,
  idempotência, pausa, claim, intervalo, cancelamento e permissões. Não cria/apaga
  pedidos nem chama SMTP.
- Unitários: HTML, URLs, intervalos, duplicação de transaccionais, autenticação,
  cancelamento depois de claim e persistência após SMTP.

Sem credenciais SMTP a edição funciona e o envio fica pendente (B-114). Não há
tracking de aberturas/cliques, importação CSV, editor de HTML livre ou reactivação
automática de contactos cancelados nesta entrega.

Staging verificado em 28/09: funil de boas-vindas guardado como rascunho (5 minutos
e 1 dia), preview móvel, reabertura, configurações, 401 sem autorização e execução
natural do cron. Nenhum contacto inscrito e nenhum envio real realizado.
