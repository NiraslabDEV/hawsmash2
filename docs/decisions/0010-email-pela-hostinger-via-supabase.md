# ADR 0010 — Email pela caixa Hostinger através de uma função no Supabase

- Estado: aceite
- Data: 2026-10-01
- Decisores: Gabriel (Niraslab)
- Complementa: [ADR 0009](0009-email-por-https-resend.md) (o Resend passa a reserva) e [ADR 0004](0004-email-smtp-hostinger.md)

## Contexto

O Railway bloqueia SMTP fora do plano Pro (ADR 0009) e o upgrade não foi possível a 01/10. O Resend
resolveu o envio no mesmo dia, mas o plano grátis tem limite de 100 emails/dia e a loja vai precisar
de mais: alertas, comprovativos, aprovações, recusas, fechos e resumos, em duas lojas.

O 1.0 enviava pela caixa Hostinger do dono a partir de uma Edge Function do Supabase
(`docs/legacy/hawsmash-edge-functions/send-email`), porta 465, sem incidentes. O Supabase deixa sair
SMTP; o Railway não.

## Decisão

`supabase/functions/email-relay` é um relé fino: recebe `{ to, subject, html }` por HTTPS e entrega
pela caixa Hostinger (nodemailer, 465, timeouts curtos). O site chama-o a partir de
`apps/web/lib/email/relay.ts`. A ordem do transporte passa a ser:

1. **relé** (`EMAIL_RELAY_SECRET` no site);
2. **Resend** (`RESEND_API_KEY`), também como reserva quando o relé falha;
3. SMTP da loja no painel;
4. SMTP do servidor.

Segurança da função:
- `verify_jwt = false`. Autentica por um segredo próprio, `x-relay-secret` (≥ 32 caracteres),
  comparado em tempo constante;
- o remetente é sempre o `EMAIL_FROM` da função, nunca o do pedido. Não serve para enviar em nome
  de outro;
- valida até 50 destinatários, assunto e tamanho do HTML.

Segredos da função, no Supabase: `EMAIL_RELAY_SECRET`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` e,
opcionalmente, `SMTP_HOST`/`SMTP_PORT`. No Railway, só o `EMAIL_RELAY_SECRET`.

## Consequências

- Os emails voltam a sair da caixa do próprio dono, como no 1.0, sem o limite diário do Resend. O
  limite passa a ser o da caixa Hostinger.
- Mais uma peça a publicar: `supabase functions deploy email-relay`. Os erros de entrega aparecem
  nos logs da função no Supabase; o site regista o resultado em `email_delivery_log`, como antes.
- Se o relé falhar, o Resend envia. Um timeout do relé depois de a Hostinger ter aceitado pode
  duplicar esse email. É aceitável para avisos e não toca em dinheiro nem em papel.
- Com o Railway em Pro, o relé pode ficar ou sair. Sem `EMAIL_RELAY_SECRET`, o site volta ao Resend
  ou ao SMTP directo.
- As campanhas (`sendStudioMail`) continuam fora deste caminho, como na ADR 0009.
