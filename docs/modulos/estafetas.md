# Estafetas, entregas e conta-corrente

Desde a 1115 a entrega não acaba no balcão. A loja atribui um pedido de entrega a um estafeta. O estafeta usa o telemóvel para marcar que levantou e que entregou. A loja vê-o no mapa enquanto está de serviço, e cada entrega fica registada na conta dele.

## Identidade: o estafeta não é equipa

O estafeta **não tem conta Supabase** nem perfil em `staff_profiles`. Toda a RLS da loja é `auth_can_store(store_id)`: com uma sessão de equipa, um estafeta passava a ler pedidos, caixa e clientes da loja inteira. É o problema que a cozinha ainda tem (B-116).

- `couriers` guarda nome, telefone (9 dígitos, normalizado), loja, activo e de serviço. Um telefone só pode estar num estafeta activo.
- `courier_credentials` guarda o hash do PIN e as tentativas. Não tem policy nem grant à equipa: nem o gerente o lê.
- `courier_sessions` guarda o sha256 de um token aleatório, válido 30 dias. O token vai num cookie httpOnly (`estafeta_sessao`) e o JavaScript da página nunca o vê.
- Entrar em `/estafeta`: telefone + PIN → [`POST /api/estafeta/login`](../../apps/web/app/api/estafeta/login/route.ts) → `courier_login`. Os bloqueios por tentativas seguem a escada do PIN do POS: 5 erros dão 1 minuto, e o tempo duplica até 15.
- Tudo o resto passa por [`/api/estafeta`](../../apps/web/app/api/estafeta/route.ts). A rota usa a service key e chama as RPCs `courier_*`, que só o `service_role` executa e que validam o token antes de qualquer acção.
- Trocar o PIN ou desactivar o estafeta revoga as sessões abertas, por exemplo a de um telemóvel perdido.

## A entrega

`deliveries` tem uma linha por pedido, com o estado `assigned → picked_up → delivered`. **O pedido continua com os estados de sempre.** Num pedido de entrega, `delivered` já queria dizer "saiu da loja": é o botão "Enviar".

| Quem | Faz | Efeito |
|---|---|---|
| Balcão, gerente, dono | "🛵 Quem leva?" em Pedidos (`assign_courier`) | Cria ou troca a entrega. Só antes de ele levantar, só com estafeta da mesma loja, e só em pedidos aprovados/pagos/em preparo/prontos |
| Balcão, gerente, dono | Tirar o estafeta (`unassign_courier`) | Só antes de levantar. Fica `delivery.unassigned` no `event_log` |
| Estafeta | "Levantei o pedido" (`courier_pickup`) | Faz o que o "Enviar" fazia: `advance_order DELIVER`. Se a cozinha não marcou pronto, marca agora. Recusa pedidos ainda não começados (`order_not_ready`) ou cancelados |
| Estafeta | "Entregue ✓", com dois toques (`courier_deliver`) | Fecha a entrega, guarda onde o telemóvel estava e credita a taxa **uma só vez** |

Depois de entregue, o nome, o telefone e a morada do cliente deixam de aparecer no telemóvel. O cliente, no acompanhamento, vê "A caminho com <primeiro nome>" enquanto a entrega está `picked_up`. Esse dado vem do `get_order_status` (embrulhado na 1115).

## Dinheiro: conta-corrente

`courier_ledger` regista em centavos o que a loja deve ao estafeta: positivo = a loja passa a dever. A conta é idempotente: `(delivery_id, kind)` e `(store_id, request_id)` são únicos.

- **Taxa por entrega**: entra quando ele entrega. A regra é por loja: `stores.courier_fee_fixed_cents`, ou, se for null, `courier_fee_pct` da taxa de entrega do pedido. De fábrica é 100% (B-120). Só o dono a muda (`set_courier_pay`). O valor fica congelado em `deliveries.courier_fee_cents`.
- **Pagamento** (`courier_payout`, gerente/dono): em dinheiro sai da gaveta como `despesa` do turno aberto, na mesma transacção e com o mesmo `request_id`. Sem turno aberto, não regista nada. Por M-Pesa, e-Mola ou outro meio, fica só na conta-corrente.
- **Acerto** (`courier_adjust`, gerente/dono): um valor positivo ou negativo, com motivo obrigatório.
- O balcão vê o quadro e o mapa, mas não os saldos (`balance_cents` vem a null) nem a conta-corrente.

Os pedidos saem pagos (M-Pesa, e-Mola ou balcão), por isso o estafeta não cobra à porta e não há "dinheiro a devolver". Ver B-120.

## Localização

O telemóvel envia a posição com `watchPosition` só enquanto o estafeta está **de serviço**: a cada 15 s se andou 50 m, e sempre ao fim de 60 s ([`tracking.ts`](../../apps/web/lib/estafeta/tracking.ts)). `courier_positions` guarda só a **última** posição, sem percurso. Ao sair de serviço, a posição é apagada.

Limite de uma app web: o browser só envia a posição com a página aberta e o ecrã aceso (o ecrã fica aceso por Wake Lock durante o serviço). Com o telemóvel no bolso, noutra app ou bloqueado, a posição pára e o mapa mostra-a a cinzento ao fim de 5 minutos. Rastreio em segundo plano exige embrulhar a PWA numa app nativa (Capacitor), o que fica para depois.

O mapa do painel ([`/estafetas`](../../apps/web/app/(admin)/estafetas/page.tsx)) usa Leaflet + OpenStreetMap, sem chave de API, e actualiza-se a cada 15 s por polling.

## Testes

- BD: [`estafetas.test.ts`](../../packages/db/tests/estafetas.test.ts). Cobre login, token falso, RPCs fechadas à `anon` e à equipa, levantar/entregar com taxa única, um estafeta a mexer na entrega de outro, isolamento Maputo/Matola, saldo escondido do balcão, pagamento em dinheiro idempotente com despesa no caixa, posição só de serviço e o que o cliente vê.
- Puros: [`lib/estafeta/__tests__`](../../apps/web/lib/estafeta/__tests__/estafeta.test.ts).
