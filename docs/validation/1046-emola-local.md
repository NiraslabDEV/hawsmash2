# 1046 — validação local do e-Mola por loja

Data: 2026-09-14. Migration: `20260913232252_1046_emola_por_loja.sql`.

SHA-256 do SQL em UTF-8, com finais de linha LF:
`51dd1d5a25259c7282925dda97454ee5f7aebdd222f5fcf7765e6c08a895584f`.

**Resultado: 36/36 verificações SQL passaram em PostgreSQL através de PGlite 0.4.1.**
A migration foi aplicada e reaplicada na mesma base temporária. Não foram usados
segredos, contas de pagamento ou bases de dados externas.

O ensaio verificou:

- Nove combinações de gateway/método, incluindo M-Pesa directo com e-Mola separado,
  herança de Paysuite, simulação e métodos incompatíveis.
- Recusa de pedido digital quando e-Mola está desligado; criação de pedido pendente
  na loja quando está ligado; preservação do fluxo por comprovativo.
- Configuração só pelo dono; resposta e auditoria sem valores de segredos;
  menu e ficha administrativa com a configuração pública.
- Bloqueio da troca de gateways com pedidos digitais pendentes ou falhados;
  independência da outra loja; correcção de credenciais e remoção por campo vazio.
- Loja nova com gateway manual e sem segredos, mesmo que o payload os tente copiar.
- Ausência de permissões anónimas no helper/configuração e de INSERT/UPDATE directo
  de `stores` para `authenticated`, partindo do grant antigo de escrita da tabela.
- Evento `PAYMENT_FAILED` reservado ao servidor, com loja e origem na auditoria;
  repetição sem novo evento; preservação de pedidos pagos, cancelados e manuais.
  A resposta inclui o estado real final. Outros eventos continuam a delegar no motor anterior.

Os seis casos novos da transição de falha falharam antes de a implementar,
com `invalid_event:PAYMENT_FAILED`, e passaram depois.

O código JavaScript teve testes primeiro para o encaminhamento e a configuração:
helper inexistente e cinco comportamentos incorrectos falharam antes; os 14 testes
novos passaram depois, juntamente com os três testes existentes de configuração
estrita da reconciliação. O typecheck de `web` passou.

## Limites e repetição

Foi usado um schema mínimo sintético. As funções antigas de cardápio, criação de
pedido e transições de stock/impressão foram simuladas; o contrato da nova camada
foi executado com o SQL real. As identidades de autenticação também foram simuladas.
Isto não valida as policies RLS completas, os triggers de produção, PostgREST,
concorrência, capacidade, callbacks HTTPS ou cobrança real.

O runner e o resultado completos ficaram em `output/emola/verify-1046-pglite.mjs`
e `output/emola/sql-results.json`, ignorados pelo Git. O runner usa uma instalação
temporária de PGlite desta máquina e não é portátil; não foi adicionada dependência
ao produto para esse ensaio.

O teste versionado `supabase/tests/emola_routing.sql` contém 13 verificações pgTAP
de encaminhamento e permissões. Com a stack de testes local completa e a migration
aplicada, executar:

```powershell
pnpm exec supabase test db --local supabase/tests/emola_routing.sql
```

Esse ensaio na stack completa, os testes de isolamento por loja e a integração
real continuam pendentes nos bloqueios B-108/B-109. As verificações locais não os fecham.
