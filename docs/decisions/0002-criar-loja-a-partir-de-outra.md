# ADR 0002 — criar uma loja copiando a configuração de outra loja

- Estado: **aceite — implementação adiada para a Fase 2**
- Data: 2026-08-22
- Decisores: Niraslab / HAWSMASH

## Contexto

Hoje `createStore()` ([`apps/web/app/(admin)/lojas/page.tsx`](../../apps/web/app/(admin)/lojas/page.tsx))
envia quatro campos a `save_store`: `slug`, `name`, `short_name`, `order_prefix`. Mais nada. A loja nasce
vazia — sem horário, sem canais, sem números de pagamento, sem rodapé de talão — exactamente como o
`CLAUDE.md §5.6` descreve.

Quem cria a loja tem depois de preencher tudo à mão, **incluindo escrever os números M-Pesa e e-Mola**.
Como as duas lojas partilham os mesmos números (`CLAUDE.md §16` P3), isso é trabalho repetido com um risco
concreto: um dígito trocado num número de pagamento não dá erro nenhum — dá dinheiro na conta errada.

## Decisão

Ao criar uma loja, o painel oferece **copiar a configuração de uma loja existente** — "copiar de: Maputo |
Matola | não copiar".

**Copia-se de uma loja real, não de modelos guardados numa tabela.** Uma tabela `store_templates` teria de
ser mantida em paralelo com a realidade: no dia em que alguém mudasse o horário da Maputo e se esquecesse do
modelo, o modelo passava a mentir — e mentiria em silêncio, que é o pior tipo. Copiar do que a loja tem hoje
nunca fica desactualizado, e poupa uma tabela, um ecrã de gestão e um caminho de auditoria.

### O que se copia e o que nunca se copia

| Copia | Nunca copia |
|---|---|
| Canais (`delivery_enabled`, `pickup_enabled`, `counter_enabled`) | `slug` e `order_prefix` — imutáveis e únicos (§5.6) |
| `mpesa_number` / `mpesa_name` / `emola_number` / `emola_name` | **`paysuite_api_key` e `paysuite_webhook_secret`** |
| `receipt_header` / `receipt_footer` | `address`, `maps_url`, `phone`, `owner_email` |
| `store_hours` (as 7 linhas) | `accepting_orders` — loja nova nasce sempre **fechada** |
| Estrutura de `delivery_zones` (ponto de partida, a rever com dados reais) | — |

### A regra que não se negoceia

**Os segredos do Paysuite nunca são copiados.** Se o modelo copiasse a chave da Maputo para uma loja nova, o
dinheiro dessa loja passava a cair na conta da Maputo — sem erro, sem aviso, a aparecer semanas depois num
fecho de caixa que não bate. A loja nova nasce em `payment_provider = 'manual'` até alguém pôr a chave dela.

É a regra `CLAUDE.md §5.6` ("segredos nunca chegam ao browser") aplicada ao momento da criação: a cópia
acontece **dentro** da RPC `SECURITY DEFINER`, e as colunas de segredo ficam fora do `insert`.

## Porque é que fica para a Fase 2

A 3.ª loja está fora do âmbito comercial fechado (`CLAUDE.md §0`) e faltam semanas para abrir duas. O que
esta funcionalidade resolveria já — configurar a Matola — resolve-se desta vez **à mão**, com a rede de
segurança que já existe: a checklist de abertura ([`RUNBOOK.md §7`](../RUNBOOK.md)) obriga a conferir os
números M-Pesa/e-Mola da loja com um **teste de pagamento real de 1 MT**. É esse teste, e não o formulário,
que apanha o dígito trocado.

## Fora de âmbito desta decisão

**O perfil de hardware não entra em `stores`.** O que separa Maputo de Matola em equipamento (PC, SO,
resolução, impressora integrada — [`HARDWARE.md §1.1`](../HARDWARE.md)) não tem nem deve ter coluna em
`stores`: é o que permite trocar o PC de uma loja sem tocar em nada do sistema. Hardware pertence a
`devices`. O que pode vir a valer a pena é a metade útil — a **checklist de abertura por perfil**, com o
perfil Matola a acrescentar as mitigações do Windows 10 de [`HARDWARE.md §3`](../HARDWARE.md) — e isso é
uma decisão à parte, se e quando se justificar.

## Consequências

- A Matola é configurada à mão uma vez, com o teste de 1 MT como verificação.
- Quando a funcionalidade for construída (G8 do `ROADMAP.md`), precisa de: RPC nova com a cópia dentro do
  `SECURITY DEFINER`, `event_log` a registar de que loja se copiou, e um teste que prove que
  `paysuite_api_key` e `paysuite_webhook_secret` da loja de origem **não** aparecem na loja nova.
- Uma loja criada por cópia continua a nascer fechada e continua a ter de passar a checklist de abertura.
