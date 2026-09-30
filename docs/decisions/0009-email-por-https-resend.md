# ADR 0009 — Email transacional por HTTPS (Resend) quando o alojamento bloqueia SMTP

- Estado: aceite
- Data: 2026-09-30
- Decisores: Gabriel (Niraslab) — com o dono informado
- Complementa: [ADR 0004](0004-email-smtp-hostinger.md) (SMTP Hostinger continua a ser o caminho de reserva)

## Contexto

A 28/09 e outra vez a 30/09, a partir do contentor de produção no Railway (`hawsmash2 / production`, o
que serve `hawsmash.com`):

| Destino | Resultado |
|---|---|
| `smtp.hostinger.com` 465, 587 e 2525 | `ETIMEDOUT` |
| `smtp.gmail.com` 465 | `ETIMEDOUT` |
| `api.resend.com` 443 | liga |

O Railway corta a saída SMTP fora do plano Pro. A autenticação SMTP "que passou" nos registos de 28/09
foi testada fora do Railway. Na semana até 30/09, `email_delivery_log` só tem envios `failed` (alertas,
fechos de turno, fechos do dia, comprovativos). O dono não recebe nada.

O plano é passar o Railway a Pro, mas isso não é imediato. Os emails são best-effort (§1), mas os
alertas e os fechos existem para o suporte ser barato (§0): sem eles, a primeira pessoa a saber de uma
falha é o cliente ao telefone.

## Decisão

`apps/web/lib/email/resend.ts` envia pela API HTTPS do Resend (`POST /emails`, timeout de 10 s, nunca
lança). `transport.ts` escolhe, por ordem:

1. **Resend**, se houver `RESEND_API_KEY`. Remetente = `EMAIL_FROM`, que tem de ser do domínio
   verificado no Resend (`hawsmash.com`, com os registos DNS na Hostinger);
2. o SMTP da loja configurado no painel (1104);
3. o SMTP do servidor (`SMTP_USER`/`SMTP_PASS`, ADR 0004).

Trocar de caminho é mudar uma variável: com o Railway em Pro, apagar `RESEND_API_KEY` devolve o envio
à caixa Hostinger do dono, sem deploy de código.

**Fica fora do Resend:** as campanhas e sequências do módulo de emails (`/api/cron/emails`,
`sendStudioMail`). Continuam no SMTP configurado no painel. O plano grátis do Resend (100/dia,
3 000/mês) não pode ser gasto numa campanha e deixar os emails dos pedidos sem quota.

## Consequências

- Os emails do sistema (comprovativo ao dono, aprovação/recusa ao cliente, alertas, fecho de turno e do
  dia, resumos, código de conta) voltam a sair sem esperar pelo Pro.
- Depende de uma conta externa (Resend) e de três a quatro registos DNS no `hawsmash.com`. O DNS de
  envio do Resend vive num subdomínio (`send.`) e não mexe no MX da caixa Hostinger.
- Limite do plano grátis: 100 emails/dia. Os alertas automáticos sozinhos tentaram 167 envios numa
  semana. Se o limite for atingido, os envios desse dia falham como hoje (registados em
  `email_delivery_log`), sem travar vendas.
- O teste de ligação SMTP do painel continua a falhar no Railway até ao Pro. É esperado e não afecta
  o Resend.
- Validação: `scripts/lib/validate-config.mjs` aceita Resend **ou** SMTP e exige `EMAIL_FROM` com
  endereço quando há `RESEND_API_KEY`.
