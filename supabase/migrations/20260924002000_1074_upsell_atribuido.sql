-- 1074: atribuição observacional de upsell. Nunca altera preços nem bloqueia vendas.
create table if not exists public.order_upsells (
  order_item_id uuid primary key references public.order_items(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  store_id uuid not null references public.stores(id),
  kind text not null check (kind in ('companion','upgrade')),
  placement text not null,
  qty integer not null check(qty > 0),
  baseline_unit_cents integer not null default 0 check(baseline_unit_cents >= 0),
  created_at timestamptz not null default now()
);
alter table public.order_upsells enable row level security;
drop policy if exists order_upsells_read on public.order_upsells;
create policy order_upsells_read on public.order_upsells for select to authenticated
using (private.auth_role() in ('owner','manager') and private.auth_can_store(store_id));
revoke all on public.order_upsells from public,anon,authenticated;
grant select on public.order_upsells to authenticated;
create index if not exists order_upsells_store_idx on public.order_upsells(store_id,created_at);

-- Uma captura por pedido, inclusive quando não há upsell: retries não reatribuem vendas.
create table if not exists private.order_upsell_captures (
  order_id uuid primary key references public.orders(id) on delete cascade,
  store_id uuid not null references public.stores(id),
  created_at timestamptz not null default now()
);
alter table private.order_upsell_captures enable row level security;
revoke all on private.order_upsell_captures from public,anon,authenticated;

create or replace function private.record_order_upsells(p_order_id uuid,p_payload jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare item jsonb; mark jsonb; line public.order_items%rowtype;
  variant_name text; baseline integer; target_price integer; matches integer; claimed uuid; discount_bps integer;
begin
  insert into private.order_upsell_captures(order_id,store_id)
  select id,store_id from public.orders where id=p_order_id
  on conflict(order_id) do nothing returning order_id into claimed;
  if claimed is null then return; end if;
  for item in select value from jsonb_array_elements(p_payload->'items') loop
    begin
      mark := item->'upsell';
      if mark is null or mark->>'kind' not in ('companion','upgrade') then continue; end if;
      variant_name := null;
      if nullif(item->>'variantId','') is not null then
        select v.name,v.price_cents into variant_name,target_price from public.menu_item_variants v
        where v.id=(item->>'variantId')::uuid and v.menu_item_id=(item->>'menuItemId')::uuid;
        if not found then continue; end if;
      end if;
      -- Não adivinhar qual linha recebeu a oferta quando há escolhas ambíguas.
      select count(*) into matches from public.order_items oi
      where oi.order_id=p_order_id and oi.menu_item_id=(item->>'menuItemId')::uuid
        and oi.variant_name_snapshot is not distinct from variant_name
        and coalesce(oi.notes,'')=coalesce(item->>'notes','');
      if matches <> 1 then continue; end if;
      select oi.* into line from public.order_items oi
      where oi.order_id=p_order_id and oi.menu_item_id=(item->>'menuItemId')::uuid
        and oi.variant_name_snapshot is not distinct from variant_name
        and coalesce(oi.notes,'')=coalesce(item->>'notes','');
      baseline := 0;
      if mark->>'kind'='upgrade' then
        select v.price_cents into baseline from public.menu_item_variants v
        where v.id=(mark->>'fromVariantId')::uuid and v.menu_item_id=line.menu_item_id;
        if baseline is null or target_price is null or baseline >= target_price then continue; end if;
        -- Campanha automática já foi aplicada às linhas pela criação do pedido.
        select sc.discount_bps into discount_bps
        from public.event_log el join public.store_campaigns sc on sc.id::text=el.payload->>'campaign_id'
        where el.order_id=p_order_id and el.store_id=line.store_id and el.type='order.created' limit 1;
        if discount_bps is not null then
          baseline := private.campaign_discount(baseline,discount_bps);
          target_price := private.campaign_discount(target_price,discount_bps);
        end if;
        -- Mantém os adicionais/modificadores já escolhidos fora do incremento.
        baseline := greatest(0,line.unit_price_cents-(target_price-baseline));
      end if;
      insert into public.order_upsells(order_item_id,order_id,store_id,kind,placement,qty,baseline_unit_cents)
      values(line.id,line.order_id,line.store_id,mark->>'kind',left(coalesce(mark->>'placement','unknown'),60),
        least(line.qty,greatest(0,(mark->>'qty')::integer)),baseline)
      on conflict(order_item_id) do nothing;
    exception when others then
      -- DECISÃO: perder telemetria é preferível a perder a venda; sem PII no aviso.
      raise warning 'upsell_tracking_failed: %',sqlstate;
    end;
  end loop;
end $$;
revoke all on function private.record_order_upsells(uuid,jsonb) from public,anon,authenticated;

-- Wrappers idempotentes: os contratos e guardas originais continuam intactos.
do $$ begin
  if to_regprocedure('private.create_order_before_upsell(text,jsonb)') is null then
    alter function public.create_order(text,jsonb) set schema private;
    alter function private.create_order(text,jsonb) rename to create_order_before_upsell;
  end if;
  if to_regprocedure('private.create_counter_sale_before_upsell(jsonb)') is null then
    alter function public.create_counter_sale(jsonb) set schema private;
    alter function private.create_counter_sale(jsonb) rename to create_counter_sale_before_upsell;
  end if;
end $$;
revoke all on function private.create_order_before_upsell(text,jsonb) from public,anon,authenticated;
revoke all on function private.create_counter_sale_before_upsell(jsonb) from public,anon,authenticated;
create or replace function public.create_order(p_store_slug text,p_payload jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
  result := private.create_order_before_upsell(p_store_slug,p_payload);
  begin perform private.record_order_upsells(result,p_payload);
  exception when others then raise warning 'upsell_tracking_failed: %',sqlstate; end;
  return result;
end $$;
revoke all on function public.create_order(text,jsonb) from public;
grant execute on function public.create_order(text,jsonb) to anon,authenticated,service_role;
create or replace function public.create_counter_sale(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  result := private.create_counter_sale_before_upsell(p_payload);
  begin perform private.record_order_upsells((result->>'order_id')::uuid,p_payload);
  exception when others then raise warning 'upsell_tracking_failed: %',sqlstate; end;
  return result;
end $$;
revoke all on function public.create_counter_sale(jsonb) from public,anon;
grant execute on function public.create_counter_sale(jsonb) to authenticated;

create or replace function public.get_upsell_metrics(p_from timestamptz default null,p_to timestamptz default null,p_store_id uuid default null,p_origin text default 'all')
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated' using errcode='P0020'; end if;
  if coalesce(private.auth_role(),'') not in ('owner','manager') or
    (p_store_id is null and not private.auth_is_owner()) or
    (p_store_id is not null and not private.auth_can_store(p_store_id)) then
    raise exception 'upsell_access_denied' using errcode='P0403';
  end if;
  if p_origin is null or p_origin not in ('all','online','pos') or coalesce(p_to,now()) <= coalesce(p_from,now()-interval '30 days') then
    raise exception 'invalid_period_or_origin' using errcode='P0007'; end if;
  with lines as (
    select u.order_id,u.kind,u.placement,oi.menu_item_id,oi.name_snapshot,
      least(u.qty,oi.qty) as qty,
      -- Desconto repartido proporcionalmente, sem taxas de entrega.
      round(greatest(0,oi.unit_price_cents-u.baseline_unit_cents)::numeric*least(u.qty,oi.qty)
        * greatest(0,o.subtotal_cents-o.discount_cents)/nullif(o.subtotal_cents,0))::bigint as revenue,
      case when u.kind='companion' and oi.cost_cents is not null then
        round(oi.cost_cents::numeric*least(u.qty,oi.qty)/nullif(oi.qty,0))::bigint end as cost
    from public.order_upsells u join public.orders o on o.id=u.order_id
    join public.order_items oi on oi.id=u.order_item_id
    where o.status in ('paid','approved','in_preparation','ready','delivered')
      and o.created_at >= coalesce(p_from,now()-interval '30 days') and o.created_at < coalesce(p_to,now())
      and (p_store_id is null or o.store_id=p_store_id)
      and (p_origin='all' or (p_origin='pos')=private.is_pos_order(o.channel,o.client_sale_id))
  ), groups as (
    select menu_item_id,name_snapshot,kind,placement,sum(qty) as units,count(distinct order_id) as orders,
      sum(revenue) as revenue_cents,
      case when count(*) filter(where cost is null)=0 then sum(revenue-cost) end as margin_cents,
      count(*) filter(where cost is null) as lines_without_cost
    from lines group by menu_item_id,name_snapshot,kind,placement
  ), event_products as (
    select e.payload->>'item_id' as item_id,e.payload->>'placement' as placement,
      count(distinct coalesce(e.payload->>'context_id',e.session_id)) filter(where e.type='upsell_view') as views,
      count(distinct coalesce(e.payload->>'context_id',e.session_id)) filter(where e.type='upsell_accept') as accepts
    from public.analytics_events e
    where e.type in ('upsell_view','upsell_accept') and e.session_id is not null and e.session_id <> 'unknown'
      and e.created_at >= coalesce(p_from,now()-interval '30 days') and e.created_at < coalesce(p_to,now())
      and (p_store_id is null or e.store_id=p_store_id)
      and (p_origin='all' or coalesce(e.payload->>'origin','online')=p_origin)
    group by 1,2
  ), products as (
    select coalesce(g.menu_item_id,m.id) as menu_item_id,coalesce(g.name_snapshot,m.name) as name_snapshot,
      coalesce(g.kind,'companion') as kind,coalesce(g.placement,e.placement) as placement,
      coalesce(g.units,0) as units,coalesce(g.orders,0) as orders,coalesce(g.revenue_cents,0) as revenue_cents,
      g.margin_cents,coalesce(g.lines_without_cost,0) as lines_without_cost,coalesce(e.views,0) as views,coalesce(e.accepts,0) as accepts
    from groups g full join event_products e on e.item_id=g.menu_item_id::text and e.placement=g.placement
    left join public.menu_items m on m.id::text=e.item_id
    where g.menu_item_id is not null or m.id is not null
  ), events as (
    select e.type,count(distinct (coalesce(e.payload->>'context_id',e.session_id),e.payload->>'item_id',e.payload->>'placement')) as count
    from public.analytics_events e
    where e.type in ('upsell_view','upsell_accept') and e.session_id is not null and e.session_id <> 'unknown'
      and e.created_at >= coalesce(p_from,now()-interval '30 days') and e.created_at < coalesce(p_to,now())
      and (p_store_id is null or e.store_id=p_store_id)
      and (p_origin='all' or coalesce(e.payload->>'origin','online')=p_origin)
    group by e.type
  )
  select jsonb_build_object('orders',(select count(distinct order_id) from lines),
    'units',(select coalesce(sum(qty),0) from lines),
    'revenue_cents',(select coalesce(sum(revenue),0) from lines),
    'margin_cents',(select case when count(*) filter(where cost is null)=0 then coalesce(sum(revenue-cost),0) end from lines),
    'lines_without_cost',(select count(*) from lines where cost is null),
    'views',coalesce((select count from events where type='upsell_view'),0),
    'accepts',coalesce((select count from events where type='upsell_accept'),0),
    'products',coalesce((select jsonb_agg(to_jsonb(g) order by revenue_cents desc) from products g),'[]'::jsonb)) into result;
  return result;
end $$;
revoke all on function public.get_upsell_metrics(timestamptz,timestamptz,uuid,text) from public,anon;
grant execute on function public.get_upsell_metrics(timestamptz,timestamptz,uuid,text) to authenticated;
notify pgrst,'reload schema';
