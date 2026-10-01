---
name: connect-paysuite
description: |
  Conecta e valida o gateway de pagamento Paysuite (M-Pesa/e-Mola/cartão) numa
  instância do Delivery OS. Use quando o pedido for: "ligar o Paysuite", "conectar
  o gateway", "configurar pagamento automático", "ativar Paysuite para o cliente X",
  "o pagamento fica preso em A processar", "webhook do Paysuite", ou ao fazer
  onboarding de pagamento automático num restaurante novo. Cobre: meter as chaves
  no admin/BD, validar o token contra a API real, configurar o webhook, e testar
  o fluxo ponta-a-ponta — incluindo os gotchas já descobertos (reference
  alfanumérico, return_url com esquema, verificação ativa sem depender do webhook).
---

# Conectar o gateway Paysuite

Runbook para ligar o Paysuite a uma instância do Delivery OS (single-tenant).
A config vive em `settings` (segredos B, server-side) — **nunca** no código/git.

## Pré-requisitos (pedir ao cliente / Paysuite dashboard)
- **API Token** (formato `2097|kC5...`)
- **Webhook Secret** (formato `whsec_...`)
- URL público do deploy (ex.: `https://web-production-xxxx.up.railway.app`)

## Passo 1 — Meter as chaves (admin, sem tocar em ficheiros)
No painel: **Definições → Pagamento Automático (Paysuite)**:
1. Método de pagamento = **Paysuite**
2. Colar **API Token** + **Webhook Secret** (campos mascarados; "Substituir" para trocar)
3. Guardar

> Por trás: grava `settings.payment_provider`, `paysuite_api_key`, `paysuite_webhook_secret`
> (migration `0019_paysuite_settings`). As rotas leem `settings`→`.env` via
> `apps/web/lib/payments/config.ts` (`getPaymentConfig`).

Alternativa por SQL (se não houver acesso ao admin), no Supabase do cliente:
```sql
update settings set
  payment_provider = 'paysuite',
  paysuite_api_key = '<API_TOKEN>',
  paysuite_webhook_secret = '<WEBHOOK_SECRET>'
where id = 1;
```

## Passo 2 — Validar o token contra a API REAL (antes de prometer que funciona)
```bash
curl -s -w "\nHTTP %{http_code}\n" -X POST "https://paysuite.tech/api/v1/payments" \
  -H "Authorization: Bearer <API_TOKEN>" \
  -H "Content-Type: application/json" -H "Accept: application/json" \
  -d '{"amount":"10.00","reference":"ordtestconnect123","description":"Teste",
       "return_url":"https://<APP_URL>/payment/return/test",
       "callback_url":"https://<APP_URL>/api/webhooks/paysuite"}'
```
- **HTTP 201 + `data.checkout_url`** → token OK. ✅
- **HTTP 401** → token inválido.
- **HTTP 422 "Reference must only contain letters and numbers"** → `reference` tem `_`/`-`
  (o nosso código já resolve via `lib/payments/reference.ts` — ver gotchas).
- **HTTP 422 "Return URL must be a valid URL"** → `return_url`/`callback_url` sem `https://`.

## Passo 3 — Configurar o webhook no painel Paysuite
Webhook URL = **`https://<APP_URL>/api/webhooks/paysuite`** (do PRÓPRIO deploy do cliente,
nunca de outro projeto). Confirmar que o secret colado é o mesmo deste webhook.

## Passo 4 — `APP_BASE_URL` no host (Railway/Vercel)
Definir `APP_BASE_URL=https://<APP_URL>` (com `https://`). Há fallback para os headers
`x-forwarded-proto/host` na rota de pagamento, mas o ideal é tê-lo definido (emails usam-no).

## Passo 5 — Teste ponta-a-ponta
1. Loja → adicionar item → checkout → **Pagar Agora** → pagar no telemóvel (M-Pesa).
2. Ao voltar, a página `/payment/return/[orderId]` faz **verificação ativa**
   (`/api/payments/verify`) e deve mostrar **"Pagamento Confirmado"** em ~3-5s.
3. Confirmar na BD: `orders.status='paid'`, 1 linha em `payments`, 1 `print_job`,
   `event_log` com `order.created → payment.confirmed`.

Verificação direta de um pedido específico (debug):
```bash
curl -s -X POST "https://<APP_URL>/api/payments/verify" \
  -H "Content-Type: application/json" -d '{"orderId":"<ORDER_UUID>"}'
# espera {"status":"paid","confirm":"ok"} se pago no Paysuite
```

## Arquitetura (3 caminhos de confirmação, todos idempotentes)
A `idempotency key` é sempre `orderToReference(orderId)` → o dedup do `confirm_payment` funciona.
1. **Webhook** `/api/webhooks/paysuite` (HMAC do raw body) — fonte de verdade, instantâneo.
2. **Verificação ativa** `/api/payments/verify` — chamada pela página de retorno; **não depende
   do webhook**. É o que evita o pedido ficar preso em "A processar".
3. **Cron** `/api/cron/reconcile` — rede de segurança (NÃO corre sozinho no Railway; precisa de
   scheduler externo se quiseres este caminho).

## Gotchas (descobertos contra a API real — já corrigidos no código)
| Sintoma | Causa | Resolução |
|---|---|---|
| 422 "Reference must only contain letters and numbers" | `order_<uuid>` tem `_`/`-` | `lib/payments/reference.ts` (`ord`+hex) |
| 422 "Return URL must be a valid URL" | `APP_BASE_URL` sem esquema | `resolvePublicBase` normaliza p/ `https://` |
| `record "v_menu_item" has no field "station"` | `station` está em `menu_categories`, não `menu_items` | join no `create_order` (migration `0020`) |
| Pago no telemóvel mas preso em "A processar" | webhook não chega + cron não corre | verificação ativa em `/api/payments/verify` |
| Paysuite mostra `transaction.status='completed'` | é o estado de pago | `API_STATUS_MAP['completed']='success'` |

## Higiene
- As chaves passaram por aqui? **Regenerar** no Paysuite depois dos testes e recolar no admin.
- Pedidos de teste poluem Caixa/Análise → cancelar/limpar se necessário.
- `confirm_payment` é idempotente: webhook + verify + cron nunca confirmam em duplicado.
