# ADR 0011 — WhatsApp Business por um adaptador, a começar pela loja de Maputo

- Estado: aceite
- Data: 2026-10-30
- Decisores: Gabriel (Niraslab)
- Plano: [docs/planos/whatsapp.md](../planos/whatsapp.md)

## Contexto

Hoje o WhatsApp é só click-to-chat (`wa.me/258860760009` na marca) e deep link nos alertas (§11.5). O cliente
não sabe do pedido sem abrir o email, e quem escreve para a loja espera que alguém responda à mão.
A API do WhatsApp é uma **integração de terceiros**, que a proposta `NL-2026-HS-EXP` deixou fora do âmbito
(CLAUDE §0). Entra como extensão decidida pelo dono do produto, sem tocar nos cinco não-negociáveis.

O mesmo módulo vai depois para o Gym OS e para o motor. Tem de sair daqui **portátil**.

## Decisão

1. **Um número por loja**, todos na mesma conta WhatsApp Business (WABA) do HAWSMASH. Começa só **Maputo
   (Glória) — +258 87 030 1006**. A Matola liga-se quando houver número, sem código novo: é uma linha em `stores`.
2. **Fornecedor atrás de um adaptador.** O código chama `WhatsAppTransport` (`send`, `verifyWebhook`,
   `parseWebhook`). Implementações: **Tyxter** (`api.tyxter.com`) e **mock** (testes e desenvolvimento). Trocar
   para a Cloud API da Meta é escrever outra implementação, como o email fez nas ADR 0009/0010.
3. **Fila, nunca envio directo.** `whatsapp_outbox` com `store_id`, RLS e `idempotency_key` única; despacho por
   `/api/cron/whatsapp` com claim `FOR UPDATE SKIP LOCKED`, como `email_claim` (1104). Nada envia dentro de
   `advance_order`, `create_order`, `create_counter_sale` nem das RPCs de pagamento.
4. **Dinheiro fica onde está.** O WhatsApp leva avisos e links; pagamento continua na Paysuite/e-Mola e o preço
   no servidor. Os pagamentos da Tyxter (Pix, BRL) não se usam.
5. **Bloco portátil.** Tudo o que não é de restaurante vive em `packages/whatsapp` e numa migration sem colunas
   de restaurante (a mensagem refere `subject_type` + `subject_id`, não `order_id`). O que é do HAWSMASH fica
   num só ficheiro: o mapa evento → template (`apps/web/lib/whatsapp/events.ts`).

## Consequências

- Uma peça nova best-effort: se o WhatsApp cair, a venda, a cozinha e o caixa não sentem (regra 1). O email
  continua a sair como hoje.
- Templates precisam de aprovação da Meta antes de cada fluxo ir ao ar; a lista vive no plano.
- Custo por mensagem iniciada pela loja (Meta) mais o que a Tyxter cobrar — B-123.
- Migrations deste módulo seguem a regra do LIVE (CLAUDE §2): revisão, dry-run, fora do horário de loja.
