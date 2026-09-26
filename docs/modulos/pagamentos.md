# Pagamentos e reconciliação

O módulo resolve o meio de pagamento e a conta da loja, inicia a tentativa digital, recebe ou consulta o resultado e confirma uma só vez a encomenda. Inclui comprovativos manuais, registo de pagamento no balcão, Paysuite, M-Pesa directo e preparação de e-Mola directo. O pacote real chama-se [`@delivery/payments`](../../packages/payments/src/index.ts), em `packages/payments`; não existe um pacote activo `packages/paysuite`.

## Perfis, configuração e contratos

O dono configura pagamentos em Lojas; a equipa aprova comprovativos segundo as permissões da loja. A [secção do painel](../../apps/web/app/(admin)/lojas/payment-section.tsx) não recebe os segredos existentes. O [resolver do servidor](../../apps/web/lib/payments/config.ts) lê colunas explícitas com service role. A precedência documentada no código é loja, definições globais e ambiente; o caminho e-Mola Paysuite explicitamente configurado exige a chave da própria loja. Essa compatibilidade não substitui a decisão sobre a conta de destino de cada unidade.

| Contrato | Métodos |
|---|---|
| `RedirectPaymentProvider` | `createCheckout`, `verifyWebhookSignature`, `parseWebhook`, consulta de estado opcional |
| `DirectPaymentProvider` | `charge`, `getPaymentStatus` |
| Implementações | `PaysuiteProvider`, `MpesaProvider`; `MockProvider`, `MpesaSimulator` e `EmolaSimulator` para ensaio |

O estado comum do fornecedor é `pending`, `success` ou `failed`. Valores monetários passam em centavos inteiros; a conversão para a unidade decimal exigida pelo fornecedor ocorre na boundary. O pacote inclui normalização de MSISDN, códigos de resultado em português e conferência de extractos normalizados. Uma carteira com formato válido não prova titular, operadora nem existência da conta.

## Fluxo e idempotência

1. O checkout persiste `clientCheckoutId` antes de enviar. A BD recalcula o preço da encomenda, valida loja/canal/escolhas e reutiliza a mesma chave para o mesmo conteúdo.
2. `claim_online_checkout` reclama uma única iniciação. O servidor usa o método e a loja da encomenda guardada, não um total de confiança enviado pelo navegador.
3. Num redirect, o cliente segue para o fornecedor e regressa ao site; o webhook e a consulta activa podem concluir o mesmo pagamento. O webhook Paysuite exige HMAC válido e parsing do contrato actual.
4. No pagamento directo, a referência da tentativa conserva-se para consultas e recuperação. O site nunca pede o PIN da carteira.
5. `confirm_payment` e a chave de idempotência comum protegem a confirmação repetida. Stock, estado e efeitos de venda pertencem às RPCs transaccionais. Uma falha definitiva passa pelo evento `PAYMENT_FAILED`; não pode fazer recuar um pedido já pago.
6. Rede em baixo, timeout ou código desconhecido significam **pendente**. Não recomendar nova cobrança enquanto o resultado anterior for incerto. Uma nova compra depois de falha definitiva usa outra chave/encomenda.

Fontes: [migration 1047](../../supabase/migrations/20260913233656_1047_checkout_idempotente.sql), [checkout-attempt.ts](../../apps/web/lib/payments/checkout-attempt.ts), [pending-checkout.ts](../../apps/web/lib/payments/pending-checkout.ts), [direct.ts](../../apps/web/lib/payments/direct.ts), [confirm.ts](../../apps/web/lib/payments/confirm.ts) e [lookup.ts](../../apps/web/lib/payments/lookup.ts). Uma chave guardada num navegador não reconhece por si só a mesma intenção noutro dispositivo. Uma interrupção depois de reclamar a tentativa pode exigir recuperação/intervenção; idempotência não prova que um fornecedor respondeu.

## e-Mola directo: preparado, ainda sem adaptador real

| Loja | M-Pesa | e-Mola |
|---|---|---|
| `payment_provider=mpesa`, `emola_provider=manual` | Directo | Comprovativo |
| `payment_provider=mpesa`, `emola_provider=emola` | Directo | Integração reservada; oferece comprovativo |
| `payment_provider=mpesa_sim`, `emola_provider=emola_sim` | Simulador | Simulador |

`emola` recusa iniciar com `emola_direct_contract_unavailable` na API e BD. Não existe endpoint ou autenticação Movitel inventados. `emola_sim` não usa rede nem dinheiro e é recusado pelo servidor em produção. O motor conserva `paysuite`, `mock` e herança `null` para outras instalações; numa loja M-Pesa directa, `null` mantém e-Mola por comprovativo. A mudança de fornecedor fica protegida quando há pagamentos digitais pendentes.

O simulador e-Mola usa o último dígito para cenários sintéticos: 0–5 sucesso, 6–7 recusa, 8 pendente que confirma em consulta, 9 pendente. A referência `SIM_EMOLA_*` permite consultar noutro processo quando foi persistida. É uma convenção de teste, não protocolo Movitel.

B-109 exige contrato técnico de comerciante: ambientes, autenticação, unidade monetária, criação/consulta, referências/idempotência, códigos definitivos, limites, timeout e eventual assinatura/reenvio de callbacks; também condições comerciais. Credenciais sozinhas não concluem a integração. Só depois de implementar e ensaiar o adaptador se retira a guarda por nova migration. B-108 conserva a validação das migrations 1046–1048, permissões e confirmação tardia em staging. Este texto integra a preparação documentada de e-Mola sem transformar a pesquisa histórica em confirmação actual do fornecedor.

## Reconciliação e extractos

[`/api/payments/verify`](../../apps/web/app/api/payments/verify/route.ts) faz consulta activa. [`/api/cron/reconcile`](../../apps/web/app/api/cron/reconcile/route.ts) usa o [reconciliador](../../apps/web/lib/payments/reconcile.ts), segredo, limites de tempo e cursores. Sem segredo devolve 503; a rota não é um scheduler. B-106 cobre a execução contínua na instalação e o seguimento de todos os cursores. Não confundir contar falhas definitivas com persistência automática/alertas de todas essas falhas.

[`reconcile-payment-statement.ts`](../../scripts/reconcile-payment-statement.ts) lê um JSON normalizado, compara referências/centavos e cria um relatório novo; não consulta o gateway nem altera pagamentos. O [contrato](../../packages/payments/src/statement.ts) detecta valores diferentes, duplicados, referências ausentes e livro não confirmado. B-107 cobre o formato real do extracto e o adaptador. Ficheiro conferido não é confirmação financeira do fornecedor.

## Dados, rotas, eventos e testes

`stores` guarda a escolha por método/loja e credenciais protegidas; `orders` guarda tentativa/referência/estado; `payments` guarda confirmação e idempotência; `event_log` conserva contexto de operação. As RPCs de confirmação, transição e configuração são o contrato financeiro; os adaptadores apenas falam com o fornecedor.

Rotas: [`/api/payments`](../../apps/web/app/api/payments/route.ts), [`/api/webhooks/paysuite`](../../apps/web/app/api/webhooks/paysuite/route.ts), verificação e reconciliação acima; o comprovativo usa [`/api/attach-proof`](../../apps/web/app/api/attach-proof/route.ts). O POS regista pagamentos presenciais via venda/conta, conforme [POS](pos.md) e [Mesas](mesas.md).

Testes: nove ficheiros em [packages/payments/src/__tests__](../../packages/payments/src/__tests__), handlers/configuração/reconciliação em [lib/payments/__tests__](../../apps/web/lib/payments/__tests__), BD em [payments](../../packages/db/tests/payments.test.ts), [store-payment](../../packages/db/tests/store-payment.test.ts) e [mpesa-reference](../../packages/db/tests/mpesa-reference.test.ts). [payment-methods.spec.ts](../../e2e/payment-methods.spec.ts) usa [configuração isolada](../../playwright.payments.config.ts), fora do E2E predefinido. Nada foi executado nesta redocumentação.

Decisões de isolamento: [ADR 0001](../decisions/0001-multi-unidade.md). Consultar B-001, B-003, B-100, B-106, B-107, B-108 e B-109 em [BLOQUEIOS](../../BLOQUEIOS.md); os respectivos estados não são substituídos por esta descrição. Ver também a [auditoria](../AUDITORIA-DOCUMENTACAO.md), incluindo diferenças entre configuração actual e validadores/scripts herdados.
