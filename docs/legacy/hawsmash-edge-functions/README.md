# Edge Functions — HAWSMASH (Supabase `tsrgileifpiaiicwjfar`)

Funções em produção (todas `verify_jwt: false` — autenticam por apikey/lógica própria):

| Função | O que faz |
|---|---|
| `create-order` | Cria pedido recalculando preços no servidor (fonte de verdade). **Versionada aqui.** |
| `send-email` | Emails transacionais (novo pedido p/ dono, confirmado, pronto). Descarrega o comprovativo com service key e embute em base64. |
| `approve-order` | Link de aprovar/recusar pagamento no email do dono. |
| `feedback-email` | Email de pedido de avaliação. |
| `send-apology` | Email de desculpa/recuperação. |
| `weekly-report` | Relatório semanal. |
| `send-caixa` | Fecho de caixa por email. |
| `review-blast` | Campanha de avaliações. |

## Puxar todas para versionar (Supabase CLI)

```bash
supabase functions download create-order send-email approve-order \
  feedback-email send-apology weekly-report send-caixa review-blast \
  --project-ref tsrgileifpiaiicwjfar
```

Segredos usados (definidos no painel Supabase, **nunca** no código):
`SUPABASE_SERVICE_ROLE_KEY`, `SMTP_PASS`.
