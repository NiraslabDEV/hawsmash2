-- Campanha automática para lojas online com catálogo simples (sem opções).
-- Não activa campanhas nem altera preços ao instalar. Activação explícita pelo dono.
create table if not exists public.store_campaigns (
  id uuid primary key,
  store_id uuid not null references public.stores(id),
  increase_bps integer not null check(increase_bps between 0 and 10000),
  discount_bps integer not null check(discount_bps between 1 and 9999),
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  title text not null check(length(title) between 1 and 180),
  banner_url text not null,
  actor_user_id uuid not null references auth.users(id),
  check(ends_at > starts_at)
);
create index if not exists store_campaigns_period_idx on public.store_campaigns(store_id,ends_at);
alter table public.store_campaigns enable row level security;
revoke all on public.store_campaigns from public,anon,authenticated;
grant select on public.store_campaigns to authenticated;
drop policy if exists campaign_store_read on public.store_campaigns;
create policy campaign_store_read on public.store_campaigns for select to authenticated
  using(private.auth_can_store(store_id));

create or replace function private.campaign_discount(p_cents integer,p_bps integer)
returns integer language plpgsql immutable security invoker set search_path='' as $$
begin
  if p_cents is null or p_cents<0 or p_bps is null or p_bps not between 0 and 10000 then
    raise exception 'invalid_campaign_price';
  end if;
  return ((p_cents::bigint*(10000-p_bps)+5000)/10000)::integer;
end;
$$;
revoke all on function private.campaign_discount(integer,integer) from public,anon,authenticated;

-- DECISÃO: a primeira versão é online e sem variantes/adicionais. Não promete
-- desconto em caminhos ainda não integrados. A activação recusa esse catálogo;
-- uma mudança posterior suspende a campanha inteira, incluindo o banner.
create or replace function private.campaign_catalog_supported(p_store uuid)
returns boolean language sql stable security invoker set search_path='' as $$
  select exists(select 1 from public.stores where id=p_store and not counter_enabled)
    and not exists(
      select 1 from public.store_items si join public.menu_items mi on mi.id=si.menu_item_id
      where si.store_id=p_store and si.available and mi.available and (
        mi.is_gift or exists(select 1 from public.menu_item_variants v where v.menu_item_id=mi.id and v.active)
        or exists(select 1 from public.menu_addons a where a.menu_item_id=mi.id and a.active)
        or exists(select 1 from public.menu_modifier_groups g where g.menu_item_id=mi.id and g.active)
      )
    );
$$;
revoke all on function private.campaign_catalog_supported(uuid) from public,anon,authenticated;

create or replace function private.active_store_campaign(p_store uuid)
returns public.store_campaigns language sql stable security invoker set search_path='' as $$
  select c from public.store_campaigns c where c.store_id=p_store
    and c.starts_at<=now() and c.ends_at>now()
    and private.campaign_catalog_supported(p_store)
  order by c.starts_at desc limit 1;
$$;
revoke all on function private.active_store_campaign(uuid) from public,anon,authenticated;

create or replace function public.start_store_campaign(
  p_store_id uuid,p_id uuid,p_increase_bps integer,p_discount_bps integer,
  p_ends_at timestamptz,p_title text,p_banner_url text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_old public.store_campaigns; v_prices jsonb;
begin
  if auth.uid() is null or not private.auth_is_owner() or not private.auth_can_store(p_store_id) then
    raise exception 'campaign_requires_owner' using errcode='42501';
  end if;
  perform 1 from public.stores where id=p_store_id and active for update;
  if not found then raise exception 'store_not_found'; end if;
  select * into v_old from public.store_campaigns where id=p_id;
  if found then
    if v_old.store_id<>p_store_id or v_old.increase_bps<>p_increase_bps or v_old.discount_bps<>p_discount_bps
      or v_old.ends_at<>p_ends_at or v_old.title<>p_title or v_old.banner_url<>p_banner_url then
      raise exception 'campaign_id_conflict';
    end if;
    return jsonb_build_object('id',v_old.id,'ends_at',v_old.ends_at);
  end if;
  if p_id is null or p_increase_bps is null or p_increase_bps not between 0 and 10000
    or p_discount_bps is null or p_discount_bps not between 1 and 9999
    or p_ends_at is null or p_ends_at<=now() or p_title is null or length(btrim(p_title)) not between 1 and 180
    or p_banner_url is null or p_banner_url !~ '^/assets/[a-zA-Z0-9/_-]+\.(png|webp|jpg)$' then
    raise exception 'invalid_campaign';
  end if;
  if exists(select 1 from public.store_campaigns where store_id=p_store_id and ends_at>now()) then
    raise exception 'campaign_already_active';
  end if;
  if not private.campaign_catalog_supported(p_store_id) then raise exception 'campaign_requires_simple_online_catalog'; end if;
  perform 1 from public.store_items where store_id=p_store_id for update;
  -- Guarda a tabela anterior para auditoria; o novo preço fica no override da loja.
  select jsonb_agg(jsonb_build_object('item_id',mi.id,'before_cents',coalesce(si.price_cents_override,mi.price_cents),
    'list_cents',((coalesce(si.price_cents_override,mi.price_cents)::bigint*(10000+p_increase_bps)+5000)/10000)::integer))
    into v_prices from public.store_items si join public.menu_items mi on mi.id=si.menu_item_id where si.store_id=p_store_id;
  update public.store_items si set price_cents_override=
    ((coalesce(si.price_cents_override,mi.price_cents)::bigint*(10000+p_increase_bps)+5000)/10000)::integer
    from public.menu_items mi where mi.id=si.menu_item_id and si.store_id=p_store_id;
  insert into public.store_campaigns(id,store_id,increase_bps,discount_bps,ends_at,title,banner_url,actor_user_id)
    values(p_id,p_store_id,p_increase_bps,p_discount_bps,p_ends_at,p_title,p_banner_url,auth.uid());
  insert into public.event_log(store_id,actor_user_id,type,payload)
    values(p_store_id,auth.uid(),'campaign.started',jsonb_build_object('id',p_id,'prices',v_prices,
      'discount_bps',p_discount_bps,'ends_at',p_ends_at));
  return jsonb_build_object('id',p_id,'ends_at',p_ends_at);
end;
$$;
revoke all on function public.start_store_campaign(uuid,uuid,integer,integer,timestamptz,text,text) from public,anon;
grant execute on function public.start_store_campaign(uuid,uuid,integer,integer,timestamptz,text,text) to authenticated;

do $$
begin
  if to_regprocedure('private.get_menu_before_campaign(text,text,boolean)') is null then
    alter function public.get_menu(text,text,boolean) set schema private;
    alter function private.get_menu(text,text,boolean) rename to get_menu_before_campaign;
    revoke all on function private.get_menu_before_campaign(text,text,boolean) from public,anon,authenticated;
  end if;
  if to_regprocedure('private.create_order_store_before_campaign(text,jsonb)') is null then
    alter function private.create_order_store_legacy(text,jsonb) rename to create_order_store_before_campaign;
    revoke all on function private.create_order_store_before_campaign(text,jsonb) from public,anon,authenticated;
  end if;
end;
$$;

create or replace function public.get_menu(p_store_slug text,p_channel text default null,p_include_unavailable boolean default false)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_menu jsonb; v_store uuid; v_campaign public.store_campaigns; v_categories jsonb:='[]';
  v_category jsonb; v_item jsonb; v_items jsonb;
begin
  v_menu:=private.get_menu_before_campaign(p_store_slug,p_channel,p_include_unavailable);
  select id into v_store from public.stores where slug=p_store_slug and active;
  v_campaign:=private.active_store_campaign(v_store);
  if v_campaign.id is null then return v_menu||jsonb_build_object('campaign',null); end if;
  for v_category in select value from jsonb_array_elements(v_menu->'categories') loop
    v_items:='[]';
    for v_item in select value from jsonb_array_elements(v_category->'items') loop
      v_items:=v_items||jsonb_build_array(v_item||jsonb_build_object(
        'list_price_cents',(v_item->>'price_cents')::integer,
        'price_cents',private.campaign_discount((v_item->>'price_cents')::integer,v_campaign.discount_bps)));
    end loop;
    v_categories:=v_categories||jsonb_build_array(v_category||jsonb_build_object('items',v_items));
  end loop;
  return v_menu||jsonb_build_object('categories',v_categories,'campaign',jsonb_build_object(
    'id',v_campaign.id,'discount_bps',v_campaign.discount_bps,'starts_at',v_campaign.starts_at,
    'ends_at',v_campaign.ends_at,'title',v_campaign.title,'banner_url',v_campaign.banner_url));
end;
$$;
revoke all on function public.get_menu(text,text,boolean) from public;
grant execute on function public.get_menu(text,text,boolean) to anon,authenticated,service_role;

create or replace function private.create_order_store_legacy(p_store_slug text,p_payload jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_store uuid; v_campaign public.store_campaigns; v_order uuid; v_subtotal integer;
begin
  select id into v_store from public.stores where slug=p_store_slug and active;
  v_campaign:=private.active_store_campaign(v_store);
  -- DECISÃO: campanha automática não acumula com cupões. A montra avisa disso.
  v_order:=private.create_order_store_before_campaign(p_store_slug,
    case when v_campaign.id is not null then p_payload-'referralCode' else p_payload end);
  if v_campaign.id is null then return v_order; end if;
  update public.order_items set unit_price_cents=private.campaign_discount(unit_price_cents,v_campaign.discount_bps)
    where order_id=v_order and store_id=v_store;
  select sum(unit_price_cents::bigint*qty)::integer into v_subtotal from public.order_items where order_id=v_order and store_id=v_store;
  update public.orders set subtotal_cents=v_subtotal,discount_cents=0,total_cents=v_subtotal+delivery_fee_cents
    where id=v_order and store_id=v_store;
  update public.event_log set payload=payload||jsonb_build_object('campaign_id',v_campaign.id,
    'total_cents',(select total_cents from public.orders where id=v_order and store_id=v_store))
    where order_id=v_order and store_id=v_store and type='order.created';
  return v_order;
end;
$$;
revoke all on function private.create_order_store_legacy(text,jsonb) from public,anon,authenticated;
