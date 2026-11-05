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

## Gestão

No painel, em **Mesas → Garçons** ([garcons-section.tsx](../../apps/web/app/(admin)/garcons-section.tsx)), o dono ou o gerente da loja cria o garçom (nome, telefone, PIN), troca o PIN, edita e desactiva. `get_waiters` mostra também quantos pedidos cada um lançou hoje e o valor.

## Limites

- Precisa de rede: a conta da mesa vive no servidor, como no POS. Sem rede, o rascunho fica no telemóvel e envia-se quando a rede voltar.
- O telemóvel não retira artigos nem cobra. Retirar é `remove_table_item` no POS, e cobrar é `close_table_bill`.
- As notas rápidas do POS (`store_pos_settings`) exigem sessão da equipa. No telemóvel a nota escreve-se à mão.

## Testes

- BD: [`garcons.test.ts`](../../packages/db/tests/garcons.test.ts) cobre quem gere, as RPCs fechadas à `anon` e à equipa, PIN errado e bloqueio, isolamento Maputo/Matola, preço da loja, stock, papel com o nome do garçom, envio repetido, chave de outro garçom, esgotado recusado, Servido e revogação de sessões.
- Puros: [`lib/garcom/__tests__`](../../apps/web/lib/garcom/__tests__/garcom.test.ts) cobre a linha igual à do POS, o rascunho, "recusado vs incerto", os prontos e o contrato da rota.
