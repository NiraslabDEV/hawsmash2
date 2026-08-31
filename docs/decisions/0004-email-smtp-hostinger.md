# ADR 0004 — Email transacional por SMTP (Hostinger), não Resend

- Estado: aceite
- Data: 2026-08-31
- Decisores: Ridwan (HAWSMASH) / Niraslab

## Contexto

O `CLAUDE.md §3` fixava Resend como o provedor de email transacional, herdado do motor Delivery OS. O
HAWSMASH 1.0, porém, nunca usou Resend: envia tudo por SMTP através da caixa de email do próprio dono na
Hostinger (`smtp.hostinger.com:465`, `docs/legacy/hawsmash-edge-functions/send-email/index.ts`), e essa
configuração já está validada em produção há meses sem incidentes.

Manter dois provedores diferentes entre o 1.0 e o 2.0 não tem benefício — obriga a contratar/gerir uma conta
Resend nova só para repetir o que já funciona, e adiciona uma dependência externa paga que o cliente não
pediu.

## Decisão

O envio de email do 2.0 passa a usar SMTP directo (via `nodemailer`), com a mesma caixa Hostinger que o
dono já usa no 1.0. Um único módulo server-side (`apps/web/lib/email/transport.ts`) concentra a configuração
do transporte e expõe `sendMail()` e `isEmailConfigured()`; as rotas (`app/api/emails/*`, `app/api/account/code`,
`app/api/cron/alerts`, `app/api/cron/digest`) deixam de instanciar um cliente de provedor cada uma.

Variáveis de ambiente: `SMTP_HOST` (default `smtp.hostinger.com`), `SMTP_PORT` (default `465`), `SMTP_USER`,
`SMTP_PASS`, `EMAIL_FROM`. Substituem `RESEND_API_KEY`/`RESEND_FROM_EMAIL` em todo o lado — `.env.example`,
`scripts/lib/validate-config.mjs`.

## Consequências

- Sem conta Resend a pagar/gerir; a caixa de email já é do dono e já está quente (não cai em spam por ser
  remetente novo).
- O comportamento *best-effort* do §1 mantém-se: sem `SMTP_USER`/`SMTP_PASS`, `isEmailConfigured()` devolve
  `false` e nada bloqueia — exactamente como acontecia sem `RESEND_API_KEY`.
- Um envio SMTP directo depende da caixa da Hostinger estar acessível e não ter atingido limites de envio
  (a Hostinger limita volume/hora por plano); não há dashboard de entregabilidade como o Resend tinha. Para
  o volume do HAWSMASH (confirmações, aprovações, digest diário, fecho de caixa) isto não é um problema
  esperado, mas fica registado caso o volume cresça muito.
- Se um cliente futuro do produto empacotado (`§18`) não tiver uma caixa SMTP própria, a alternativa
  (Resend ou outro) volta a ser uma opção — o módulo `apps/web/lib/email/transport.ts` é o único sítio a
  trocar.
