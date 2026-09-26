# Crons e tarefas agendadas

## Contrato actual

| Handler | Protecção observada | Comportamento / dependência |
|---|---|---|
| alerts | Só valida Bearer se CRON_SECRET existir | Cooldown 30 min; list_system_alerts_all; SMTP/WhatsApp deep link |
| conversions | Só valida Bearer se CRON_SECRET existir | Claim/processamento da outbox; credenciais de cada rede |
| digest | Só valida Bearer se CRON_SECRET existir | get_daily_digest, resumo diário/email |
| monthly | Recusa ausência de CRON_SECRET (503) | get_monthly_digest, fotografia Google, deduplicação/force; B-114 |
| reconcile | Recusa ausência de CRON_SECRET (503) | Até 300 pedidos por passagem, páginas de 50, 3 consultas em paralelo, orçamento 50 s/consulta 20 s; nextCursor até completed; B-106 |

Não há `cron.schedule` nas migrations nem agendador em `railway.json`. Horários indicados nos docs são configuração desejada, não prova de execução.

Ver [ambiente](ambiente.md), [relatórios](../modulos/relatorios.md), [pagamentos](../modulos/pagamentos.md) e [B-106/B-114](../../BLOQUEIOS.md). Agendar é uma acção de instalação; esta documentação não configura serviços nem envia mensagens. O resumo mensal é trabalho local anterior ainda não publicado por esta revisão.
