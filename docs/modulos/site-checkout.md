# Site público e checkout

O cliente escolhe uma loja, produtos e modo de entrega/levantamento e conclui a encomenda no browser. O site público não precisa de instalação nem de uma conta de staff. Identidade, operação da loja e dados de pagamento têm origens diferentes: [Aparência](aparencia.md), [Lojas](lojas.md) e [Pagamentos](pagamentos.md).

**Estado:** funcionamento observado no código da árvore de 26/09/2026. Não demonstra um checkout concluído em staging/produção. Migrations, credenciais, dados da loja e integração real continuam dependentes dos bloqueios aplicáveis.

## Páginas e fluxos activos

| Rota | Função |
|---|---|
| `/` | Escolha de loja a partir de `list_public_stores` |
| `/l/[slug]` | Montra activa `Storefront`, cardápio e carrinho dessa loja |
| `/menu` | Atalho por cookie `hs_store` ou loja por omissão; redirige para `/l/[slug]` |
| `/upsell` | Ofertas antes do pagamento: upgrade de variante e acompanhamentos marcados no catálogo |
| `/checkout` | Nome, telefone e email obrigatórios no topo; canal/zona/morada/horário; pagamento |
| `/payment/return/[orderId]` | Retorno/verificação de pagamento automático |
| `/order-status/[orderId]` | Acompanhamento, senha, vinculação de conta e avaliação |
| `/m/[token]` | Cardápio/pedido por QR de mesa; ver [Mesas](mesas.md) |
| `/pedido-assistido` | Revisão de selecção preparada por agente; ver [Agentes](agentes.md) |

Todos são públicos ou dependem da posse de identificador/token/cookie, não de perfil owner/manager/cashier/kitchen. Não se deve tratar UUID de pedido como prova de identidade forte: existe uma cadeia de acesso à conta documentada na [auditoria, secção 5](../AUDITORIA-DOCUMENTACAO.md#5-código-que-viola-a-spec).

O componente `MenuExperience` permanece no código, mas sem importador actual. Os overlays de Pedidos/Perfil e o formulário de espera desse componente não são a montra entregue por `/l/[slug]`. Não existe uma página pública independente de conta/perfil nem uma rota `/menu/[itemId]`.

## Loja e carrinho

A montra consulta `/api/menu` com loja e canal. O servidor devolve preços efectivos, disponibilidade, zonas, horário e contactos públicos. O browser mostra valores de pré-visualização; `create_order` recalcula o pedido. A montra tem cache curta de consulta, que não constitui reserva de stock.

`localStorage` conserva o carrinho e a loja a que pertence. A troca pelo diálogo, entrada por link de outra loja ou regresso pelo histórico passam pela verificação de loja e limpam um carrinho incompatível. O cookie de escolha não altera a associação de uma venda POS.

Cada linha transporta `menuItemId`, quantidade e nota; o contrato também admite variante, adicionais, grupos de modificadores e atribuição de upsell. A assinatura distingue escolhas do mesmo produto e ordena adicionais/opções. Não guarda um preço enviado como autoridade ao servidor.

A montra activa oferece os controlos de produto/variante presentes em `Storefront`. O contrato de carrinho, o percurso QR e o canal de agentes suportarem escolhas adicionais não prova que todos esses controlos estejam expostos nessa montra. O editor Cardápio gere categorias, produtos, variantes e adicionais; não há editor de modificadores nessa aba actual.

O upsell é opcional, usa decisões puras em `lib/upsell.ts` e não deve interromper a compra se não houver uma oferta aplicável. Catálogo já completo/sem ofertas segue para checkout. Textos e interruptor da loja online estão nas definições herdadas; as definições do POS são por loja e independentes. A medição das unidades aceites está em [Marketing](marketing.md).

## Checkout e pagamento

1. O checkout recupera carrinho/loja, consulta o cardápio e apresenta os dados de entrega ou levantamento.
2. A pessoa escolhe zona e horário conforme canais e horários devolvidos; conta/moradas guardadas são opcionais. Se o serviço de conta falhar, mantém-se o formulário.
   Nome, telefone e email são obrigatórios só no browser (decisão do dono, 30/09); `create_order` continua a aceitar pedidos sem email. O que a pessoa escreveu fica em `localStorage` (`dl_customer`, `dl_address`, [`lib/checkout-memory.ts`](../../apps/web/lib/checkout-memory.ts)) e volta preenchido na encomenda seguinte deste browser; a zona só é reposta se for da loja actual. Nunca vem do servidor, portanto não expõe moradas a quem só sabe o telefone (ADR 0003). “Outra morada” esquece a morada guardada; “Não sou eu” esquece tudo e sai da conta. Os campos têm `name`/`autocomplete` (`name`, `tel`, `email`, `street-address`) para o preenchimento automático do browser; o browser só os preenche quando a pessoa escolhe a sugestão.
3. `validate_referral` pré-valida um código quando usado; a criação volta a validar preço, escolhas, taxa, horário e desconto.
4. O fluxo manual cria o pedido e apresenta os dados de pagamento da loja. O comprovativo é carregado no bucket privado e ligado ao pedido por `/api/attach-proof`.
5. O automático envia uma chave de tentativa persistida ao handler de pagamentos. A BD reclama uma única iniciação; resultado pendente/incerto é consultado, não tratado como convite a cobrar de novo.
6. A pessoa acompanha estado/senha em `/order-status/[orderId]`, que consulta a API com polling de 5 s enquanto aplicável. Avaliação segue por `/api/feedback`.

O percurso automático pode oferecer retorno ao manual quando a configuração/fornecedor não permite iniciar. Esse fallback não resolve por si uma cobrança de estado incerto; a política de consulta/repetição está no módulo Pagamentos. O comprovativo não confirma dinheiro automaticamente: fica sujeito à conferência da equipa e à máquina de estados.

O browser faz upload para `payment-proofs`; a equipa abre o comprovativo por URL assinada. Bucket privado não corrige a policy de acesso por loja encontrada na auditoria. Também há discrepâncias de formatação e autorização nos handlers de email herdados; não declarar essas boundaries corrigidas pela documentação.

## Dados, RPCs e APIs

| Área | Tabelas / contrato principal |
|---|---|
| Loja/cardápio | `stores`, `store_hours`, `delivery_zones`, `menu_categories`, `menu_items`, `store_items`, variantes/adicionais/modificadores |
| Pedido | `orders`, `order_items`, `payments`, contadores e fila de impressão |
| Oferta/referral | `settings`, `referral_codes`, `referral_redemptions`, `store_campaigns`, `order_upsells` |
| Conta | `customers`, `customer_addresses`, `customer_devices`, `customer_login_codes` |
| Medição/avaliação | `analytics_events`, `order_attribution`, `order_feedback`; `waitlist` tem API própria |

Leituras públicas usam `list_public_stores`, `get_menu`, `get_order_status`, `get_table_by_token` e `validate_referral`. Escritas principais: `create_order`, `attach_payment_proof`, `submit_feedback`, `join_waitlist`; conta tem handlers/RPCs separados. Vários handlers públicos legados usam cliente servidor com service role, não a sessão de staff do visitante. O acesso público por RPC não significa que a policy tenha sido validada em runtime nesta revisão.

As APIs são `/api/stores`, `/api/menu`, `/api/create-order`, `/api/payments`, `/api/payments/verify`, `/api/attach-proof`, `/api/order-status/[orderId]`, `/api/feedback`, `/api/waitlist` e a família `/api/account`. Contratos completos e métodos estão no [mapa de rotas](../referencia/rotas.md).

## Código, eventos e testes

- [Montra](<../../apps/web/app/(public)/_storefront/>), [checkout](<../../apps/web/app/(public)/checkout/page.tsx>) e [acompanhamento](<../../apps/web/app/(public)/order-status/[orderId]/page.tsx>).
- [Carrinho](../../apps/web/utils/useCart.ts), [associação à loja](../../apps/web/lib/cart-store.ts), [horários](../../apps/web/lib/store-hours.ts) e [upsell](../../apps/web/lib/upsell.ts).
- [API create-order](../../apps/web/app/api/create-order/route.ts), [comprovativo](../../apps/web/app/api/attach-proof/route.ts) e [pagamentos](../../apps/web/lib/payments/).

`order.created` e `payment.proof_attached` são eventos deste percurso; confirmações/avanços têm eventos da máquina SQL. Atribuição de visita/compra vai para medição, não substitui `event_log`. Consultar [Pedidos](pedidos.md) e o [catálogo de eventos](../referencia/eventos.md) para os produtores exactos.

Testes: [loja e2e](../../e2e/loja.spec.ts), [métodos de pagamento](../../e2e/payment-methods.spec.ts), [upsell](../../e2e/upsell.spec.ts), [storefront DB](../../packages/db/tests/storefront.test.ts), [referral DB](../../packages/db/tests/referral.test.ts) e testes de [carrinho/loja/horários](../../apps/web/lib/__tests__/). Testes de idempotência e resultados incertos estão em [payments](../../apps/web/lib/payments/__tests__/). A configuração e2e por omissão não inclui automaticamente todas as suites dedicadas; ver [testes](../referencia/testes.md).

**Limites:** integração visível das campanhas preparada mas incompleta na montra/checkout; conta por UUID com achado aberto; e-Mola directo real depende de adaptador/contrato; acesso e hardware não verificados. Consultar [BLOQUEIOS](../../BLOQUEIOS.md), incluindo **B-100**, **B-102**, **B-108/B-109** e **B-111**. O [ADR 0003](../decisions/0003-conta-do-cliente-por-dispositivo.md) rege identidade e o [ADR 0005](../decisions/0005-canal-publico-de-agentes.md) a selecção assistida.

## Atendimento/chat: planeado

O chat guiado e o atendimento humano no POS pertencem à Fase 2 de produto descrita na spec, com **B-021**. Não existem tabelas, RPCs ou widget implementados para esse módulo no retrato auditado. A futura referência deve distinguir esse contrato planeado dos objectos realmente migrados. As regras preservadas da spec acompanham esta secção; não são uma declaração de entrega.

---

## Contrato preservado da spec

A entrada actual apresenta montra e selector. Variantes `/l/[slug]` e fornecedores por método estão documentados acima. A enumeração original de providers é histórica.

## 13. SITE PÚBLICO (o canal que já factura)

- **Página de entrada com escolha de loja** (compromisso da proposta) → `/l/maputo`, `/l/matola`.
- Cardápio, carrinho, checkout com **zonas e taxas da loja escolhida**, agendamento pelos **horários dessa loja**.
- Pagamento: Paysuite (automático) ou manual por comprovativo, conforme `stores.payment_provider`.
- `order-status` com estado ao vivo; `purchase` de tracking **só** quando `paid`/`approved` (§16 do motor).
- Tracking por loja: os eventos levam `store` como dimensão, para medir campanhas por unidade.

### 13.1 Canal de encomendas por agente *(produto · 2026-09-14)*

Cada instalação pode expor `/api/mcp` e registar WebMCP nas páginas públicas que o navegador
suportar. As ferramentas públicas consultam lojas/cardápio, calculam uma estimativa e preparam
uma ligação de revisão; não dão acesso ao painel, não criam encomendas nem cobram. O servidor
valida preços, escolhas, canal e zona na loja explícita. O cliente revê o carrinho e conclui
no checkout normal, por acção humana; contactos e pagamento são preenchidos nesse site.

`AGENT_TOOLS_ENABLED=false` por omissão mantém o canal desligado até à activação da instalação.
O pacote de plugin reutiliza o mesmo MCP; gerar o pacote não o publica no ChatGPT.
Contrato, configuração e ensaios em [`docs/modulos/agentes.md`](agentes.md), decisão em
[ADR 0005](../decisions/0005-canal-publico-de-agentes.md), activação/publicação em
[`BLOQUEIOS.md` B-103/B-104](../../BLOQUEIOS.md).
