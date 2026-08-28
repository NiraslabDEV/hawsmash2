-- HAWSMASH 2.0 — 1024: estoque de matéria-prima com ficha técnica.
--
-- Até aqui o estoque era do PRODUTO FINAL (store_items.stock_qty de "Classic
-- Smash"). Isso não descreve a cozinha: o que acaba não é o Classic, é a carne
-- WAGYU — que é a mesma carne do Double e do Signature. E pior: o desconto
-- ignorava a variante, por isso um Classic HAW e um Classic WAGYU baixavam o
-- mesmo saldo.
--
-- A partir daqui existe uma camada de INGREDIENTES por loja e uma FICHA TÉCNICA
-- que diz quanto de cada ingrediente sai por produto — e, quando a variante
-- muda a carne, por (produto, variante). Cada venda desconta o que a cozinha
-- gastou, na mesma transacção, e grava o CUSTO da linha para que a margem seja
-- histórica e não se altere quando o custo do fornecedor mudar amanhã.
--
-- O estoque de produto final (store_items) CONTINUA a existir e a valer: serve
-- para o que se compra pronto e se vende como está (bebidas, natas). Os dois
-- convivem — um item pode ter ficha técnica, contagem própria, ou ambas.

-- ---------------------------------------------------------------------------
-- 1. Catálogo de ingredientes (da empresa) e a realidade de cada loja
-- ---------------------------------------------------------------------------
create table if not exists public.ingredients (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  -- Unidade de contagem. O HAWSMASH conta à unidade (carne, fatia, porção);
  -- 'g'/'ml' ficam disponíveis para quem contar a peso sem mudar o schema.
  unit text not null default 'un' check (unit in ('un', 'g', 'ml')),
  -- Custo de UMA unidade, em centavos. É a base do CMV.
  cost_cents integer not null default 0 check (cost_cents >= 0),
  active boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.store_ingredients (
  store_id uuid not null references public.stores(id) on delete cascade,
  ingredient_id uuid not null references public.ingredients(id) on delete cascade,
  -- track = false → conta para o custo, mas não trava a venda nem se conta.
  -- Nasce desligado, como o store_items: um ingrediente com qty 0 e track on
  -- fecharia os burgers todos ao primeiro pedido. Liga-se após a 1.ª contagem.
  track boolean not null default false,
  qty integer not null default 0 check (qty >= 0),
  low_qty integer not null default 0 check (low_qty >= 0),
  primary key (store_id, ingredient_id)
);

create table if not exists public.ingredient_movements (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  ingredient_id uuid not null references public.ingredients(id) on delete cascade,
  delta integer not null check (delta <> 0),
  qty_after integer not null check (qty_after >= 0),
  reason text not null check (reason in ('sale', 'void', 'manual', 'waste', 'receive', 'count')),
  order_id uuid references public.orders(id) on delete set null,
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists ingredient_movements_store_created_at_idx
  on public.ingredient_movements (store_id, created_at desc);
create index if not exists ingredient_movements_store_ing_created_at_idx
  on public.ingredient_movements (store_id, ingredient_id, created_at desc);
create index if not exists ingredient_movements_order_reason_idx
  on public.ingredient_movements (order_id, reason)
  where order_id is not null;

-- ---------------------------------------------------------------------------
-- 2. Ficha técnica
--
-- variant_id null  → a linha vale para TODAS as variantes do produto (o pão, o
--                    queijo, o molho: não mudam entre HAW e WAGYU).
-- variant_id X     → a linha vale só para essa variante (é aqui que a carne
--                    RAW deixa de ser confundida com a WAGYU).
-- O consumo de uma venda é a soma das duas.
-- ---------------------------------------------------------------------------
create table if not exists public.recipe_items (
  id uuid primary key default gen_random_uuid(),
  menu_item_id uuid not null references public.menu_items(id) on delete cascade,
  variant_id uuid references public.menu_item_variants(id) on delete cascade,
  ingredient_id uuid not null references public.ingredients(id) on delete restrict,
  qty integer not null check (qty > 0),
  created_at timestamptz not null default now()
);

-- Uma linha por (produto, variante, ingrediente). O uuid zero substitui o null
-- para que o índice único também trave duplicados na linha base.
create unique index if not exists recipe_items_unique_idx
  on public.recipe_items (
    menu_item_id,
    ingredient_id,
    coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );
create index if not exists recipe_items_ingredient_idx
  on public.recipe_items (ingredient_id);

-- A variante tem de pertencer ao produto da ficha. Sem isto, colar a variante
-- WAGYU do Classic à ficha do Double descontaria a carne errada em silêncio.
create or replace function private.recipe_variant_belongs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.variant_id is not null and not exists (
    select 1 from public.menu_item_variants mv
    where mv.id = new.variant_id
      and mv.menu_item_id = new.menu_item_id
  ) then
    raise exception 'variant_not_in_item' using errcode = 'P0015';
  end if;
  return new;
end;
$$;

drop trigger if exists recipe_items_variant_belongs on public.recipe_items;
create trigger recipe_items_variant_belongs
  before insert or update on public.recipe_items
  for each row execute function private.recipe_variant_belongs();

-- ---------------------------------------------------------------------------
-- 3. Preenchimento determinístico (mesma regra do store_items, CLAUDE §5.3):
--    ingrediente novo nasce em todas as lojas; loja nova nasce com todos os
--    ingredientes. "Linha em falta" nunca pode significar "talvez".
-- ---------------------------------------------------------------------------
create or replace function private.fanout_ingredient_to_stores()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.store_ingredients (store_id, ingredient_id)
  select s.id, new.id
  from public.stores s
  where s.active
  on conflict do nothing;
  return new;
end;
$$;

create or replace function private.fanout_store_to_ingredients()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.store_ingredients (store_id, ingredient_id)
  select new.id, i.id
  from public.ingredients i
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists ingredients_fanout on public.ingredients;
create trigger ingredients_fanout
  after insert on public.ingredients
  for each row execute function private.fanout_ingredient_to_stores();

drop trigger if exists stores_fanout_ingredients on public.stores;
create trigger stores_fanout_ingredients
  after insert on public.stores
  for each row execute function private.fanout_store_to_ingredients();

-- ---------------------------------------------------------------------------
-- 4. RLS: leitura por loja, escrita só pelas RPC SECURITY DEFINER
-- ---------------------------------------------------------------------------
alter table public.ingredients enable row level security;
alter table public.store_ingredients enable row level security;
alter table public.ingredient_movements enable row level security;
alter table public.recipe_items enable row level security;

drop policy if exists ingredients_select on public.ingredients;
create policy ingredients_select on public.ingredients
  for select to authenticated using (true);

drop policy if exists recipe_items_select on public.recipe_items;
create policy recipe_items_select on public.recipe_items
  for select to authenticated using (true);

drop policy if exists store_ingredients_select on public.store_ingredients;
create policy store_ingredients_select on public.store_ingredients
  for select to authenticated using (private.auth_can_store(store_id));

drop policy if exists ingredient_movements_select on public.ingredient_movements;
create policy ingredient_movements_select on public.ingredient_movements
  for select to authenticated using (private.auth_can_store(store_id));

revoke all on table public.ingredients from public, anon, authenticated;
revoke all on table public.store_ingredients from public, anon, authenticated;
revoke all on table public.ingredient_movements from public, anon, authenticated;
revoke all on table public.recipe_items from public, anon, authenticated;

grant select on table public.ingredients to authenticated;
grant select on table public.store_ingredients to authenticated;
grant select on table public.ingredient_movements to authenticated;
grant select on table public.recipe_items to authenticated;

grant select, insert, update, delete on table public.ingredients to service_role;
grant select, insert, update, delete on table public.store_ingredients to service_role;
grant select, insert, update, delete on table public.ingredient_movements to service_role;
grant select, insert, update, delete on table public.recipe_items to service_role;

-- ---------------------------------------------------------------------------
-- 5. Custo da venda: gravado na linha, no momento da venda.
--    Sem isto, mudar o custo da carne amanhã reescreveria a margem de ontem.
-- ---------------------------------------------------------------------------
alter table public.order_items
  add column if not exists cost_cents integer;

-- ---------------------------------------------------------------------------
-- 6. Livro de movimentos + alerta (espelha private.record_stock_movement)
-- ---------------------------------------------------------------------------
create or replace function private.record_ingredient_movement(
  p_store_id uuid,
  p_ingredient_id uuid,
  p_delta integer,
  p_reason text,
  p_order_id uuid default null,
  p_note text default null,
  p_qty_after integer default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_movement_id uuid;
  v_row record;
  v_qty_after integer := p_qty_after;
begin
  if p_delta = 0 then
    return null;
  end if;

  select si.qty, si.low_qty, si.track, i.name, i.unit
  into v_row
  from public.store_ingredients si
  join public.ingredients i on i.id = si.ingredient_id
  where si.store_id = p_store_id
    and si.ingredient_id = p_ingredient_id;

  if not found then
    raise exception 'store_ingredient_not_found' using errcode = 'P0404';
  end if;

  v_qty_after := coalesce(v_qty_after, v_row.qty);

  insert into public.ingredient_movements (
    store_id, ingredient_id, delta, qty_after, reason, order_id, note, created_by
  ) values (
    p_store_id,
    p_ingredient_id,
    p_delta,
    v_qty_after,
    p_reason,
    p_order_id,
    nullif(btrim(coalesce(p_note, '')), ''),
    (select auth.uid())
  )
  returning id into v_movement_id;

  -- Best-effort: o alerta nunca pode reverter a venda que o gerou.
  if p_delta < 0 and v_row.track then
    if v_qty_after = 0 then
      insert into public.event_log (order_id, store_id, actor_user_id, type, payload)
      values (
        p_order_id, p_store_id, (select auth.uid()), 'ingredient.out',
        jsonb_build_object(
          'ingredient_id', p_ingredient_id, 'ingredient_name', v_row.name,
          'unit', v_row.unit, 'qty', v_qty_after, 'low_qty', v_row.low_qty,
          'movement_id', v_movement_id, 'reason', p_reason
        )
      );
    elsif v_row.low_qty > 0 and v_qty_after <= v_row.low_qty then
      insert into public.event_log (order_id, store_id, actor_user_id, type, payload)
      values (
        p_order_id, p_store_id, (select auth.uid()), 'ingredient.low',
        jsonb_build_object(
          'ingredient_id', p_ingredient_id, 'ingredient_name', v_row.name,
          'unit', v_row.unit, 'qty', v_qty_after, 'low_qty', v_row.low_qty,
          'movement_id', v_movement_id, 'reason', p_reason
        )
      );
    end if;
  end if;

  return v_movement_id;
end;
$$;

revoke all on function private.record_ingredient_movement(uuid, uuid, integer, text, uuid, text, integer)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. O que um pedido gasta, segundo a ficha técnica.
--
-- A variante é resolvida pelo nome gravado na linha (order_items só guarda
-- variant_name_snapshot). O snapshot é do momento da venda, que é o momento em
-- que esta função corre — por isso a leitura é sempre a correcta.
-- ---------------------------------------------------------------------------
create or replace function private.order_ingredient_needs(p_order_id uuid)
returns table (ingredient_id uuid, qty integer, cost_cents bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select
    r.ingredient_id,
    sum(r.qty * oi.qty)::integer as qty,
    sum(r.qty * oi.qty * i.cost_cents)::bigint as cost_cents
  from public.order_items oi
  join public.recipe_items r
    on r.menu_item_id = oi.menu_item_id
  join public.ingredients i
    on i.id = r.ingredient_id
  left join public.menu_item_variants mv
    on mv.menu_item_id = oi.menu_item_id
   and mv.name = oi.variant_name_snapshot
  where oi.order_id = p_order_id
    and oi.menu_item_id is not null
    and (r.variant_id is null or r.variant_id = mv.id)
  group by r.ingredient_id;
$$;

revoke all on function private.order_ingredient_needs(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. Consumo na venda: desconta, regista e grava o custo da linha.
--
-- Idempotente pelo livro de movimentos (repetir não desconta outra vez), tal
-- como private.consume_order_stock. Ingrediente com track=false entra no custo
-- mas não trava a venda — é o caso do que ainda não se conta.
-- ---------------------------------------------------------------------------
create or replace function private.consume_order_ingredients(p_order_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store_id uuid;
  v_need record;
  v_track boolean;
  v_new_qty integer;
  v_consumed integer := 0;
begin
  select o.store_id into v_store_id
  from public.orders o
  where o.id = p_order_id;

  if v_store_id is null then
    raise exception 'order_not_found' using errcode = 'P0002';
  end if;

  if exists (
    select 1 from public.ingredient_movements im
    where im.order_id = p_order_id and im.reason = 'sale'
  ) then
    return 0;
  end if;

  for v_need in
    select n.ingredient_id, n.qty
    from private.order_ingredient_needs(p_order_id) n
    order by n.ingredient_id
  loop
    select si.track into v_track
    from public.store_ingredients si
    where si.store_id = v_store_id
      and si.ingredient_id = v_need.ingredient_id
    for update;

    if not found or not v_track then
      continue;
    end if;

    update public.store_ingredients si
    set qty = si.qty - v_need.qty
    where si.store_id = v_store_id
      and si.ingredient_id = v_need.ingredient_id
      and si.qty >= v_need.qty
    returning si.qty into v_new_qty;

    if v_new_qty is null then
      insert into public.event_log (order_id, store_id, type, payload)
      values (
        p_order_id, v_store_id, 'order.ingredient_insufficient',
        jsonb_build_object('ingredient_id', v_need.ingredient_id, 'requested_qty', v_need.qty)
      );
      raise exception 'out_of_ingredient:%', (
        select i.name from public.ingredients i where i.id = v_need.ingredient_id
      ) using errcode = 'P0014';
    end if;

    perform private.record_ingredient_movement(
      v_store_id, v_need.ingredient_id, -v_need.qty, 'sale', p_order_id, null, v_new_qty
    );
    v_consumed := v_consumed + v_need.qty;
  end loop;

  -- Custo da linha, congelado. Vale para todas as linhas com ficha, mesmo as
  -- de ingredientes não contados — o CMV não depende de quem conta stock.
  update public.order_items oi
  set cost_cents = c.line_cost
  from (
    select
      oi2.id,
      sum(r.qty * oi2.qty * i.cost_cents)::integer as line_cost
    from public.order_items oi2
    join public.recipe_items r on r.menu_item_id = oi2.menu_item_id
    join public.ingredients i on i.id = r.ingredient_id
    left join public.menu_item_variants mv
      on mv.menu_item_id = oi2.menu_item_id
     and mv.name = oi2.variant_name_snapshot
    where oi2.order_id = p_order_id
      and oi2.menu_item_id is not null
      and (r.variant_id is null or r.variant_id = mv.id)
    group by oi2.id
  ) c
  where oi.id = c.id;

  return v_consumed;
end;
$$;

revoke all on function private.consume_order_ingredients(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 9. Reposição na anulação: repõe o que o livro diz que saiu, uma só vez.
-- ---------------------------------------------------------------------------
create or replace function private.restore_order_ingredients(p_order_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sale record;
  v_new_qty integer;
  v_restored integer := 0;
begin
  if exists (
    select 1 from public.ingredient_movements im
    where im.order_id = p_order_id and im.reason = 'void'
  ) then
    return 0;
  end if;

  for v_sale in
    select im.store_id, im.ingredient_id, sum(-im.delta)::integer as qty
    from public.ingredient_movements im
    where im.order_id = p_order_id
      and im.reason = 'sale'
    group by im.store_id, im.ingredient_id
  loop
    update public.store_ingredients si
    set qty = si.qty + v_sale.qty
    where si.store_id = v_sale.store_id
      and si.ingredient_id = v_sale.ingredient_id
    returning si.qty into v_new_qty;

    if v_new_qty is null then
      continue;
    end if;

    perform private.record_ingredient_movement(
      v_sale.store_id, v_sale.ingredient_id, v_sale.qty, 'void', p_order_id, null, v_new_qty
    );
    v_restored := v_restored + v_sale.qty;
  end loop;

  return v_restored;
end;
$$;

revoke all on function private.restore_order_ingredients(uuid) from public, anon, authenticated;
