# Facturação fiscal (AT)

> **Estado a 16/11/2026: núcleo escrito e ensaiado numa base local; não aplicado no LIVE, desligado por defeito,
> sem ecrãs.** Decisão em [ADR 0013](../decisions/0013-facturacao-fiscal-no-motor.md); enquadramento legal e
> comercial em [FATURACAO-CERTIFICADA.md](../../FATURACAO-CERTIFICADA.md); activar num cliente é B-019.
> **Isto não é parecer fiscal** e o programa **não está certificado** pela AT.

## O que existe

| Peça | Onde |
|---|---|
| Tabelas `fiscal_settings`, `fiscal_series`, `fiscal_documents`, `fiscal_document_lines`, `fiscal_document_orders`; gatilhos de imutabilidade; RLS por loja (cozinha não lê) | [`1138_facturacao_fiscal.sql`](../../supabase/migrations/20261116120000_1138_facturacao_fiscal.sql) |
| Emissão: gatilho em `payments` → `private.fiscal_emit_for_order` (FR) e `private.fiscal_credit_for_order` (NC) | idem |
| RPCs: `get/save_fiscal_settings` (dono), `fiscal_emit_pending` (dono ou servidor), `get_order_fiscal_documents` (loja, sem cozinha), `fiscal_reissue` (gerente/dono), `fiscal_export_month` e `fiscal_verify_chain` (dono) | idem |
| `orders.customer_nuit` e `customer_fiscal_name` (opcionais) | idem |
| Regras puras: IVA, validação das definições, hash, ficheiro do mês (CSV), SAF-T de referência, verificação da cadeia de uma exportação | [`packages/fiscal`](../../packages/fiscal/src/fiscal.ts) |
| Ensaio SQL, 13 grupos, em `ROLLBACK` | [`supabase/tests/fiscal.sql`](../../supabase/tests/fiscal.sql) |

## Como se comporta

- **Quando emite:** quando os pagamentos confirmados cobrem o total da venda. Venda a zero não gera documento.
- **Mesa:** uma FR por conta (`table_bills.order_ids`), só com todos os lançamentos pagos.
- **Anular** (`void_sale`, `void_delivered_order`): o pagamento passa a `refunded` → NC do documento em vigor.
  O motivo vem de `set_config('app.fiscal_reason', …)`; sem ele fica "Anulação da venda" — **as RPCs de anulação
  ainda não o passam**.
- **Offline:** o número só nasce quando a venda sincroniza. O talão offline não é a factura.
- **Falha:** a venda fica gravada; `event_log` leva `fiscal.emit_failed`; `fiscal_emit_pending` emite depois,
  uma vez.
- **Hash:** `data;instante ISO;número;total;NUIT (ou 999999999);hash anterior`, SHA-256 em base64. Igual na BD e
  no pacote TypeScript, com o mesmo vector de ensaio dos dois lados.

## Como ensaiar (só local)

```bash
(echo "begin;"; cat supabase/migrations/20261116120000_1138_facturacao_fiscal.sql supabase/tests/fiscal.sql; \
 echo "rollback;") | docker exec -i supabase_db_hawsmash2 psql -U postgres -v ON_ERROR_STOP=1
pnpm --filter @delivery/fiscal test
```

Nunca numa base partilhada: os documentos de ensaio ficariam para sempre. Nunca com o NUIT real de um cliente.

## O que falta antes de activar num cliente

| # | Falta | Nota |
|---|---|---|
| 1 | Decisão comercial e contabilista (B-019) | Regime de IVA da restauração, FR vs FT+RC, prazo das vendas offline, quem submete o ficheiro |
| 2 | Aplicar a 1138 | CLI ligado ao LIVE: revisão, dry-run, fora de horas, skill `aplicar-migration-supabase`. Inofensiva enquanto desligada |
| 3 | Ensaio com as RPCs reais | O ensaio SQL insere pedidos e pagamentos à mão; falta `create_counter_sale`, `confirm_payment`, `close_table_bill` e `void_sale` de ponta a ponta, e duas vendas em simultâneo |
| 4 | Talão "Factura-Recibo" de 80 mm | `packages/receipt` + bridge nova nas lojas; uma bridge antiga não pode imprimir uma factura incompleta |
| 5 | Ecrã das definições (dono) e lista de documentos | Usa `get/save_fiscal_settings`, `get_order_fiscal_documents` |
| 6 | NUIT no POS e no checkout | Grava `orders.customer_nuit` antes de pagar; depois só por `fiscal_reissue` |
| 7 | Rota do ficheiro do mês (CSV/XLSX/XML) | `fiscal_export_month` + `packages/fiscal`; colunas provisórias até a AT enviar o modelo |
| 8 | Cron de `fiscal_emit_pending` e alerta de pendentes | Junto de `/api/cron/alerts` |
| 9 | Motivo da anulação na NC | `void_sale` e `void_delivered_order` passam `app.fiscal_reason` |
| 10 | Pedido à AT | Email a efacturação@at.gov.mz (rascunho na skill `faturacao-certificada-mocambique`) |

## Limites conhecidos

- O gatilho corre dentro da transacção da venda e tranca a série da loja até ao commit: duas vendas da mesma
  loja no mesmo instante emitem uma atrás da outra.
- Um pedido com vários pagamentos parciais fora de uma conta de mesa só é facturado quando o total fica coberto.
- A contagem de "pendentes" em `get_fiscal_settings` inclui contas de mesa pagas a meio.


## Ensaio das RPCs reais — 16/11/2026 (A1/A2)

Ensaiado exclusivamente no contentor local `supabase_db_hawsmash2`, sem CLI Supabase nem ligações remotas.
A migration 1138 e os ficheiros das sessões anteriores foram preservados.

- `node scripts/fiscal-local.mjs fiscal fiscal_rpcs`: os 13 grupos originais e os caminhos reais passaram em
  `BEGIN … ROLLBACK`. Balcão/retry com o mesmo `client_sale_id`, sincronização offline, site com
  `confirm_payment`, duas entradas de mesa com pagamento M-Pesa/e-Mola repartido e uma única FR,
  `void_sale`, `void_delivered_order`, desconto manual e promoção 2x1. Repetidos com facturação desligada.
- `node scripts/fiscal-concorrencia.mjs`: **20/20 FR**, números 1–20 sem buracos/repetidos, `emitted_at`
  monotónico. Copia só a estrutura da base local para `fiscal_ensaio_<timestamp>`; confirma os pagamentos
  simultaneamente por 20 processos `psql`; elimina exclusivamente essa base descartável no fim.
  Não copia dados de clientes. Não há URL configurável nem acesso a bases remotas.
- **1139**, `20261116121000_1139_motivo_na_nota_de_credito.sql`: definições integrais de `void_sale`
  (origem F6) e `void_delivered_order` (1112); a única alteração em cada corpo é
  `perform set_config('app.fiscal_reason', left(v_reason, 200), true);` antes de actualizar `payments`.
  O teste do motivo falhou antes e passou depois. A 1138 não foi alterada.

**Ainda não fechado:** lint global vermelho num ficheiro preexistente de outra sessão
(`packages/fiscal/src/fiscal.ts:283`, BOM literal, `no-irregular-whitespace`). B-125 regista o gate.
Não houve commit nem aplicação. A3–A10 e B1–B4 não foram implementados nesta corrida.
