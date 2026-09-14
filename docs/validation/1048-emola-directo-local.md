# 1048 — preparação de e-Mola directo

Data: 2026-09-14. Migration: `20260914001146_1048_emola_directo_preparado.sql`.

SHA-256 do SQL em UTF-8, com finais de linha LF:
`99cb053c659c2b6e9dc0b462e45e4743bdcd6ac789f377b29db56bb69a45b5b3`.

**16/16 verificações SQL passaram em PostgreSQL através de PGlite 0.4.1.**
Oito destes casos falharam antes da implementação. A reaplicação também passou
e preservou a configuração existente das lojas.

O ensaio cobriu:

- Encaminhamento independente para `emola` e `emola_sim`, mantendo M-Pesa directo
  e a compatibilidade do gateway anterior.
- Escolha pelo dono, auditoria/configuração herdadas e ausência de exigência de
  credenciais Paysuite para o novo caminho.
- Recusa de e-Mola real pela RPC pública antes de criar um pedido digital novo.
- Simulador directo com método `emola`, criação idempotente e claim único de 1047.
- Bloqueio da troca entre simulador e real com pagamento pendente; outra loja independente.
- Recusa ao não-dono e a valores inválidos; retomada de pedido existente antes da
  guarda de integração real; comprovativo manual preservado.

O encaminhamento/configuração JavaScript também teve testes primeiro: sete casos
novos falharam antes e passaram depois, juntamente com os 14 casos anteriores.
Um oitavo teste novo demonstrou primeiro e corrigiu depois a ausência de bloqueio
do simulador em produção: `NODE_ENV=production` agora impede construir `emola_sim`.
O lint dos ficheiros de configuração/painel e o typecheck de `@delivery/core` passaram.

A revisão independente encontrou ainda um erro anterior no confirmador comum:
respostas `invalid_state` e `amount_mismatch` da RPC eram anunciadas como sucesso.
Foram escritos 19 testes, com 18 falhas primeiro, e corrigido o contrato: apenas
`ok` confirma de imediato; `duplicate` exige releitura por pedido e loja, estado
pago ou posterior, método e valor iguais. Falhas de consulta e respostas desconhecidas
não confirmam, não revelam erros internos e não disparam email/conversões.
Uma confirmação duplicada válida também não repete esses efeitos. Os 81 testes
focados de confirmação, cobrança, verificação, webhook e reconciliação passaram;
o lint do confirmador não apresentou erros. Estes ensaios usam mocks da RPC:
a integração com a stack Supabase completa continua pendente.

## O que está efectivamente preparado

`emola_sim` constrói o simulador directo sem credenciais apenas em desenvolvimento/teste;
em produção devolve `emola_sim_disabled_in_production`. `emola` representa a
integração real pendente: `buildProvider` devolve o erro
`emola_direct_contract_unavailable`, e a mesma guarda existe em `create_order`.
Não foram inventados endpoints, autenticação, contratos ou colunas de segredos Movitel.
A implementação real exigirá o contrato técnico, testes do fornecedor e uma migration
posterior que retire essa guarda quando o adapter estiver funcional.

## Limites e repetição

Foi utilizado um schema mínimo com identidades e dependências antigas simuladas.
O SQL das migrations correu realmente; não foi validada a stack completa de RLS,
triggers, PostgREST, concorrência ou qualquer serviço Movitel/Paysuite.
Nenhuma cobrança ou chamada externa de pagamento foi efectuada.

O runner usa PGlite numa pasta temporária desta máquina e não acrescenta dependências
ao produto. Os resultados completos ficaram em `output/emola/verify-1048-pglite.mjs`,
`sql-1048-red.log` e `sql-1048-results.json`, ignorados pelo Git.

O teste versionado contém 11 verificações pgTAP de encaminhamento, recusa antes da
criação e permissões, com dados `PLACEHOLDER_` revertidos no fim. Na stack local completa,
depois de aplicar as migrations:

```powershell
pnpm exec supabase test db --local supabase/tests/emola_direct_routing.sql
```

Este comando na stack completa e a validação com a Movitel continuam pendentes.
