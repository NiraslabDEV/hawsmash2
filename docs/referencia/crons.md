# Crons e tarefas agendadas

## Contrato actual

| Handler | Protecção observada | Comportamento / dependência |
|---|---|---|
| alerts | Recusa ausência de CRON_SECRET (503) | Cooldown 30 min; list_system_alerts_all; SMTP/WhatsApp deep link |
| conversions | Recusa ausência de CRON_SECRET (503) | Claim/processamento da outbox; credenciais de cada rede |
| digest | Recusa ausência de CRON_SECRET (503) | get_daily_digest, resumo diário/email |
| monthly | Recusa ausência de CRON_SECRET (503) | get_monthly_digest, fotografia Google, deduplicação/force; B-114 |
| reconcile | Recusa ausência de CRON_SECRET (503) | Até 300 pedidos por passagem, páginas de 50, 3 consultas em paralelo, orçamento 50 s/consulta 20 s; nextCursor até completed; B-106 |

## Instalação verificada em staging — 27/09/2026

O Supabase de staging tem dois jobs activos, instalados por
[`install-report-crons.sql`](../../scripts/sql/install-report-crons.sql):

| Job | UTC | Maputo | Período |
|---|---|---|---|
| app-digest | `0 6 * * *` | Todos os dias às 08h | Dia anterior completo, passado em `?day=` |
| app-monthly | `0 6 1 * *` | Dia 1 às 08h | Último mês fechado |

Os jobs lêem `app_cron_base_url` e `app_cron_secret` no Vault. O segredo coincide
com `CRON_SECRET` no Railway; não aparece no SQL versionado nem no comando do job.
Usam a extensão `http` com limite de 120 segundos, só no processo do cron.
Uma resposta 200 com envio omitido/falhado faz o job falhar; consultar o histórico
em `cron.job_run_details` e `event_log`. Não repetir automaticamente envios ambíguos.
Executar o instalador novamente actualiza os mesmos nomes sem duplicar jobs.

Ensaio HTTP real: ambas as rotas responderam 200 e `delivery=skipped_no_key`.
O diário foi conferido com o dia anterior em Maputo. **Falta SMTP, não houve envio
de email.** O primeiro disparo natural do relógio ainda está por observar.
O deploy de staging inclui 1096, a secção Google e autenticação fechada por omissão;
1101 corrige a expressão regular de Place ID rejeitada pelo PostgreSQL.

Em produção, nem o agendador nem as variáveis da aplicação foram activados:
o ambiente está sem Supabase/SMTP (B-022). Antes da promoção, desactivar os jobs
de staging para evitar enviar dados de ensaio ao dono. Os restantes endpoints
(alerts, conversions, reconcile) não foram agendados nesta instalação dos relatórios.

Referências: [Supabase Cron](https://supabase.com/docs/guides/cron/quickstart)
e [HTTP](https://supabase.com/docs/guides/database/extensions/http).

Ver [ambiente](ambiente.md), [relatórios](../modulos/relatorios.md), [pagamentos](../modulos/pagamentos.md) e [B-106/B-114](../../BLOQUEIOS.md).
