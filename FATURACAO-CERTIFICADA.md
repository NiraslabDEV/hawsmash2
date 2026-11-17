# Facturação certificada (AT) — como o HAWSMASH 2.0 se enquadra

> **Para qualquer agente que pegue nisto: usar a skill `/faturacao-certificada-mocambique`.** Ela tem a lei com
> fontes, o modelo de dados com triggers de imutabilidade, o módulo de regras já testado, os testes mínimos, os
> gotchas e o pedido de certificação à AT. Para aplicar migrations neste repositório, usar também
> `/aplicar-migration-supabase` (o CLI está ligado ao LIVE — ver abaixo).
>
> Escrito a 19/10/2026. Implementação de referência, já feita e testada: `Desktop/0001. Projetos/GYM/gym-mvp`
> (Gym OS) — `lib/dominio/fiscal.ts`, `lib/operacoes/faturacao.ts`, migration `0039_faturacao.sql`,
> `FATURACAO-CERTIFICADA.md`.

## 1. Porque agora

Os clientes maiores (e os seus contabilistas) não compram sistemas de venda que não emitam documentos fiscais
válidos. Em Moçambique:

- o programa de facturação tem de ser **autorizado/certificado pela AT** (Despacho Ministerial de 29/02/2012; lista
  provisória de softwares submetidos publicada pela AT a 01/02/2026);
- a factura tem elementos obrigatórios: português, meticais, data, **série e número sequencial**, **NUIT** do
  emitente e do adquirente, designação, **preço sem IVA, taxa e valor do IVA**, motivo quando não há IVA; nada se
  apaga (Código do IVA, art. 27.º);
- desde Maio de 2025, **todos os meses** (até ao último dia útil) submete-se no **e-Declaração** o ficheiro das
  facturas do mês anterior, extraído do programa certificado;
- a facturação electrónica com envio de cada factura à AT está na Lei 10/2025, à espera de regulamento.

Fontes e detalhe: `references/lei-e-fontes.md` da skill.

## 2. Onde o HAWSMASH está hoje

> **16/11/2026:** o núcleo do caminho A existe no código, desligado e por aplicar — ver
> [ADR 0013](docs/decisions/0013-facturacao-fiscal-no-motor.md) e [docs/modulos/facturacao.md](docs/modulos/facturacao.md)
> (o que há, como ensaiar e a lista do que falta antes de activar). Em produção nada mudou: o que segue continua verdade.

- Emite **talão de venda** (sem valor fiscal). `CLAUDE.md §0` põe "Facturação fiscal certificada (AT)" **fora de
  âmbito** da proposta `NL-2026-HS-EXP` (50.000 MT + 20.000 MT/mês).
- `BLOQUEIOS.md` **B-019** (aberto) e **B-005** registam a decisão de 28/08: a facturação fica num software/contabilista
  habilitado pela AT, pago pelo cliente; o HAWSMASH exporta CSV para o contabilista
  (`export_sales_for_accounting`, migration 1028, `docs/modulos/relatorios.md`).
- **Isto não muda sozinho.** Passar a facturar no próprio HAWSMASH é trabalho novo e uma conversa com o Ridwan.

## 3. Decisão a tomar primeiro (registar em ADR em `docs/decisions/`)

| Caminho | O que é | A favor | Contra |
|---|---|---|---|
| **A. Facturar no motor** (a skill) | O POS/site emitem Factura-Recibo com NUIT e IVA, imutável, e o ficheiro do e-Declaração; a Niraslab pede a certificação do programa à AT | Um só sistema para a loja; o **mesmo motor serve o Restaurant OS e o Gym OS** — certifica-se uma vez | Aditamento ao contrato; migration no LIVE; pedido à AT; offline exige cuidado |
| **B. Integrar um software já certificado** | A cada venda o HAWSMASH chama a API de um facturador certificado e imprime/envia a factura dele | Certificação já existe; menos responsabilidade legal | Custo por loja, dependência de terceiros, rede obrigatória para facturar |
| **C. Manter o actual** | Talão + CSV para o contabilista | Zero trabalho | É exactamente o que afasta os clientes grandes |

Antes de escolher: as perguntas de `references/perguntas-contabilista.md` da skill ao contabilista do Ridwan
(regime IVA da restauração, FR vs FT+RC, série por loja, prazo para vendas offline, quem submete o ficheiro).

## 4. Se for o caminho A — mapa para este código

Seguir os passos da skill. Pontos específicos do HAWSMASH:

| Tema | Onde | O que fazer |
|---|---|---|
| Vendas no balcão | RPC `create_counter_sale` (e as variantes `_unlocked`, `_without_drawer`, `_without_recipe`, `_without_tickets`) | Emitir a FR dentro da mesma transacção, numa RPC `security definer` chamada com savepoint (`begin … exception … end` em plpgsql): a venda **nunca** pára (regra 1 do `CLAUDE.md`) |
| Vendas offline | RPC `sync_counter_sale`, `apps/web/lib/pos/offline-store.ts` | O número fiscal só nasce no servidor, na sincronização. O talão offline não é factura: ao sincronizar emite-se a FR e reimprime-se/envia-se. Confirmar o prazo com o contabilista |
| Site / delivery | RPC `confirm_payment` (webhook e aprovação no POS) | FR quando o pagamento fica confirmado (idempotente pela venda) |
| Mesas | `launch_table_order` / conta liquidada (`docs/modulos/mesas.md`) | FR na liquidação da conta, não em cada envio à cozinha |
| Anular | `void_sale`, `void_delivered_order` (1112) | Passam a emitir **Nota de Crédito** com o motivo; nunca alterar a FR |
| Multi-loja | `store_id` + `auth_can_store` (RLS) | RLS de leitura por loja nas tabelas fiscais; série por loja (ex.: `FR MPT2026`, `FR MTL2026`); emitente = dados da empresa (NUIT) com a morada da loja |
| Talão | `packages/receipt/src/tickets.ts` + `services/print-bridge` | Novo layout "Factura-Recibo" de 80 mm com todos os elementos (ver `DocumentoFiscal.exemplo.tsx` da skill). **Precisa do `.exe` novo nas lojas** — uma bridge antiga não pode imprimir uma factura incompleta: o servidor deve marcar trabalhos fiscais que a bridge antiga recusa |
| NUIT do cliente | checkout, POS (campo opcional), conta do cliente | Pedir NUIT antes de fechar; depois só por reemissão (NC + nova FR) |
| Ficheiro mensal | ao lado de `export_sales_for_accounting` (aba Análise) | Exportação XLSX/CSV/XML por mês; colunas provisórias até a AT enviar o modelo |
| Definições | Painel (dono) | Nome legal, NUIT, morada, regime, n.º de certificação AT (vazio até existir) |

## 5. Riscos deste repositório (ler antes de tocar)

- **O `supabase` CLI está ligado ao LIVE** (`CLAUDE.md §2`). Uma migration fiscal vai directa para a loja e os
  documentos são **imutáveis**: um teste mal feito deixa facturas para sempre. Recriar o staging primeiro; até lá,
  só revisão + dry-run + fora do horário de loja, com `/aplicar-migration-supabase`.
- `TRUNCATE` não dispara triggers de linha: revogar `TRUNCATE` nas tabelas fiscais.
- Testar em base descartável; nunca emitir facturas de teste com o NUIT real do HAWSMASH.

## 6. O que se pode prometer (regra dura)

- Não dizer nem imprimir "certificado" sem número da AT; não dizer "em processo de certificação" antes de o pedido
  (email a efacturação@at.gov.mz, rascunho na skill) ter sido enviado.
- Frase segura, quando o caminho A estiver implementado: "emite factura com NUIT e IVA, documentos inalteráveis e o
  ficheiro do e-Declaração; o n.º de certificação da AT passa a constar quando for atribuído".

## 7. Próximos passos

1. Conversa comercial com o Ridwan: caminho A, B ou C; se A/B, aditamento ao contrato.
2. Perguntas ao contabilista (lista na skill).
3. ~~ADR com a decisão~~ — [ADR 0013](docs/decisions/0013-facturacao-fiscal-no-motor.md) (motor); `CLAUDE.md §0`, B-005 e B-019 mudam quando o cliente decidir.
4. Caminho A: passos 2, 3, 4, 5 e 8 da skill feitos no núcleo (16/11). Faltam o talão, os ecrãs, o ficheiro do mês e o
   pedido à AT — lista numerada em [docs/modulos/facturacao.md](docs/modulos/facturacao.md). Staging antes do LIVE.
