# ADR 0006 — Definições do POS por loja, como dado

Data: 2026-09-23. Estado: aceite.

## Contexto

O ecrã do balcão tinha a sua configuração escrita no código: os quatro meios de pagamento, as notas
rápidas ("SEM JALAPENO"), as frases do upsell ("Quer provar o WAGYU?") e comportamentos fixos (abre
sempre em Balcão, confirmação de 3 s, alarme sempre ligado). O interruptor do upsell do balcão era o
mesmo da loja online (`settings.upsell_enabled`).

Consequências: mudar uma frase era um deploy; duas lojas não podiam vender de forma diferente; e o
código do produto falava do cardápio de um cliente (§18.3) — quem copiava o POS para outro restaurante
herdava o WAGYU.

## Decisão

- **Uma linha por loja** em `store_pos_settings (store_id, config jsonb)`, migration 1067.
  `config` é **jsonb** e não uma coluna por campo: são definições de ecrã, que crescem com o produto.
  A aplicação lê-o campo a campo por cima de um valor de fábrica (`resolvePosSettings`), portanto
  acrescentar uma definição não pede migration e uma chave estragada nunca deixa o balcão sem vender.
- **Escrita só por RPC** (`save_pos_settings`), com `event_log` `store.pos_settings_changed` e as
  secções que mudaram. Leitura por `get_pos_settings`. RLS por `auth_can_store` (Regra 3).
- **Dono e gerente da loja escrevem.** É operação da loja (§6: o gerente tem "operação completa"):
  tirar o cartão porque o terminal do banco avariou, afinar as frases da equipa. Configuração de
  loja propriamente dita (morada, números, zonas) continua do dono, na aba Lojas.
- **O servidor não impõe estas escolhas.** Esconder um meio de pagamento é ecrã, não regra de
  dinheiro: uma venda offline feita antes da mudança tem de sincronizar (§7.5). O que tiver de ser
  imposto vira coluna com RPC própria, não definição do POS.
- **O POS guarda a última cópia** em `localStorage` e relê a cada 2 min, junto com o cardápio.
- **Valor de fábrica neutro.** As frases e notas que esta instalação já usava passaram para dados
  (migration 1068, guardada pela marca); o código deixou de nomear produtos.
- O upsell da loja online continua em `settings` — é outro ecrã, com outro público.

## Alternativas rejeitadas

- **Colunas em `stores`.** `stores` é a operação da unidade (§5.1); encher a tabela com dezenas de
  campos de ecrã tornava cada definição nova uma migration e misturava segredos com preferências.
- **Singleton em `settings` (empresa).** As duas lojas querem coisas diferentes (a Matola pode não
  ter terminal de cartão); a regra 3 pede `store_id`.
- **Impor no `create_counter_sale`.** Partia a sincronização offline por uma questão de ecrã.

## Consequências verificáveis

- `packages/db/tests/pos-settings.test.ts`: anon não lê nem escreve; gerente da Matola não lê nem
  escreve Maputo; operador lê e não escreve; cada gravação fica no `event_log`.
- `apps/web/lib/pos/__tests__/settings.test.ts`: lixo cai na fábrica sem levar o resto; nunca
  zero meios de pagamento.
- Portabilidade e checklist de cópia: [`docs/POS-DEFINICOES.md`](../POS-DEFINICOES.md).
