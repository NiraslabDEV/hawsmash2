# Facturação e WhatsApp — validação de 16/11/2026

Corrida parcial em `dev`. Sem push, merge, SQL remoto, pagamento ou envio de mensagens.
As alterações preexistentes foram preservadas; não houve commits.

| Fase | Resultado observado |
|---|---|
| A1 | RPCs passaram ligadas/desligadas; concorrência de 20 pagamentos passou; lint global impede fecho |
| A2 | Teste do motivo vermelho antes da 1139 e verde depois; apenas uma linha acrescentada por função |
| A3–A10 | Não implementadas; continuação após integrar B-125 |
| B1–B4 | Não implementadas. Nenhuma avaliação paga executada |

## Validações

- `node scripts/fiscal-local.mjs fiscal fiscal_rpcs`: 13 grupos originais OK e RPCs reais OK, em rollback.
- `node scripts/fiscal-concorrencia.mjs`: 20/20 FR, sequência 1–20 contínua/única; instante nunca recua.
- `pnpm --filter @delivery/fiscal exec vitest run`: 12/12 testes, 2 ficheiros.
- `pnpm test`: 1631/1631 testes, 170 ficheiros.
- `npx vitest run --root apps/web`: 1064/1064 testes, 118 ficheiros.
- `pnpm --filter web exec tsc --noEmit -p .`: terminou sem erros.
- `pnpm lint`: falhou no código preexistente:

```text
@delivery/fiscal:lint: src/fiscal.ts
283:11 error Irregular whitespace not allowed no-irregular-whitespace
ERROR run failed: command exited (1)
```

O `npx tsc` na raiz não encontra o compilador do workspace; validou-se com o `tsc` instalado na app.
O pnpm 9 não aceita `test --run` neste comando; usou-se `exec vitest run`.

## Migrations e segurança

Ordem: **1138** (preexistente, intacta) → **1139** (nova, motivo da NC).
O runner inclui 1135–1137 na transacção para suportar a base local atrasada. Sem `db reset`.
A 1139 foi ensaiada, não aplicada. Aplicação no LIVE é do Gabriel.
A concorrência copia só a estrutura da base local para uma BD descartável e elimina só essa BD.

## Continuação

B-125: integrar o escape do BOM sem recolher o trabalho preexistente num commit desta corrida.
Depois faltam NUIT antes da emissão; definições/documentos; impressão e versão da bridge; exportação verificada;
pendentes/alertas; regimes; activação e email AT; avaliações IA; localização/media/notas/estado/repetição;
tokens e observabilidade. Não se declara a facturação utilizável nem o WhatsApp fechado.

Não houve commit: AGENTS §1.4 exige lint/testes verdes por commit; o prompt proíbe tocar no trabalho de outras
sessões. As actualizações de ROADMAP/BLOQUEIOS/módulo são aditivas. Nenhuma validação em browser,
bridge física, Meta, AT ou contabilista nesta corrida. Ver PACOTE FINAL em BLOQUEIOS.md.
