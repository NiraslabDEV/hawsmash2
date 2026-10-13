# Descontos e promoções

Porta para o 2.0 o mecanismo da instância SLICE (2x1, entrega grátis, cupões), adaptado a várias lojas e alargado ao caixa do POS. Ecrã: **Painel → Promoções** (`/promocoes`, só o dono). Migration [1113](../../supabase/migrations/20260930210000_1113_descontos_e_promocoes.sql).

## O que existe

| Mecanismo | Onde se configura | Site | Balcão (POS) |
|---|---|---|---|
| **Promo 2x1** — compre um, leve o segundo grátis | `promotions` (`kind = 'bogo'`) + `menu_items.bogo_eligible` | sim | se marcada "também no balcão" |
| **Entrega grátis** a partir de um mínimo | `promotions` (`kind = 'free_delivery'`) | sim | se marcada "também no balcão" (vendas de entrega) |
| **Cupões** — %, valor em MT, produto grátis ou 2x1 | `referral_codes` (+ `store_id`, `null` = todas) | campo no checkout | painel de descontos no pagamento; **pede o telefone** |
| **Desconto manual** — % ou MT, com motivo | no próprio POS | — | só **gerente/dono** |

Uma promoção de cada tipo por loja (`unique (store_id, kind)`), com interruptor, frase, dias da semana, janela de datas e `include_counter` ("também no balcão"; vale também para pedidos QR de mesa).

## Regras da conta (iguais no servidor e nas pré-visualizações)

Ordem: **2x1 → cupão → manual → entrega grátis**.

1. **2x1:** uma unidade grátis por pedido; paga-se a mais cara e sai grátis a segunda mais cara. Por omissão o par é do **mesmo produto** (variantes contam); a loja pode aceitar quaisquer dois elegíveis. Conta o preço efectivo da linha.
2. **Dia do turno:** madrugada de uma janela que vira a noite conta como o dia anterior.
3. **Cupão %** sobre o que sobra do 2x1, arredondado para baixo. **Cupão MT** nunca passa esse valor. **Produto grátis:** no site o brinde entra a 0; no balcão o produto vai no carrinho e o cupão tira uma unidade. **Cupão 2x1** liberta o 2x1 mesmo desligado.
4. **Manual** sobre o que sobra do cupão; motivo com 3 a 200 caracteres.
5. **Entrega grátis** quando os produtos, já com descontos, chegam ao mínimo.
6. **Não acumula com campanha de preço** (1060).
7. **Conta da mesa no POS** (`close_table_bill`) fica de fora.

Uma só função SQL faz a conta para os dois canais: `private.compute_promotions`. O espelho em TypeScript é [`applyPromotions`](../../packages/core/src/promotions.ts), usado pelo checkout e pelo POS ([`lib/pos/promotions.ts`](../../apps/web/lib/pos/promotions.ts)). **Mudar uma regra obriga a mudar os dois lados e os testes.**

## Onde é aplicado

**Site** — camada no `create_order`, por baixo da idempotência do checkout (1048):

```
public.create_order → create_order_before_upsell (1048)
  → create_order_store_legacy (1113) → create_order_store_before_promotions (1060)
  → create_order_store_before_campaign (1013) → create_order_legacy
```

**Balcão** — dentro do `create_counter_sale_unlocked`, depois do lock por `client_sale_id` e **antes de conferir o pagamento**: o pagamento tem de bater com o total já descontado. A migration injecta duas chamadas nessa função por substituição verificada (pára se a âncora não existir, aceita CRLF). Um cupão ou desconto inválido recusa a venda online com o erro próprio (`referral_*`, `coupon_requires_phone` P0027, `discount_requires_manager`).

**Venda offline:** a fila guarda o cupão e o desconto (`OfflineSale.discount`) e a hora da venda (`promoAt`). Na sincronização a venda já foi cobrada, por isso **nunca é recusada** por promoção: um cupão entretanto esgotado ou um desconto gravado por um caixa aplica-se na mesma, a venda fica `needs_review` e grava `promotion.needs_review`. Cupões no POS só se aplicam com rede (validação no servidor).

O que marca a venda para revisão é a presença de `offlineTotalCents` no payload, que liga o modo tolerante: em vez de recusar, cada problema entra numa lista de `flags` — o próprio problema do cupão (`referral_*`), ou `manual_discount_unverified` quando o desconto manual não vem de um gerente. A lista vai inteira para o `event_log`; qualquer `flag` põe `needs_review` a verdadeiro. A promoção é calculada à hora da venda (`promoAt`), não à hora da sincronização, para que um 2x1 de sexta não desapareça por a rede só voltar no sábado.

**Dinheiro:** `orders.discount_cents` é **todo** o abatimento aos produtos e `total = subtotal − discount + entrega`. Relatórios, caixa e fecho não mudam.

| Coluna | Significado |
|---|---|
| `bogo_discount_cents` / `bogo_free_item` | parte do 2x1 e o que saiu grátis |
| `manual_discount_cents` / `discount_reason` | desconto manual do balcão e o motivo |
| cupão | `discount_cents − bogo − manual` |
| `delivery_discount_cents` | taxa perdoada; `delivery_fee_cents` já vem a 0 |

## Onde se vê

- **Montra:** faixa com as promoções do dia e selo "2x1 HOJE" nos produtos elegíveis.
- **Checkout:** linhas de 2x1, cupão e entrega grátis; "junta mais um"; "faltam X para a entrega grátis". Cupão guardado no browser é revalidado ao abrir.
- **POS:** painel de descontos no ecrã de pagamento; o total e o plano de pagamento já descontados.
- **Painel → Pedidos:** detalhe com cada abatimento. **Painel → Promoções:** resumo de 30 dias (inclui desconto manual) e últimos pedidos com desconto.
- **Acompanhamento do cliente:** `get_order_status` devolve `subtotal_cents`, `delivery_fee_cents` e `promo`.
- **Email de pagamento confirmado:** linhas de desconto (leitura best-effort).
- **Talão:** um trigger em `print_jobs` junta ao payload a origem do desconto; o [talão](../../packages/receipt/src/tickets.ts) imprime uma linha por origem. **Precisa da bridge nova nas lojas**; até lá sai a linha única "Desconto:" com o total certo.

## Leituras e escritas

| RPC / tabela | Quem | Para quê |
|---|---|---|
| `get_store_promotions(slug)` | anon | Montra, checkout e POS: promoções activas, `live`, `include_counter`, ids elegíveis |
| `validate_referral(code, phone, slug)` | anon | Pré-validação com a loja (`wrong_store`) |
| `get_promotions_summary(store, from, to)` | dono/gerente da loja | Resumo no painel |
| `get_coupon_usage()` | dono | Utilizações de cada cupão |
| `promotions` | leitura: staff da loja; escrita: dono | RLS por loja |

## Auditoria (`event_log`)

`promotion.saved`, `coupon.saved`, `promotion.item_eligibility`, `promotion.applied`, `pos.manual_discount` (com actor e perfil), `referral.redeemed` (site e balcão), `promotion.needs_review`.

## Testes

- [core](../../packages/core/src/__tests__/promotions.test.ts) — a conta (37 casos).
- [POS](../../apps/web/lib/pos/__tests__/promotions.test.ts) e [painel](../../apps/web/lib/admin/__tests__/promotions.test.ts).
- [talão](../../packages/receipt/src/__tests__/promo-lines.test.ts) e [email](../../apps/web/lib/email/__tests__/order-emails.test.ts).
- [SQL](../../supabase/tests/promotions.sql) — site (blocos 1–15) e balcão (bloco 16: opt-in, pagamento descontado, cupão com telefone, repetição, manual de gerente, caixa recusado, venda offline para revisão, página do cliente). Corre numa transacção com `ROLLBACK`.

## Limites conhecidos

- Bridge das lojas por actualizar para as linhas novas do talão.
- Conta da mesa (POS) sem descontos.
- O motivo do desconto manual não aparece ao cliente, só no painel e no talão.
