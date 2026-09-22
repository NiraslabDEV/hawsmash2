-- HAWSMASH 2.0 — 1050: o alerta automático passa a chegar ao cron.
--
-- O §11.5 promete que o sistema avisa sozinho — é isso que substitui o
-- telefonema das 20h de sábado. Não avisava. O cron de `/api/cron/alerts` corre
-- com a chave de serviço e sem sessão, e a `list_system_alerts()` começa por
-- exigir `auth.uid()`: respondia `not_authenticated` (P0020) em todas as
-- corridas. Mesmo que passasse essa porta, os cinco ramos filtram por
-- `private.auth_can_store()`, que é falso sem uid — a consulta viria sempre
-- vazia. Resultado medido: uma bridge esteve 20 dias calada sem um único email.
--
-- A correcção não alarga o que a equipa vê. O corpo da consulta desce para
-- `private.system_alerts(p_todas)`; o painel continua a chamar a função de
-- sempre, com sessão e filtrada por loja (regra 3); o cron ganha uma porta
-- própria, que a fechadura do grant abre só ao service_role.

create or replace function private.system_alerts(p_todas boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return coalesce(
    (
      select jsonb_agg(entry order by entry.severity, entry.store_name, entry.kind)
      from (
        -- Dispositivo calado há mais de 5 minutos.
        select
          d.store_id,
          s.short_name as store_name,
          'device_silent' as kind,
          'critical' as severity,
          d.label || ' sem sinal desde ' ||
            coalesce(to_char(d.last_seen_at at time zone 'Africa/Maputo', 'DD/MM HH24:MI'), 'sempre')
            as message,
          jsonb_build_object('device_id', d.id, 'kind', d.kind, 'last_seen_at', d.last_seen_at) as details
        from public.devices d
        join public.stores s on s.id = d.store_id
        where d.active
          and (p_todas or private.auth_can_store(d.store_id))
          and (d.last_seen_at is null or d.last_seen_at < now() - interval '5 minutes')

        union all

        -- Papel que falhou depois das tentativas do bridge.
        select
          pj.store_id,
          s.short_name,
          'print_failed',
          'critical',
          count(*)::text || ' trabalho(s) de impressão falhado(s)',
          jsonb_build_object('failed', count(*))
        from public.print_jobs pj
        join public.stores s on s.id = pj.store_id
        where pj.status = 'failed'
          and (p_todas or private.auth_can_store(pj.store_id))
          and pj.created_at > now() - interval '24 hours'
        group by pj.store_id, s.short_name

        union all

        -- Pedido pago sem comanda impressa há mais de 2 minutos.
        select
          o.store_id,
          s.short_name,
          'order_not_printed',
          'critical',
          'Pedido ' || o.order_number || ' pago sem comanda impressa',
          jsonb_build_object('order_id', o.id, 'order_number', o.order_number)
        from public.orders o
        join public.stores s on s.id = o.store_id
        where o.status in ('paid', 'approved')
          and (p_todas or private.auth_can_store(o.store_id))
          and o.created_at > now() - interval '6 hours'
          and o.created_at < now() - interval '2 minutes'
          and not exists (
            select 1 from public.print_jobs pj
            where pj.order_id = o.id
              and pj.kind = 'order'
              and pj.status = 'printed'
          )

        union all

        -- Estoque esgotado ou abaixo do mínimo.
        select
          si.store_id,
          s.short_name,
          'stock',
          case
            when private.stock_level(si.track_stock, si.stock_qty, si.low_stock_qty) = 'out'
              then 'critical'
            else 'warning'
          end,
          mi.name || ' com ' || si.stock_qty::text || ' unidade(s)',
          jsonb_build_object('menu_item_id', si.menu_item_id, 'stock_qty', si.stock_qty)
        from public.store_items si
        join public.stores s on s.id = si.store_id
        join public.menu_items mi on mi.id = si.menu_item_id
        where si.track_stock
          and (p_todas or private.auth_can_store(si.store_id))
          and private.stock_level(si.track_stock, si.stock_qty, si.low_stock_qty) <> 'ok'

        union all

        -- Loja sem qualquer venda há mais de 90 minutos dentro do horário.
        select
          s.id,
          s.short_name,
          'no_sales',
          'warning',
          'Sem vendas há mais de 90 minutos em horário de loja',
          jsonb_build_object(
            'last_order_at',
            (select max(o.created_at) from public.orders o where o.store_id = s.id)
          )
        from public.stores s
        where s.active
          and s.accepting_orders
          and (p_todas or private.auth_can_store(s.id))
          and exists (
            select 1 from public.store_hours h
            where h.store_id = s.id
              and h.active
              and h.dow = extract(dow from (now() at time zone 'Africa/Maputo'))::smallint
              and (now() at time zone 'Africa/Maputo')::time >= h.opens
              and (now() at time zone 'Africa/Maputo')::time < h.closes
          )
          and coalesce(
            (select max(o.created_at) from public.orders o where o.store_id = s.id),
            'epoch'::timestamptz
          ) < now() - interval '90 minutes'
      ) entry
    ),
    '[]'::jsonb
  );
end;
$$;

revoke all on function private.system_alerts(boolean)
  from public, anon, authenticated;

-- O painel Sistema: sem sessão não responde, e com sessão mostra só as lojas de
-- quem entrou. Contrato inalterado — o teste de integração volta a prová-lo.
create or replace function public.list_system_alerts()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated' using errcode = 'P0020';
  end if;

  return private.system_alerts(false);
end;
$$;

revoke all on function public.list_system_alerts() from public, anon;
grant execute on function public.list_system_alerts() to authenticated, service_role;

-- O cron: vê a empresa inteira porque é ele que decide a que dono manda cada
-- aviso. Quem lhe pode bater à porta é só o service_role, e é o grant que o
-- garante — nunca um campo do corpo do pedido.
create or replace function public.list_system_alerts_all()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return private.system_alerts(true);
end;
$$;

revoke all on function public.list_system_alerts_all()
  from public, anon, authenticated;
grant execute on function public.list_system_alerts_all() to service_role;
