# Garçons: pedido da mesa no telemóvel

Desde a 1122, o garçom lança o pedido da mesa a partir do telemóvel, em `/garcom`. O pedido é o mesmo que o caixa lança no POS ([Mesas](mesas.md)): preço da loja calculado na BD, stock baixado na mesma transacção, comanda nas vias da loja (balcão e cozinha) e senha pequena no balcão. Fica na conta aberta da mesa, que o caixa cobra no fim com `close_table_bill`. O garçom não mexe em dinheiro.

## Identidade: o garçom não é equipa

O desenho é o do [estafeta](estafetas.md), e pela mesma razão: toda a RLS da loja é `auth_can_store(store_id)`. Um perfil `waiter` com sessão Supabase passava a ler o caixa, os pagamentos e os clientes da loja inteira (B-116).

- `waiters` guarda nome, telefone (9 dígitos), loja e se está activo. Um telefone só pode estar num garçom activo.
- `waiter_credentials` guarda o hash do PIN e as tentativas falhadas. Não tem policy nem grant: nem o gerente o lê.
- `waiter_sessions` guarda o sha256 de um token aleatório, válido 30 dias, num cookie httpOnly (`garcom_sessao`).
- Entrar: telefone + PIN → [`POST /api/garcom/login`](../../apps/web/app/api/garcom/login/route.ts) → `waiter_login`. As esperas por PIN errado seguem a regra do PIN do POS.
- Tudo o resto passa por [`/api/garcom`](../../apps/web/app/api/garcom/route.ts) e [`/api/garcom/cardapio`](../../apps/web/app/api/garcom/cardapio/route.ts), com a service key, chamando as RPCs `waiter_*` (só `service_role`, validam o token antes de tudo).
- Trocar o PIN ou desactivar o garçom fecha as sessões abertas.

## No telemóvel

1. **Mesas**: grelha das mesas da loja dele (livre, ocupada com o nome ou total, minutos, rascunho por enviar). Em cima ficam os pedidos **prontos para servir**, e o telemóvel vibra quando aparece um novo. Actualiza a cada 15 s.
2. **Mesa**: os pedidos da conta aberta, com quem os lançou (QR, Balcão ou o nome do garçom), o estado e o total. Tem o botão "Servido" (dois toques), que faz `MARK_READY` quando é preciso e depois `DELIVER`.
3. **Novo pedido**: cardápio da loja (`get_menu` sem esgotados: o alargado exige sessão da equipa), pesquisa e categorias. Variante, extras e nota escolhem-se de uma vez. O carrinho é o do POS ([`lib/pos/cart.ts`](../../apps/web/lib/pos/cart.ts)): mesma linha, mesmo preço, mesmo payload.
4. **Enviar**: `waiter_launch_order` com `clientSaleId`. O rascunho fica guardado no telemóvel por mesa ([`lib/garcom/pedido.ts`](../../apps/web/lib/garcom/pedido.ts)). Se o envio fica sem resposta, o rascunho fica **pendente**: não se edita e só se reenvia com a mesma chave. Se o pedido já tinha chegado, a BD devolve o mesmo pedido (`duplicate: true`). Uma recusa da BD (409) prova que nada foi gravado, e aí o pedido pode ser corrigido.

## No balcão e na cozinha

- A comanda leva "Garçom: Nome" nas observações (`build_table_comanda`). É um campo que qualquer bridge já imprime, por isso não é preciso trocar o `.exe`. `orders.notes` não muda.
- `orders.waiter_id` regista quem lançou. `pos_table_overview` devolve `waiter_name`, e o separador Mesas do POS mostra "GARÇOM ANA" em vez de "BALCÃO".
- Eventos: `table.order_launched` (com `source: 'waiter'`), `table.order_served`, `waiter.login`, `waiter.login_failed`, `waiter.saved`, `waiter.pin_set`.

## O mini POS (1127)

| No telemóvel | Regra |
|---|---|
| **Retirar artigo** | Só nos pedidos dele, ainda "Na cozinha", dentro de `stores.waiter_remove_minutes` (3 min de fábrica, 0 desliga). Motivo obrigatório. Sai o papel "ANULAR" na cozinha, o total desce e o stock volta. Depois do limite, é no POS |
| **Cobrar** | Só com `waiters.can_charge`, desligado de fábrica. M-Pesa, e-Mola ou cartão, entre os que a loja tem ligados. **Dinheiro em notas continua no balcão**: não há registo de "o garçom entregou X ao caixa", e sem isso a gaveta fechava a faltar sem se saber a quem pedir. Registar M-Pesa não fala com a operadora: o garçom confirma que entrou |
| **Pedir a conta** | Mostra as linhas e imprime no balcão com o total. Não fecha nada |
| **Mudar de mesa** | Leva a conta inteira. Se a mesa de destino estiver ocupada, as contas juntam-se. A cozinha recebe "MUDOU DE MESA" |
| **Reimprimir** | A comanda sai na cozinha com REIMPRESSÃO nas observações, e fica em `event_log` |
| **Esgotados** | Marca e desmarca na loja dele. Vale para o POS, o site e os outros telemóveis. Fica em `event_log` com `role: 'waiter'` |
| **Notas rápidas** | As da loja, as mesmas do POS |
| **Os meus pedidos** | Hoje, 7 ou 30 dias, com o que foi retirado e porquê |

`close_table_bill` e `remove_table_item` têm o corpo em `private.close_table_bill_core` e `private.remove_table_item_core`, usados também por `waiter_close_bill` e `waiter_remove_item`: a repartição de pagamentos, o stock e o papel são uma conta só. Quem cobrou fica em `table_bills.waiter_id`, com `closed_by` e `device_id` a null. Uma conta cobrada por um garçom sem turno aberto abre o turno sozinha, como as contas do POS.

O telemóvel não dá desconto nem cria venda sem mesa: desconto manual é de gerente (1113), e venda sem mesa exige pagamento na hora.

## O módulo no painel

A aba **Garçons** (`/garcons`, gerente e dono) tem dois separadores: **Desempenho** e **Equipa**.

**Desempenho** ([garcons-desempenho.tsx](../../apps/web/app/(admin)/garcons-desempenho.tsx)) lê tudo de `get_waiter_metrics(p_store_id, p_from, p_to, p_waiter_id)` (1123). Filtra por loja e período (hoje, 7 dias, 30 dias, este mês, tudo). "Todas as lojas" é só do dono. Tocar num garçom filtra os cartões, os gráficos e os artigos por ele.

| Número | O que quer dizer |
|---|---|
| Pedidos, vendas, ticket médio | Pedidos lançados pelo garçom em preparo, prontos ou entregues. O cancelado não é venda e conta à parte. `total_cents` já desce quando se retira um artigo |
| Artigos, artigos por pedido | Quantidades das linhas desses pedidos |
| Mesas | Mesas diferentes por dia: a mesa 5 de ontem e a de hoje são duas |
| Extras | O que os extras somaram, ao preço gravado na linha |
| Servidos | Quem levou à mesa (`table.order_served`), mesmo que outro tenha lançado |
| Até servir | Mediana entre lançar e entregar. Só há valor quando alguém marca entregue |
| Por cobrar | Vendas sem `table_bill_id`. É a conta da mesa, não dinheiro na mão do garçom |
| Retirados | Artigos retirados dos pedidos dele (`table.item_removed`), em número e valor |
| Dias | Dias de Maputo com pelo menos um pedido |

Os destaques de ticket médio e rapidez só contam a partir de 5 pedidos, para um pedido caro não fazer um campeão ([metricas.ts](../../apps/web/lib/garcom/metricas.ts)). O painel "De onde vêm os pedidos de mesa" compara garçons, balcão e QR em toda a sala.

As comparações com o período anterior usam uma janela do mesmo tamanho, imediatamente antes.

Ao tocar num garçom aparece o **histórico**: `get_waiter_orders`, 20 pedidos por página, com artigos, estado, como foi paga, quem cobrou e o que foi retirado, com o motivo e onde.

## Gestão

No painel, em **Garçons → Equipa** ([garcons-equipa.tsx](../../apps/web/app/(admin)/garcons-equipa.tsx)), o dono ou o gerente da loja cria o garçom (nome, telefone, PIN), troca o PIN, edita, desactiva, autoriza a cobrar e define o limite para retirar. `get_waiters` mostra também quantos pedidos cada um lançou hoje e o valor.

## Limites

- Precisa de rede: a conta da mesa vive no servidor, como no POS. Sem rede, o rascunho fica no telemóvel e envia-se quando a rede voltar.
- Dinheiro em notas, desconto e venda sem mesa continuam no POS.

## Testes

- BD: [`garcons.test.ts`](../../packages/db/tests/garcons.test.ts) cobre quem gere, as RPCs fechadas à `anon` e à equipa, PIN errado e bloqueio, isolamento Maputo/Matola, preço da loja, stock, papel com o nome do garçom, envio repetido, chave de outro garçom, esgotado recusado, Servido e revogação de sessões.
- Métricas: [`garcons-metricas.test.ts`](../../packages/db/tests/garcons-metricas.test.ts) cobre quem lê, o isolamento entre lojas, cancelados, extras, servidos, retirados, pago e por cobrar, período e fuso de Maputo.
- Mini POS: [`garcons-mini-pos.test.ts`](../../packages/db/tests/garcons-mini-pos.test.ts) cobre retirar, cobrar, mudar de mesa, papel, esgotados e histórico, incluindo os limites, o dinheiro recusado, a repetição e o POS a funcionar como antes.
- Puros: [`lib/garcom/__tests__`](../../apps/web/lib/garcom/__tests__/garcom.test.ts) cobre a linha igual à do POS, o rascunho, "recusado vs incerto", os prontos e o contrato da rota.
