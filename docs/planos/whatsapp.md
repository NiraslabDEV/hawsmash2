# Plano — WhatsApp Business no HAWSMASH 2.0

> **Estado: W1 (avisos), W2 (alertas ao dono) e W3 (pedido na conversa) escritas e testadas, por ligar.** [ADR 0011](../decisions/0011-whatsapp-business-por-adaptador.md)
> aceite a 30/10/2026; [ADR 0012](../decisions/0012-pedido-pelo-whatsapp-na-conversa.md) a 05/11/2026 — **Cloud API da Meta** em vez da
> Tyxter e **pedido feito dentro da conversa**, pago por comprovativo. **Migrations 1117/1118/1124/1125 aplicadas no LIVE a
> 05/11**; nenhuma loja ligada, nada enviado a ninguém, nada ensaiado ainda contra a Meta real. Como ligar: §7. Custo: §8.
> Execução em [ROADMAP → WhatsApp Business](../../ROADMAP.md).
> Extensão fora da proposta `NL-2026-HS-EXP` (integração de terceiros, CLAUDE §0); não toca nos cinco
> não-negociáveis. **Começa só na loja de Maputo (Glória).** Depois de fechado aqui, o bloco vai para o Gym OS
> e para o motor (§6).

## 1. O que muda para o HAWSMASH

- O cliente sabe do pedido **no WhatsApp**, não num email que não abre: pago, pronto, a caminho, entregue.
- O dono recebe os **alertas** (§11.5) como mensagem a sério, não como deep link que alguém tem de carregar.
- Quem escreve para o WhatsApp da loja recebe **o cardápio da loja** em segundos, a qualquer hora.
- Clientes parados há 30 dias recebem um **"pedir de novo"** (só com consentimento).

## 2. Fornecedor e números

Transporte: **Cloud API da Meta, directa** (ADR 0012), atrás do adaptador `WhatsAppTransport` (ADR 0011).
A Tyxter ficou como alternativa no código: só aluga números brasileiros, factura em BRL com NFS-e e não deixa
ligar o endpoint de dados dos Flows.

**Pagamento é o manual de sempre:** M-Pesa/e-Mola para o número da loja e comprovativo, que o caixa confere.
O WhatsApp não mexe em dinheiro: cria o pedido pelo `create_order` e anexa o comprovativo. **O preço é do
servidor** (regra 2). Loja com pagamento automático → a conversa manda para o site.

### 2.1 Um número por loja

| Loja | Número da API | Estado |
|---|---|---|
| **Maputo (Glória)** | **+258 87 030 1006** | a ligar (B-121, B-122) |
| Matola | — | por indicar (B-122). Liga-se sem código: é preencher a linha da loja |

O número da marca no site (`wa.me/258860760009`, +258 86 076 0009) **não muda** e continua na app do telemóvel.
O de Maputo é outro: passa a ser da API e **deixa de funcionar na app WhatsApp** do telemóvel onde estiver (B-122).

- Os dois números na **mesma conta WhatsApp Business (WABA)** do HAWSMASH: templates aprovados uma vez servem as
  duas lojas; cada número tem o nome de exibição da sua loja.
- **`stores.whatsapp_sender_id`** — o id do número no fornecedor. Sem ele a loja não envia
  (`whatsapp_enabled` só liga com o número preenchido).
- **Sai sempre do número da loja do pedido** (`orders.store_id`), decidido no servidor ao enfileirar (regra 3).
  Alertas ao dono (F4) saem do número da loja do alerta. Enquanto a Matola não tiver número, **os pedidos da
  Matola não recebem WhatsApp** (o email continua) — nunca saem pelo número de Maputo.
- **Inbound:** o webhook resolve o `store_id` pelo **número que recebeu** a mensagem; a conversa fica nessa loja e a
  outra não a lê (RLS). Passar a conversa ao POS da outra loja é acção explícita do caixa, com `event_log`.

### 2.2 O que falta (ver BLOQUEIOS)

| ID | Pergunta | Quem |
|---|---|---|
| B-121 | Ligar a Cloud API: app Meta, WABA, número de Maputo registado, token de sistema, webhook, templates aprovados (§7) | Gabriel + Ridwan |
| B-122 | Número da Matola · o 87 030 1006 pode sair da app WhatsApp? · Facebook Business do HAWSMASH para a WABA | Ridwan |
| ~~B-123~~ | ~~Quem paga as mensagens~~ — **resolvido 05/11: repassado ao HAWSMASH** (Meta + IA, pelo uso; contas no §8) | — |

## 3. Os fluxos

Regra de custo (desde 1/10/2026, §8): **template pago por mensagem entregue**, dentro ou fora das 24 h; **resposta nas
24 h depois de o cliente escrever, grátis só até 1.000 por número e por mês**, depois ao preço de utility.

### F1 — Estado do pedido *(o primeiro a ligar)*

Os mesmos eventos das sequências de email ([emails](../modulos/emails.md)), enfileirados **depois** de
`advance_order` e das RPCs de pagamento — nunca dentro delas:

| Evento | Template (utility) | Botão |
|---|---|---|
| pagamento confirmado | `hs_pedido_pago` — "Pedido {pedido} pago · {loja} · pronto ~{hora}" | Acompanhar → `/order-status/{id}` |
| comprovativo recusado | `hs_pagamento_recusado` — "Não conseguimos confirmar o pagamento do pedido {pedido}" | Enviar de novo |
| pronto (levantamento) | `hs_pedido_pronto` — "O teu pedido {pedido} está pronto no balcão" | Ver no mapa |
| estafeta levantou (1115) | `hs_pedido_a_caminho` — "{pedido} está a caminho" | Seguir entrega ([rastreio](../RASTREIO.md)) |
| entregue | `hs_pedido_entregue` — "Bom apetite! Como correu?" | 👍 / 👎 → feedback |
| cancelado | `hs_pedido_cancelado` — "O pedido {pedido} foi cancelado" | Falar com a loja |

Pedido agendado (1116): lembrete 30 min antes da hora marcada. Anulação de entregue (1112) **não** envia nada.
Sem telefone válido +258 no pedido → não enfileira (sem erro). Só canais `delivery` e `pickup`; balcão e mesa não.
"Pronto" só para levantamento; "cancelado" só para quem já tinha pago. Cancelar retira da fila o que não saiu.
Cada aviso **expira** (1–6 h) em vez de chegar tarde.

### 3.1 Templates para submeter à Meta

Categoria **Utility**, idioma **pt_PT**, parâmetros **com nome** (`{{nome}}`). Cada template recebe exactamente
estas variáveis — mudar uma é mudar [`events.ts`](../../apps/web/lib/whatsapp/events.ts) no mesmo commit.
Botão "Acompanhar" = URL `https://hawsmash.com/order-status/{{1}}` (o sistema envia o id do pedido).

| Template | Texto | Botão |
|---|---|---|
| `hs_pedido_pago` | Olá {{nome}}! O teu pedido {{pedido}} na {{loja}} está pago e já entrou na cozinha. Avisamos quando estiver pronto. | Acompanhar |
| `hs_pagamento_recusado` | Olá {{nome}}, não conseguimos confirmar o pagamento do pedido {{pedido}}. Abre o pedido para tentar outra vez. | Acompanhar |
| `hs_pedido_lembrete` | Olá {{nome}}, o teu pedido {{pedido}} está marcado para as {{hora}}. Já estamos a tratar dele. | Acompanhar |
| `hs_pedido_pronto` | Olá {{nome}}, o teu pedido {{pedido}} está pronto para levantar na {{loja}}. | — |
| `hs_pedido_a_caminho` | Olá {{nome}}, o teu pedido {{pedido}} já saiu com o estafeta. | Acompanhar |
| `hs_pedido_entregue` | Bom apetite, {{nome}}! Obrigado por pedires na {{loja}}. Como correu? | Respostas rápidas: 👍 Correu bem · 👎 Correu mal |
| `hs_pedido_cancelado` | Olá {{nome}}, o pedido {{pedido}} foi cancelado. Se tiveres dúvidas, responde a esta mensagem. | — |
| `hs_alerta_loja` | Alerta do sistema na loja {{loja}}: {{alerta}}. Detalhe: {{detalhe}}. Abre o painel para veres o que fazer. | — |
| `hs_resumo_diario` | Resumo de {{dia}} na loja {{loja}}: {{pedidos}} pedidos, no total de {{total}}. O detalhe segue por email. | — |

O catálogo é código: [`templates.ts`](../../apps/web/lib/whatsapp/templates.ts), com um teste que o amarra ao envio e recusa
corpos que comecem ou acabem numa variável, que a Meta não aprova.

### F2 — Pedir pelo WhatsApp *(ADR 0012 — o pedido faz-se na conversa)*

```
"olá"          → boas-vindas da loja do número  [Ver cardápio] [Falar com a loja]
[Ver cardápio] → lista de categorias → lista de produtos (preço do catálogo)
produto        → tamanho → grupos (molho, ponto…) → adicionais → quantidade
               → "Adicionado · Carrinho 3 itens · 1 350 MT"  [Pedir mais] [Finalizar] [Carrinho]
[Finalizar]    → entrega/levantar → zona → morada (ou "a mesma da última vez?")
               → nome (sugere o do perfil) → M-Pesa/e-Mola → RESUMO com total
[Confirmar]    → create_order (idempotente pelo id do resumo) → "Pedido MPT-0042 registado"
               → "Total a pagar · M-Pesa 84… · titular · manda a foto do comprovativo"
foto / PDF     → bucket privado → attach_payment_proof → "Comprovativo recebido"
caixa aprova   → F1: "Pedido MPT-0042 pago" … "a caminho" … "entregue"
```

- **Texto livre** ("quero 2 hambúrgueres e um refresco") vai à IA, que propõe itens; o código valida, junta ao
  carrinho e mostra os números. Falta uma escolha obrigatória → segue pelos botões desse produto.
- **Loja fechada** ou com pagamento automático: o resumo manda para o site com o carrinho montado.
- **"Falar com a loja"** → link para o WhatsApp da loja que fica na app (`stores.whatsapp_handoff_phone`), até
  haver a gaveta de conversas no POS (F3).
- Comprovativo de um pedido feito **no site** também entra pela conversa, se o telefone for o mesmo.
- Carrinho esquecido 6 h recomeça; à espera de comprovativo, 12 h (como o site).
- **Cada resposta conta** para as 1.000 grátis (§8): o motor junta bolhas seguidas numa só e o cardápio vem logo no
  botão das boas-vindas. Um pedido de um produto com tamanho fica em 13 mensagens; o teste trava o caso mais longo em 15.
- **Username com o número escondido:** a Meta omite o telefone e manda só o BSUID. Pede-se o número com o botão nativo
  (`request_contact_info`); partilhado, segue como conversa normal. Por validar com um payload real (B-124).
- **"Correu mal":** a mensagem seguinte não vai à IA, fica para o dono ler no painel.

### F3 — Atendimento: as conversas caem no POS

Liga ao [plano de atendimento §19](atendimento.md): o WhatsApp passa a ser **mais um canal** do mesmo
`chat_threads` (`channel = 'whatsapp'`). Respostas guiadas (`chat_topics`, dados editáveis pelo owner) para
horário, zonas de entrega, tempo, pagamento; o resto empilha na gaveta lateral do POS da loja. **Nunca modal,
nunca trava a venda.** Fora de horas: resposta automática com o horário e o link do cardápio.
IA (Claude) é opcional e posterior, só sobre os `chat_topics`, sem inventar preço nem promessa.

### F4 — Alertas e resumos para o dono

Os alertas de `/api/cron/alerts` (POS offline, impressora, stock crítico, pedido sem aprovação) e o digest diário
saem também por template (`hs_alerta_loja`, `hs_resumo_diario`) para os telemóveis que o dono escolhe no painel
(`stores.whatsapp_alert_phones`, até 5), pelo número da loja do alerta, com o arrefecimento de 30 min. O email continua
a ser o caminho principal: o WhatsApp é best-effort e nunca atrasa nem impede o cron. [`lib/alerts/whatsapp.ts`](../../apps/web/lib/alerts/whatsapp.ts).

### F5 — Marketing com consentimento

"Pedir de novo" e promoções ([promoções](../modulos/promocoes.md)) **só** para quem deu consentimento de marketing
(mesmo modelo dos contactos de email: comprar não inscreve; cancelado não se reactiva). "SAIR" = opt-out imediato.

## 4. Arquitectura — o bloco portátil

O que vai para o Gym OS e para o motor é **copiado sem edição**; o que é do HAWSMASH fica isolado num ficheiro.

| Peça | Onde | Portátil? |
|---|---|---|
| Contrato `WhatsAppTransport`, transporte Tyxter (`POST /v1/messages`, HMAC `timestamp.corpo`), mock, telefone `+258`, opt-out | [`packages/whatsapp/`](../../packages/whatsapp/src/index.ts) | ✅ sem referências a pedidos |
| `whatsapp_outbox` (`subject_type` + `subject_id`, **`idempotency_key` unique**, `expires_at`), `whatsapp_inbound`, `whatsapp_optouts`, `stores.whatsapp_enabled/_sender_id/_phone`, `whatsapp_enqueue/_claim/_finish/_apply_status/_record_inbound`, RLS | [`1117_whatsapp_base.sql`](../../supabase/migrations/20261030190000_1117_whatsapp_base.sql) | ✅ sem colunas de restaurante |
| Despacho e webhook (o projecto injecta `render`), transporte pelo ambiente | [`lib/whatsapp/dispatch.ts`](../../apps/web/lib/whatsapp/dispatch.ts), [`config.ts`](../../apps/web/lib/whatsapp/config.ts) | ✅ |
| `GET /api/cron/whatsapp` (CRON_SECRET) e `POST /api/webhooks/whatsapp` | `apps/web/app/api/…/whatsapp/route.ts` | ✅ |
| Painel do dono: interruptores, números, uso do mês, últimas enviadas e recebidas ([1126](../../supabase/migrations/20261105190000_1126_whatsapp_no_painel.sql), `get/save_store_whatsapp`) | [`(admin)/whatsapp/`](../../apps/web/app/(admin)/whatsapp/page.tsx) (aba própria: Conversas, Dados, Ligação), [`lib/whatsapp/painel.ts`](../../apps/web/lib/whatsapp/painel.ts) | quase |
| **Gatilhos** do pedido e do estafeta → fila | [`1118_whatsapp_pedidos.sql`](../../supabase/migrations/20261030190100_1118_whatsapp_pedidos.sql) | ❌ do HAWSMASH |
| **Mapa evento → template** | [`lib/whatsapp/events.ts`](../../apps/web/lib/whatsapp/events.ts) | ❌ do HAWSMASH |

| Transporte **Meta Cloud API** (envio, `X-Hub-Signature-256`, `hub.challenge`, media), limites das mensagens interactivas | [`packages/whatsapp/src/meta.ts`](../../packages/whatsapp/src/meta.ts), [`limits.ts`](../../packages/whatsapp/src/limits.ts) | ✅ |
| Conversas: `whatsapp_conversations` (estado + versão), respostas `service` na fila, `whatsapp_receive`, claim/retoma das mensagens recebidas | [`1124_whatsapp_conversas.sql`](../../supabase/migrations/20261105180000_1124_whatsapp_conversas.sql) | ✅ |
| Orquestrador (claim → conversa → fila → envio imediato), cron retoma | [`lib/whatsapp/pedido/run.ts`](../../apps/web/lib/whatsapp/pedido/run.ts) | quase (chama o motor de restaurante) |
| **Motor da conversa de pedido**, IA para texto livre | [`pedido/engine.ts`](../../apps/web/lib/whatsapp/pedido/engine.ts), [`pedido/ai.ts`](../../apps/web/lib/whatsapp/pedido/ai.ts) | ❌ de restaurante (vai para o motor, não para o Gym OS) |
| `whatsapp_create_order`, `whatsapp_pending_order`, `whatsapp_attach_proof`, `whatsapp_checkouts` | [`1125_whatsapp_pedido_na_conversa.sql`](../../supabase/migrations/20261105180100_1125_whatsapp_pedido_na_conversa.sql) | ❌ de restaurante |

Ensaios SQL na base local, em `ROLLBACK`: [`whatsapp.sql`](../../supabase/tests/whatsapp.sql) (34 verificações) e
[`whatsapp_conversa.sql`](../../supabase/tests/whatsapp_conversa.sql) (11 casos: recepção, opt-out, ordem e
idempotência das respostas, versão do estado, retoma, pedido com preço do servidor e idempotente, origem
`whatsapp` no funil, comprovativo só do próprio telefone, isolamento).

Regras: `anon` nunca lê as tabelas (§17); `event_log` com `whatsapp.queued/failed/opt_out`; **best-effort**
(regra 1): o WhatsApp em baixo não pára o POS, a cozinha, o caixa nem o site. O cron agrupa a fila por número:
um número bloqueado na Meta não atrasa a outra loja.

## 5. Fases

| Fase | Entrega | Pronto quando |
|---|---|---|
| **W0** | ✅ ADR 0011/0012, número de Maputo, plano, custo repassado (B-123) · ⏳ B-121 (Meta), B-122 | mensagem de teste pelo número de teste da Meta |
| **W1** | ✅ código 30/10, transporte Meta 05/11 · ⏳ ligar (§7) | pedido real de Maputo → mensagens certas; repetir evento não duplica |
| **W2** | ✅ código 05/11: **F4** alertas e resumo ao dono · ⏳ ligar com W1 | alerta de POS offline chega ao telemóvel do Ridwan |
| **W3** | ✅ código 05/11 (ADR 0012): **F2** pedido na conversa + comprovativo + IA · ⏳ ligar com W1 | pedido real feito no WhatsApp aprovado no POS; % de pedidos com origem `whatsapp` no funil (1066) |
| **W4** | **F3** conversas no POS (com o plano §19) | |
| **W5** | **F5** marketing com consentimento · Matola ligada | |

**Migrations:** o `supabase` CLI está ligado ao LIVE (CLAUDE §2). Cada migration deste módulo passa por revisão,
dry-run e skill `aplicar-migration-supabase`, fora do horário de loja.

## 6. Levar o bloco aos outros projectos

Decidido a 30/10/2026: **primeiro o HAWSMASH, tudo fechado; depois o bloco.** Quando W1–W4 estiverem verdes em
Maputo:

1. Copiar `packages/whatsapp/`, a migration base e as duas rotas para o motor e para o Gym OS.
2. Em cada projecto escrever só o seu `lib/whatsapp/events.ts` (no ginásio: renovação, boas-vindas, código,
   leads, aulas — [plano do Gym OS](../../../../0001.%20Projetos/GYM/gym-os/docs/planos/whatsapp.md)).
3. Registar os templates novos na Meta e colher o procedimento como skill (`colher-skill`).

## 7. Como ligar (B-121) — por esta ordem

Prompt completo para o agente: [whatsapp-ligar-prompt.md](whatsapp-ligar-prompt.md).

1. **Meta Business** do HAWSMASH (B-122): criar a app (tipo *Business*) em developers.facebook.com, juntar o
   produto **WhatsApp** e criar a WABA. A Meta dá um número de teste: serve para os passos 2–6 sem tocar no
   número da loja.
2. **Token permanente:** utilizador de sistema com `whatsapp_business_messaging` e `whatsapp_business_management`
   → `META_WHATSAPP_TOKEN`. Segredo da app → `META_APP_SECRET`. Gerar um texto aleatório (≥ 16) →
   `META_WEBHOOK_VERIFY_TOKEN`. No Railway: `WHATSAPP_PROVIDER=meta`. Para a IA: `ANTHROPIC_API_KEY`
   (opcional; sem ela a conversa é só por botões).
   **Método de pagamento na conta da Meta (Meta Business Suite):** sem ele a Meta deixa de entregar as respostas.
3. **Migrations no LIVE:** ✅ 1117, 1118, 1124 e 1125 a 05/11. Falta a **1126** (painel), fora do horário, pela skill
   `aplicar-migration-supabase` (pasta isolada; as quatro versões `20260928…` que só existem no Remote vêm do ramo
   `codex/vendedora-virtual`). Inofensivas sem número: nenhuma loja fica ligada.
4. **Deploy** do código (dev → main, regra do CLAUDE §2) e **webhook** na app Meta:
   `https://hawsmash.com/api/webhooks/whatsapp`, verify token do passo 2, subscrever o campo `messages`.
5. **Templates**: `npx tsx scripts/whatsapp-templates.ts` (com `META_WHATSAPP_TOKEN`, `META_WABA_ID`, `APP_BASE_URL`);
   `--status` até ficarem `APPROVED`. O catálogo vive em [`templates.ts`](../../apps/web/lib/whatsapp/templates.ts).
6. **Cron:** [`scripts/sql/install-whatsapp-cron.sql`](../../scripts/sql/install-whatsapp-cron.sql) — só depois de o
   `GET /api/cron/whatsapp` responder 200 com o transporte configurado.
7. **Ligar a loja — no painel, em WhatsApp → Ligação, só o dono** (nunca `update` à mão no LIVE, CLAUDE §2): id do
   número (o `phone_number_id` da Meta), telefone, telemóveis dos alertas, interruptor **Avisos**. Depois de um pedido
   real de ensaio, o número de atendimento humano e o interruptor **Conversa de pedido**. Desligar é o mesmo interruptor,
   sem deploy. O número de Maputo (+258 87 030 1006) é registado na WABA primeiro e sai da app do telemóvel (B-122).

## 8. Quanto custa (verificado a 05/11/2026)

**Regras da Meta**, da [página oficial de preços](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing)
e da [nota sobre mensagens de sessão](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages):

- Mudou a **1/10/2026**. Paga-se por mensagem **entregue**; o que o cliente escreve é grátis.
- **Respostas de sessão** (o que a conversa manda nas 24 h depois de o cliente escrever): **1.000 grátis por número e
  por mês**, sem acumular; depois ao preço de utility desse mercado.
- **Templates de utility** (os avisos): pagos sempre, dentro ou fora das 24 h. Por isso **não vale a pena** trocar avisos
  por mensagens de sessão: poupava só enquanto houvesse folga nas 1.000.
- **Anúncios Click-to-WhatsApp:** quem entra por um anúncio tem a janela grátis (até 7 dias, segundo a página de preços).
- **Moçambique = "Rest of Africa".** O preço oficial está nos ficheiros de tarifas da Meta, que não consegui abrir; fontes
  de terceiros dão **US$ 0,0040–0,0046 por mensagem de utility** e divergem. **Confirmar no rate card antes da adenda.**

**Mensagens por pedido** (contadas no motor, com o cardápio real de Maputo: tamanho sim, grupos e adicionais não):

| Pedido | Respostas | Avisos (pago, pronto/a caminho, entregue) |
|---|---|---|
| 1 produto com tamanho, entrega, M-Pesa/e-Mola | 13 | 2–3 |
| Cada produto a mais | +3 ou +4 | — |
| Em texto livre com a IA ("quero 2 X") | menos 3 ou 4 | — |

**Conta, com o preço de terceiros:** as 1.000 grátis cobrem cerca de **75 pedidos por mês em cada número**. Acima disso,
cada pedido custa cerca de **US$ 0,07** (13 respostas + 3 avisos), uns 4–5 MT. Abaixo, só os avisos: cerca de US$ 0,013.

**IA:** o cardápio de Maputo tem cerca de 870 tokens. Estimativa por mensagem em texto livre, sem medir em produção:
`claude-opus-5-5` (por defeito) cerca de US$ 0,01; `claude-haiku-5-5` cerca de US$ 0,0002. Muda-se com `WHATSAPP_AI_MODEL`, sem código.

**Se o volume subir muito:** um WhatsApp Flow com o cardápio é uma mensagem só em vez de várias, porque os ecrãs do Flow
não são mensagens. Fica para quando houver uso medido: exige endpoint cifrado e aprovação, e a API da Meta permite-o.
