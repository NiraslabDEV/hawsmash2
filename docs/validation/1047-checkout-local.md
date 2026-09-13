# 1047 — idempotência do checkout online

Data: 2026-09-14. Migration: `20260913233656_1047_checkout_idempotente.sql`.

SHA-256 do SQL em UTF-8, com finais de linha LF:
`e822ae70bdf8ac009d844ddee21a38dcb7beb4552390f64fb13568277e6c16b6`.

**22/22 verificações passaram em PostgreSQL através de PGlite 0.4.1**, incluindo
reaplicação da migration. Antes da implementação, 19 destes casos falharam.
Os ficheiros completos ficaram em `output/emola/verify-1047-pglite.mjs`,
`sql-1047-red.log` e `sql-1047-results.json`; são artefactos locais ignorados pelo Git.

Foi verificado:

- Exigência e validação de `clientCheckoutId` no fluxo digital; manual antigo preservado.
- Mesmo identificador e payload devolvem o pedido original, sem nova criação;
  ordem das propriedades JSON não altera o hash; dados ou método diferentes são recusados.
- Identificadores são únicos dentro de cada loja; outra loja e uma nova chave são independentes.
- Índice único impede duplicação por escrita directa; hash SHA-256 não guarda o payload.
- Claim reservado ao servidor e persistido antes do fornecedor; repetição devolve a URL
  existente ou mantém a tentativa pendente, sem adquirir uma segunda iniciação.
- Claim não inicia pedidos pagos, cancelados, manuais ou pedidos antigos sem chave.
- Retry de um pedido pago conserva o pedido original mesmo após desligar o gateway.
- Grants preservam leitura das 34 colunas anteriores de `orders`, excluindo chave,
  hash, data do claim e URL do checkout do acesso directo do browser.

## Vida da chave e recuperação

A chave permanece associada ao pedido enquanto o histórico existir, sem expiração
automática. O browser tem de a persistir **antes** do primeiro POST e repeti-la com
o mesmo payload enquanto o resultado for incerto. Uma encomenda nova recebe outro UUID;
reutilizar uma chave com conteúdo diferente produz `checkout_payload_mismatch`.
O índice é por loja: uma colisão na mesma loja não gera uma segunda encomenda.

O claim também não expira. Se o processo parar entre adquirir o claim e receber a
resposta do fornecedor, repetir o POST não faz nova cobrança. Essa tentativa precisa
de consulta, webhook ou conferência pela equipa. Não se pode limpar o claim ou gerar
outra chave apenas porque o pedido demorou; primeiro é preciso excluir cobrança anterior.

## Limites e repetição

Foi usado um schema mínimo com identidades e dependências antigas simuladas. O SQL
de 1046/1047 correu realmente; não foi executada a stack completa de RLS, triggers,
PostgREST, callbacks ou pagamentos. O ensaio não mede concorrência real entre sessões;
o lock de loja, o lock do claim e o índice único ainda precisam do ensaio em staging.

O runner usa PGlite instalado numa pasta temporária desta máquina, sem acrescentar
dependências ao produto. O teste portátil versionado contém 17 verificações pgTAP
de validação, claim e permissões, com dados `PLACEHOLDER_` numa transacção revertida.
Com a stack local de testes completa e as migrations aplicadas:

```powershell
pnpm exec supabase test db --local supabase/tests/checkout_idempotency.sql
```

Os fixtures de `create_order` digital em `mpesa-reference.test.ts`, `payments.test.ts`
e `stock.test.ts` passaram a enviar UUID por encomenda. A suite de M-Pesa configura
o simulador e restaura o gateway no fim. As suites antigas suspensas continuam suspensas;
não são apresentadas como cobertura executada. Os pedidos antigos inseridos directamente
por testes de conta continuam válidos sem chave, como o histórico real.

A integração na stack completa e a recuperação de resposta perdida com o fornecedor
continuam a exigir validação em staging antes da activação real (B-108/B-109).
