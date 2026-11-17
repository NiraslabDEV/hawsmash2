# ADR 0013 — Facturação fiscal dentro do motor, desligada por defeito

- Estado: aceite para o **motor** (pedido do Gabriel a 16/11/2026); **activar num cliente continua por decidir** (B-019)
- Data: 2026-11-16
- Decisores: Gabriel (Niraslab)
- Contexto longo: [FATURACAO-CERTIFICADA.md](../../FATURACAO-CERTIFICADA.md) · Módulo: [docs/modulos/facturacao.md](../modulos/facturacao.md)

## Contexto

Os clientes maiores não compram um sistema de vendas que não emita documento fiscal válido. Em Moçambique o
programa tem de ser autorizado pela AT, a factura tem elementos obrigatórios (série e número sequencial, NUIT,
preço sem IVA, taxa e valor do IVA), nada se apaga, e todos os meses entrega-se o ficheiro das facturas no
e-Declaração. Hoje o sistema imprime talão sem valor fiscal e exporta um CSV para o contabilista.

Havia três caminhos: facturar no motor (A), chamar um facturador já certificado (B) ou ficar como está (C).

## Decisão

1. **Caminho A: o motor emite.** O mesmo código serve o Restaurant OS e os produtos que saírem dele; certifica-se
   uma vez.
2. **Nasce desligada.** Sem `fiscal_settings.active`, nenhuma venda muda. Ligar é do dono, no painel, com nome
   legal, NUIT, morada e regime; fica gravado o **instante** — o que foi pago antes nunca é facturado.
3. **O gatilho está em `payments`.** Todos os caminhos de venda (balcão, offline sincronizado, site, WhatsApp,
   mesa, garçom) confirmam o pagamento ali: não há RPC de venda a alterar nem caminho a esquecer. A alternativa
   — chamar a emissão dentro de cada RPC — obrigava a reescrever sete funções grandes no LIVE.
4. **A venda nunca pára (regra 1).** A emissão corre num bloco com `exception` e espera no máximo 4 s pela série;
   o que falhar fica em `event_log` (`fiscal.emit_failed`) e sai depois por `fiscal_emit_pending`.
5. **Série por loja e por ano** (`FR MPT2026/000001`): as lojas emitem em paralelo sem partilhar numeração.
6. **Imutável na BD.** UPDATE, DELETE e TRUNCATE recusados por gatilho, a qualquer papel. Anular é Nota de Crédito;
   NUIT pedido depois é NC + FR nova. Cada documento leva o hash do anterior da série.
7. **Uma conta de mesa, uma factura.** Anular um lançamento de uma conta já facturada emite a NC do documento
   inteiro e uma FR nova para o que continua pago.
8. **O total do documento é o que o cliente pagou.** Os descontos repartem-se pelos artigos na proporção do valor;
   a entrega é linha própria.

## Consequências

- O contrato `NL-2026-HS-EXP` continua a pôr a facturação certificada **fora de âmbito**. Ligá-la no HAWSMASH é
  aditamento, conversa com o Ridwan e com o contabilista (B-019). Este ADR não a liga.
- **Não se diz nem se imprime "certificado"** sem número da AT em `fiscal_settings.at_certificate`, nem "em
  processo de certificação" antes de o pedido à AT ter sido enviado.
- O modelo do ficheiro do e-Declaração é entregue pela AT às empresas de software: as colunas de
  `packages/fiscal` são provisórias até chegar.
- Falta, antes de qualquer activação: talão "Factura-Recibo" de 80 mm e bridge nova, ecrã das definições, campo
  NUIT no POS e no checkout, rota do ficheiro do mês e cron dos pendentes — lista em
  [facturacao.md](../modulos/facturacao.md).
