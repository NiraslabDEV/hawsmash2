# ADR 0008 — A base onde a loja já vende passa a ser o LIVE

Data: 2026-09-29. Estado: aceite; transição em curso.

## Contexto

O plano (CLAUDE §2) dizia: LIVE no projecto `hawsmash2` (`hmutptcbusxncnofinrw`, org Pro), staging no
`hawsmash2-staging` (`pqjoanrsjkddkjsllqov`). Na prática, a loja de Maputo passou a operar no
**staging** a partir de 22/09: POS, mesas, pedidos online, bridge da loja 101, cardápio novo de 24/09,
equipa com PINs e stock. Até 29/09 foram 340 pedidos. O `hawsmash2` nunca teve equipa, terminais nem
vendas do 2.0 — só o histórico do 1.0 importado a 31/08 e um cardápio mais antigo.

Pôr a loja no `hawsmash2` obrigava a copiar vendas, contas (`auth`), PINs, mesas, stock, cardápio e
configuração com a loja fechada, e a reconfigurar a bridge no mini-PC. É uma migração completa com
risco de perder uma venda ou um stock — o contrário da Regra 1.

## Decisão

Decisão do Gabriel a 29/09, ao fazer o cutover:

- O projecto **`hawsmash2-staging` (`pqjoan…`) passa a ser o LIVE.** Nada é copiado; a bridge não muda.
- O Railway `production` (ramo `main`) aponta para ele; `hawsmash.com` e `www.hawsmash.com` saíram do
  projecto Railway do 1.0 (`hawsmash`) para o `hawsmash2 / production`.
- O endereço `hawsmash2-staging.up.railway.app` continua a servir a **mesma base** até os terminais
  passarem para `hawsmash.com/pos`. Só depois se reponta o serviço de staging para uma base nova.
- O 1.0 continua no ar no endereço Railway dele, sem domínio, e não se apaga durante 90 dias (§15).

## Consequências

- **Não há staging separado até se criar um.** O `supabase` CLI deste repositório está ligado ao
  `pqjoan…`: um `supabase db push` aplica na loja. Os testes de integração de BD não correm contra
  esta base (o travão `packages/db/tests/setup/impressora-real.ts` pára-os enquanto a bridge da loja
  estiver viva).
- **O projecto está na org "QR Mesas", no plano gratuito**: pausa por inactividade (aconteceu a 22/09)
  e não tem PITR. Tem de ser transferido para a org Pro ("NiraslabDEV's Org"); o ref e as chaves
  mantêm-se.
- Os crons lêem `app_cron_base_url` do Vault, que ainda aponta para o endereço de staging. Funciona
  enquanto esse endereço servir esta base; muda-se para a produção **antes** de repontar o staging.
- O `hawsmash2` (`hmutpt…`) fica sem uso: candidato a novo staging.
- Matola fechada ao público a 29/09, a pedido do dono: `active = false` (sai da lista, `/l/matola` dá
  404, o checkout recusa) e `accepting_orders = false`, com motivo no `event_log`. O cartão "Matola já
  abriu." saiu da página inicial (Aparência). Reabrir: `save_store` com `active: true` — o painel não
  tem botão para `active` — e "Reabrir loja" na aba Lojas.

## Pendentes

1. ~~DNS na Hostinger para os alvos novos do Railway, com os dois TXT `_railway-verify`.~~ Feito a
   30/09; certificados emitidos e domínios verificados.
2. Transferir o `hawsmash2-staging` para a org Pro.
3. Terminais da loja em `hawsmash.com/pos` (vincular de novo); depois, crons e novo staging.
4. ~~Importar pedidos e clientes do 1.0 (`scripts/import-hawsmash-1.ts`, com `--sem-cardapio`) depois da troca
   de DNS, com dry-run primeiro.~~ Feito a 30/09: 1024 pedidos e 511 clientes, reconciliado ao
   cêntimo com o 1.0 (B-010).
5. Os 73 pedidos de ensaio de 19/08 a 02/09 (`MPT-`/`MTL-`, 51.739 MT, 20 na Matola) contam nos
   relatórios. Confirmados como ensaio pelo dono; retirar só com dry-run e cópia antes.
