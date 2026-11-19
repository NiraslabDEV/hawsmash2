# Escritório

> **Estado a 19/11/2026:** escrito, testado e verificado no browser contra a base local. **Migrations 1138–1141 por
> aplicar no LIVE**; a facturação continua desligada por defeito. Decisões em [ADR 0013](../decisions/0013-facturacao-fiscal-no-motor.md)
> e [ADR 0014](../decisions/0014-modulo-escritorio.md). Facturação em detalhe: [facturacao.md](facturacao.md).
> **Isto não é parecer fiscal** e o programa **não está certificado** pela AT.

## O que o dono encontra (painel → Escritório)

| Aba | Quem | O que faz |
|---|---|---|
| Resumo do mês | dono, gerente (as suas lojas) | Vendas facturadas, IVA liquidado, IVA das compras e saldo estimado, por loja e por meio de pagamento. Descarrega o ficheiro das facturas (CSV para o e-Declaração), o SAF-T (XML) e as compras (CSV) |
| Facturas | dono, gerente | Lista com pesquisa por número, NUIT ou nome; A4 para imprimir/PDF; 2.ª via no talão; reemitir com NUIT (Nota de Crédito + Factura-Recibo nova) |
| Compras | dono, gerente | Factura do fornecedor com fotografia ou PDF, NUIT, IVA (16 % incluído, sem IVA ou valor escrito), dedutível ou não; editar com rasto; anular com motivo |
| Obrigações | dono define; gerente marca as da sua loja | Prazos mensais, anuais ou únicos (dia fixo ou último dia útil), com aviso antes; "Feito" por período |
| Arquivo | dono (empresa) e gerente (loja) | Alvará, licenças, certidões, contratos, seguros, extintores, com validade e cópia |
| Pessoal | só dono | NUIT, n.º do INSS, documento, admissão e salário base; exportação CSV para o contabilista |
| Contabilista | só dono | Cria uma ligação só de leitura, com prazo; mostra quando foi usada; revoga |
| Facturação | só dono | Dados fiscais, regime e taxa, n.º de certificação (vazio até a AT o atribuir), impressão automática, ligar/desligar, emitir pendentes, verificar a cadeia |

Fora do painel:
- **POS:** cartão "Factura com NUIT" no pagamento (NUIT, nome, morada pelo teclado de toque), só com a facturação
  ligada. Funciona na venda, na conta da mesa e sem rede.
- **Site:** "Quero factura com NUIT" no checkout, só com a facturação ligada.
- **Contabilista:** `/contabilista#<token>` — resumo dos últimos 6 meses e as mesmas descargas do dono.
- **Talão fiscal de 80 mm** sai sozinho na loja quando a venda fica paga (configurável) e na 2.ª via.

## Peças

| Peça | Onde |
|---|---|
| Adquirente antes de pagar, talão fiscal, 2.ª via, lista, reemissão com morada, `fiscal_status` | [`1140_facturacao_completa.sql`](../../supabase/migrations/20261119120000_1140_facturacao_completa.sql) |
| Compras, obrigações, arquivo, pessoal, resumo do mês, acesso do contabilista, avisos, bucket privado `office-files` | [`1141_escritorio.sql`](../../supabase/migrations/20261119120100_1141_escritorio.sql) |
| Formato do talão fiscal (48 colunas) | [`packages/receipt/src/fiscal.ts`](../../packages/receipt/src/fiscal.ts) |
| Regras do ecrã (NUIT, dinheiro, prazos, validades, erros em português) | [`apps/web/lib/escritorio/regras.ts`](../../apps/web/lib/escritorio/regras.ts) |
| Ficheiros do mês (verifica a cadeia antes de entregar) | [`apps/web/lib/escritorio/ficheiros.ts`](../../apps/web/lib/escritorio/ficheiros.ts) |
| Painel | [`apps/web/app/(admin)/escritorio/`](../../apps/web/app/(admin)/escritorio/page.tsx) |
| Portal do contabilista | [`apps/web/app/(contabilista)/contabilista/page.tsx`](../../apps/web/app/(contabilista)/contabilista/page.tsx) |
| Rotas | `/api/escritorio/export` (sessão do dono), `/api/contabilista/export` (POST com o token), `/api/cron/escritorio` (CRON_SECRET) |
| Cron | [`scripts/sql/install-escritorio-cron.sql`](../../scripts/sql/install-escritorio-cron.sql), a cada 15 min |

## Regras que não se dobram

- **A venda nunca pára.** NUIT que não se consegue juntar → a venda segue como consumidor final e o POS diz para
  reemitir no Escritório. Factura que falha → pendente, emitida pelo cron.
- **O documento é o que ficou gravado.** O A4 e o talão leem o documento, nunca as definições de agora.
- **Nada sobre certificação no papel** sem o número da AT em Facturação.
- **Ficheiro do mês só sai com a cadeia íntegra.** Se não bater, a rota responde 409 com o documento em falha.
- **Contabilista não vê clientes, pedidos nem pessoal.** Cada visita e cada descarga ficam no `event_log`.
- **Ficheiros privados.** Bucket `office-files`, só dono e gerente; abrem por ligação assinada de 5 minutos.

## Como ensaiar

```bash
node scripts/fiscal-local.mjs fiscal fiscal_rpcs fiscal_1140 escritorio   # SQL, em ROLLBACK, base local
pnpm --filter @delivery/receipt exec vitest run                            # talão de 80 mm
npx vitest run --root apps/web lib/escritorio lib/admin                     # regras e menu
```

Verificação no browser a 19/11/2026 (base local, dono de ensaio): as 8 abas sem erros na consola, o A4 de uma Nota
de Crédito, o portal do contabilista, as três descargas (o ficheiro do portal é igual ao do painel), recusa sem
sessão (401) e com ligação inventada (403), e o cron a não repetir avisos no mesmo dia. No telemóvel, o resumo não
desliza para o lado. **Não verificados no browser:** o cartão do NUIT no POS (precisa de um terminal vinculado) e
o do checkout (precisa de carrinho); estão cobertos por tipos e pelos ensaios SQL das RPCs que chamam.

## Para ligar num cliente — por esta ordem

1. Decisão comercial e contabilista (B-019).
2. Aplicar 1138, 1139, 1140 e 1141 fora do horário, com a skill `aplicar-migration-supabase`. Inofensivas desligadas.
3. Deploy (dev → main). O separador Escritório aparece ao dono e ao gerente.
4. **Actualizar a bridge das lojas** (o talão fiscal vem na versão nova de `@delivery/receipt`). Ver [impressao.md](impressao.md).
5. Instalar o cron (`install-escritorio-cron.sql`) depois de `GET /api/cron/escritorio` responder 200.
6. Escritório → Facturação: dados fiscais, depois ligar. Fazer uma venda de ensaio e conferir talão, A4 e ficheiro.
7. Escritório → Obrigações: juntar os modelos e preencher os dias com o contabilista.
8. Escritório → Contabilista: criar a ligação e enviá-la ao contabilista.

## Limites conhecidos

- Os avisos saem só por email (não por WhatsApp).
- Os feriados não entram no "último dia útil".
- Não há XLSX: o CSV abre no Excel (UTF-8 com BOM, separador `;`).
- WhatsApp e garçom não pedem NUIT; a factura com NUIT faz-se por reemissão no Escritório.
- Pessoal não processa salários: é a ficha para o contabilista.
