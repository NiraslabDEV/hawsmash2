# ADR 0012 — Pedido feito dentro da conversa do WhatsApp, pela Cloud API da Meta

- Estado: aceite
- Data: 2026-11-05
- Decisores: Gabriel (Niraslab)
- Complementa: [ADR 0011](0011-whatsapp-business-por-adaptador.md) · Plano: [docs/planos/whatsapp.md](../planos/whatsapp.md)

## Contexto

A ADR 0011 pôs o WhatsApp atrás de um adaptador, com a Tyxter como primeiro fornecedor e o pedido pelo
WhatsApp reduzido a "manda o link do cardápio" (F2). Duas coisas mudaram em 05/11/2026:

1. **A Tyxter não serve para Moçambique.** A API pública (OpenAPI lida a 05/11) só aluga números brasileiros;
   o número próprio entra por BYON, mas tem de estar já registado na Meta. Factura em BRL, por cartão, com
   NFS-e brasileira e KYC. Tem Flows, mas `POST /v1/flows` não aceita o endpoint de dados: sem ele o cardápio
   dentro do WhatsApp não é dinâmico (stock, preços).
2. **O pagamento online é manual** (decisão do dono do produto): M-Pesa/e-Mola para o número da loja e
   comprovativo, que o caixa confere. Se o site acaba num comprovativo, a conversa pode fazer o mesmo — sem
   mandar a pessoa para um formulário.

## Decisão

1. **Transporte: Cloud API da Meta, directa** (`graph.facebook.com`), como mais uma implementação do
   `WhatsAppTransport` (`packages/whatsapp/src/meta.ts`). Webhook assinado com `X-Hub-Signature-256` e aperto
   de mão `GET hub.challenge`. A Tyxter fica no código como alternativa; o mock serve os testes.
2. **O pedido faz-se dentro da conversa**, com listas e botões nativos do WhatsApp (sem Flows nem catálogo da
   Meta, que não sabem de variantes, molhos e adicionais): cardápio → produto → escolhas → quantidade →
   carrinho → entrega ou levantamento → zona e morada → nome → M-Pesa/e-Mola → resumo → **Confirmar**.
3. **O pedido nasce no mesmo `create_order` do site**, por `whatsapp_create_order` (só `service_role`):
   preço, stock, promoções, horário e zona são do servidor (regra 2); o telefone é o do WhatsApp; o fluxo é
   sempre o manual. **Idempotente por `checkoutId`** — o id do resumo que a pessoa confirmou: tocar duas vezes,
   o webhook repetir ou o cron reprocessar devolvem o mesmo pedido (regra 4).
4. **Muda a regra do canal de agentes (CLAUDE §13) só para o WhatsApp:** aqui quem confirma é a pessoa, no
   botão "Confirmar" de um resumo com o total do servidor, e o telefone vem verificado pelo WhatsApp. O canal
   público de agentes (MCP/WebMCP, ADR 0005) continua a só preparar o carrinho.
5. **Comprovativo pela conversa:** a foto ou PDF que a pessoa manda é descarregada da Meta, guardada no bucket
   privado `payment-proofs` e ligada ao pedido pelo mesmo `attach_payment_proof` do site. Serve também quem
   encomendou no site e manda o comprovativo pelo WhatsApp (mesmo telefone, normalizado). O caixa confere no
   POS como hoje; o aviso "pago" (W1) sai quando o caixa aprova.
6. **IA só para texto livre** ("2 smash duplos e uma coca"): uma chamada à API Claude com o cardápio em cache
   devolve uma intenção estruturada (ids curtos → UUID no servidor); o código valida, calcula e mostra os
   números. Sem chave, em timeout ou em recusa, a conversa segue pelos botões. Limite de 20 chamadas por
   conversa por hora. Modelo por `WHATSAPP_AI_MODEL` (por defeito `claude-opus-5-5`, esforço baixo).
7. **Loja com pagamento automático ou fechada:** a conversa não cobra nem agenda; manda para o site com o
   carrinho já montado (`/pedido-assistido`).

## Consequências

- O cliente pede, paga e manda o comprovativo sem sair do WhatsApp; o caixa trabalha exactamente como hoje.
- Respostas na janela de 24 h depois de o cliente escrever são grátis na Meta; os avisos por template (W1)
  continuam pagos. O custo das mensagens e da IA é **repassado ao HAWSMASH** (B-123, resolvido).
- Nova superfície best-effort: WhatsApp, Meta ou IA em baixo não tocam no POS, na cozinha, no caixa nem no
  site (regra 1). Uma mensagem processada a meio é retomada pelo cron; reprocessar não avança o estado nem
  duplica respostas (o estado guarda a última mensagem tratada e o que se respondeu).
- Migrations 1124 (portátil: conversas, respostas na fila, recepção com media) e 1125 (do restaurante:
  pedido e comprovativo na conversa). Seguem a regra do LIVE (CLAUDE §2).
