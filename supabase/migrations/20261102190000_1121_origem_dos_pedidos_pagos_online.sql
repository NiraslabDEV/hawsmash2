-- 1121: a origem dos pedidos pagos por M-Pesa/e-Mola automático, para trás.
--
-- Sintoma (02/11): Análise → Aquisição punha os 394 pedidos online de
-- Outubro em "Directo"; Redes sociais e Google com sessões e zero pedidos.
--
-- Causa: /api/payments (pagamento automático) criava o pedido sem chamar
-- record_order_attribution — só o fluxo do comprovativo (/api/create-order)
-- o fazia. Sem linha em order_attribution, o relatório assume "Directo".
-- O código passa a gravar nas duas rotas (lib/server-analytics/order-attribution.ts).
--
-- Para trás: o evento `purchase` que o browser envia ao ver o pedido leva o
-- order_id e a origem que o servidor selou nos cookies — o mesmo último
-- toque que record_order_attribution teria gravado. Só se ACRESCENTA a linha
-- que falta (on conflict do nothing); nenhuma atribuição existente muda.
-- O primeiro toque não está no evento: fica nulo e o relatório de descoberta
-- usa o último, como já faz. Linhas repostas reconhecem-se pelo created_at
-- (o da migration, não o do pedido) e pelo user_agent nulo.
--
-- Pedidos sem evento `purchase` do browser (cliente fechou antes da página
-- do pedido) continuam sem origem: não há de onde a tirar.

insert into public.order_attribution (
  order_id, store_id, session_id, channel, source, medium, campaign
)
select distinct on (o.id)
  o.id,
  o.store_id,
  e.session_id,
  coalesce(nullif(left(e.channel, 40), ''), 'direct'),
  coalesce(nullif(left(e.source, 120), ''), 'direto'),
  coalesce(nullif(left(e.medium, 120), ''), '(nenhum)'),
  nullif(left(e.campaign, 200), '')
from public.orders o
join public.analytics_events e
  on e.type = 'purchase'
 and private.try_uuid(coalesce(e.payload->>'order_id', e.payload->>'orderId')) = o.id
 -- server_<id> é o purchase do webhook: copia order_attribution, não o cliente.
 and e.session_id not like 'server\_%'
 and e.session_id <> 'unknown'
where not private.is_pos_order(o.channel, o.client_sale_id)
  and not exists (select 1 from public.order_attribution a where a.order_id = o.id)
order by o.id, e.created_at, e.id
on conflict (order_id) do nothing;
