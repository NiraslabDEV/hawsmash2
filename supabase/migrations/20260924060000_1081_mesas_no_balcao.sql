-- 1081 — mesas por loja, pedidos lançados na mesa e a conta da mesa.
--
-- Pedido do dono (24 Set): no POS, por baixo de Senhas, uma aba MESAS. Quem
-- está na mesa 2 pede pelo QR ou ao balcão, e vai tudo para a mesma mesa. A
-- mesa paga no fim, tudo junto — conta aberta.
--
-- O que muda:
--
-- 1. As mesas passam a ser de uma loja (Regra 3). A mesa 2 de Maputo e a mesa
--    2 da Matola são mesas diferentes, com QR diferentes. A equipa da loja lê
--    as suas; criar, editar e apagar continua só do dono. O anon deixa de ler
--    a tabela: o QR resolve a mesa por get_table_by_token, que agora também diz
--    a loja — sem isso um QR da Matola caía em Maputo.
--
-- 2. A conta da mesa. Um pedido de mesa nasce por pagar e vai logo para a
--    cozinha. A conta é o que a mesa pediu HOJE e ainda não pagou; fechá-la
--    cobra tudo de uma vez (misto, troco, gaveta), grava `table_bills` e marca
--    cada pedido com `table_bill_id`. É o dia de Maputo, e não "tudo o que
--    ficou por pagar": um pedido de teste de 1 de Setembro, entregue e nunca
--    cobrado, ficaria para sempre na mesa 1 sem se poder fechar.
--
-- 3. launch_table_order: o caixa lança o carrinho numa mesa, sem cobrar. Preço
--    da loja, variante e extras recalculados aqui (Regra 2); stock e ficha
--    técnica descontados na mesma transacção; idempotente por clientSaleId
--    (Regra 4). Sai a comanda da mesa para a cozinha.
--
-- 4. close_table_bill: fecha a conta. Só cobra o que o caixa viu — se entrou um
--    pedido pelo QR entretanto, o total não bate e a conta não fecha em
--    silêncio. Duas caixas a fechar a mesma mesa: a segunda espera e recusa.
--    Os pagamentos repartem-se pelos pedidos, para o fecho de caixa (que soma
--    pagamentos por pedido) contar certo.
--
-- 5. pos_table_overview: as mesas da loja com a conta de cada uma, para a aba.
--
-- 6. O pedido pelo QR: a mesa tem de ser da loja do pedido; o nome passa a
--    começar por "Mesa N"; o stock e a ficha técnica baixam (até aqui um pedido
--    de mesa não baixava nada); e a comanda sai com o número da loja (MPT-…) —
--    a do motor herdado saía com ENC-…, calculado antes da numeração por loja.
--    O canal de um pedido de mesa passa a ser `dine_in` (era `pickup`).
--
-- O papel: a comanda da mesa é a do formato herdado — MESA em grande, artigos
-- por pessoa, "PAGAR NO BALCAO / A MESA" — como a 1062 e o CLAUDE §8.3 deixaram
-- para as mesas; os extras saem como uma linha "Extras:". A conta fechada sai
-- no talão completo, com preços, pagamentos e troco. Os dois imprimem com o
-- bridge que está nas lojas.
--
-- Fora, de propósito: offline (a mesa é online-only, como a entrega) e anular
-- uma conta já fechada.
--
-- Forward-only.

-- ---------------------------------------------------------------------------
-- 1. As mesas passam a ser de uma loja
-- ---------------------------------------------------------------------------
alter table public.tables
  add column if not exists store_id uuid references public.stores(id) on delete cascade;

-- As mesas de antes das lojas ficam na primeira loja. Nesta instalação são as
-- duas que o dono abriu para testar o link, em Maputo.
update public.tables t
set store_id = (
  select s.id from public.stores s order by s.sort, s.created_at limit 1
)
where t.store_id is null;

alter table public.tables alter column store_id set not null;

alter table public.tables drop constraint if exists tables_number_key;
do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.tables'::regclass and conname = 'tables_store_number_key'
  ) then
    alter table public.tables
      add constraint tables_store_number_key unique (store_id, number);
  end if;
end;
$$;

drop policy if exists "staff_all" on public.tables;
drop policy if exists anon_read_active on public.tables;
drop policy if exists owner_only on public.tables;
drop policy if exists tables_store_select on public.tables;
drop policy if exists tables_owner_write on public.tables;

create policy tables_store_select on public.tables
  for select to authenticated
  using (private.auth_can_store(store_id));

create policy tables_owner_write on public.tables
  for all to authenticated
  using (private.auth_is_owner())
  with check (private.auth_is_owner());

revoke all on table public.tables from anon;

-- O QR resolve a mesa por aqui: e agora diz também de que loja ela é.
create or replace function public.get_table_by_token(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_table record;
begin
  select t.id, t.number, s.slug, s.short_name
  into v_table
  from public.tables t
  join public.stores s on s.id = t.store_id
  where t.token = p_token
    and t.active
    and s.active;

  if not found then
    raise exception 'invalid_table' using errcode = 'P0060';
  end if;

  return jsonb_build_object(
    'id', v_table.id,
    'number', v_table.number,
    'store_slug', v_table.slug,
    'store_name', v_table.short_name
  );
end;
$$;

revoke all on function public.get_table_by_token(text) from public;
grant execute on function public.get_table_by_token(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. A conta da mesa
-- ---------------------------------------------------------------------------
create table if not exists public.table_bills (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  table_id uuid references public.tables(id) on delete set null,
  table_number integer not null check (table_number > 0),
  client_close_id uuid not null unique,
  device_id uuid references public.devices(id) on delete set null,
  order_ids uuid[] not null,
  total_cents integer not null check (total_cents > 0),
  payments jsonb not null default '[]'::jsonb,
  cash_received_cents integer check (cash_received_cents is null or cash_received_cents >= 0),
  change_cents integer check (change_cents is null or change_cents >= 0),
  closed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists table_bills_store_created_idx
  on public.table_bills (store_id, created_at desc);

alter table public.table_bills enable row level security;

drop policy if exists table_bills_store_select on public.table_bills;
create policy table_bills_store_select on public.table_bills
  for select to authenticated
  using (
    private.auth_role() in ('owner', 'manager', 'cashier')
    and private.auth_can_store(store_id)
  );

revoke all on table public.table_bills from public, anon, authenticated;
grant select on table public.table_bills to authenticated;

alter table public.orders
  add column if not exists table_bill_id uuid references public.table_bills(id) on delete set null;

create index if not exists orders_open_table_idx
  on public.orders (store_id, table_id, created_at)
  where table_id is not null and table_bill_id is null;

-- O canal de um pedido de mesa é a mesa, não o levantamento.
create or replace function private.set_order_channel()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.channel is null then
    new.channel := case new.fulfillment_type
      when 'delivery' then 'delivery'
      when 'dine_in' then 'dine_in'
      else 'pickup'
    end;
  end if;
  return new;
end;
$$;

-- A conta aberta: o que a mesa pediu hoje (dia de Maputo) e ainda não pagou.
-- Uma só definição, para a aba mostrar exactamente o que o fecho vai cobrar.
create or replace function private.table_tab_order_ids(p_store_id uuid, p_table_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select o.id
  from public.orders o
  where o.store_id = p_store_id
    and o.table_id = p_table_id
    and o.fulfillment_type = 'dine_in'
    and o.table_bill_id is null
    and o.status in ('in_preparation', 'ready', 'delivered')
    and o.created_at >= (
      pg_catalog.date_trunc('day', now() at time zone 'Africa/Maputo')
    ) at time zone 'Africa/Maputo'
  order by o.created_at, o.id;
$$;

revoke all on function private.table_tab_order_ids(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. O papel da mesa
-- ---------------------------------------------------------------------------

-- A comanda da mesa, no formato herdado (sem `template`): MESA em grande e os
-- artigos por pessoa. Os extras vão como uma escolha "Extras", que é o que o
-- formato herdado sabe imprimir por baixo do artigo.
create or replace function private.build_table_comanda(p_order_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'order_number', o.order_number,
    'daily_number', o.daily_number,
    'customer_name', coalesce(nullif(btrim(o.customer_name), ''), 'Mesa ' || t.number),
    'fulfillment_type', 'dine_in',
    'table_number', t.number,
    'items', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'name', oi.name_snapshot,
          'quantity', oi.qty,
          'variant', oi.variant_name_snapshot,
          'notes', oi.notes,
          'person', oi.person_label,
          'modifiers',
            case when jsonb_typeof(oi.modifiers) = 'array' then oi.modifiers else '[]'::jsonb end
            || case
              when jsonb_typeof(oi.addons) = 'array' and jsonb_array_length(oi.addons) > 0 then
                jsonb_build_array(jsonb_build_object(
                  'group_name', 'Extras',
                  'options', (
                    select coalesce(jsonb_agg(jsonb_build_object('name', a.value ->> 'name')), '[]'::jsonb)
                    from jsonb_array_elements(oi.addons) a
                  )
                ))
              else '[]'::jsonb
            end
        ) order by oi.person_label nulls first, oi.id
      ), '[]'::jsonb)
      from public.order_items oi
      where oi.order_id = o.id
    ),
    'payment_method', 'no_payment',
    'total_cents', o.total_cents,
    'notes', o.notes,
    'created_at', o.created_at
  )
  from public.orders o
  join public.tables t on t.id = o.table_id
  where o.id = p_order_id;
$$;

revoke all on function private.build_table_comanda(uuid) from public, anon, authenticated;

create or replace function private.enqueue_table_comanda(p_order_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store_id uuid;
  v_job_id uuid;
begin
  select o.store_id into v_store_id
  from public.orders o
  where o.id = p_order_id and o.table_id is not null;
  if not found then
    return null;
  end if;

  -- A comanda que o motor herdado pôs na fila nesta transacção (pedido pelo
  -- QR) leva o número antigo. Ainda ninguém a viu.
  delete from public.print_jobs pj
  where pj.order_id = p_order_id
    and pj.kind = 'order'
    and pj.status = 'queued'
    and not (pj.payload ? 'template');

  insert into public.print_jobs (store_id, order_id, station, kind, reprint_seq, payload)
  values (
    v_store_id, p_order_id, 'kitchen', 'order', 0,
    private.build_table_comanda(p_order_id)
  )
  on conflict (order_id, station, kind, reprint_seq) do nothing
  returning id into v_job_id;

  if v_job_id is not null then
    insert into public.event_log (order_id, store_id, actor_user_id, type, payload)
    values (p_order_id, v_store_id, (select auth.uid()), 'print.table_comanda_queued',
      jsonb_build_object('job_id', v_job_id));
  end if;

  return v_job_id;
end;
$$;

revoke all on function private.enqueue_table_comanda(uuid) from public, anon, authenticated;

-- A conta fechada, no talão completo: o que se pediu, a preço, e como se pagou.
-- PEDIDO leva "CONTA MESA N" e o número grande é o da mesa — é o que um bridge
-- de hoje imprime no lugar da senha.
create or replace function private.build_table_bill_ticket(p_bill_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'template', 'kitchen',
    'formato', 'talao_completo',
    'via', null,
    'station', 'counter',
    'store_short_name', s.short_name,
    'store_address', s.address,
    'store_phone', s.phone,
    'receipt_footer', s.receipt_footer,
    'order_number', 'CONTA MESA ' || b.table_number,
    'daily_number', b.table_number,
    'channel', 'dine_in',
    'fulfillment_type', 'dine_in',
    'customer_name', 'Mesa ' || b.table_number,
    'customer_phone', null,
    'address', null,
    'delivery_zone', null,
    'scheduled_for', null,
    'items', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'name', l.name,
          'quantity', l.qty,
          'notes', l.notes,
          'line_total_cents', l.line_total_cents
        ) order by l.first_seen
      ), '[]'::jsonb)
      from (
        -- O mesmo artigo de vários pedidos numa linha só; com nota, à parte.
        select
          artigo.name,
          artigo.notes,
          sum(artigo.qty)::integer as qty,
          sum(artigo.line_total)::integer as line_total_cents,
          min(artigo.created_at) as first_seen
        from (
          select
            case
              when nullif(btrim(oi.variant_name_snapshot), '') is null
                or strpos(lower(oi.name_snapshot), lower(btrim(oi.variant_name_snapshot))) > 0
              then oi.name_snapshot
              else oi.name_snapshot || ' ' || btrim(oi.variant_name_snapshot)
            end
            || coalesce(
              ' + ' || (
                select string_agg(a.value ->> 'name', ' + ' order by a.ordinality)
                from jsonb_array_elements(
                  case when jsonb_typeof(oi.addons) = 'array' then oi.addons else '[]'::jsonb end
                ) with ordinality as a(value, ordinality)
              ),
              ''
            ) as name,
            oi.notes,
            oi.qty,
            oi.qty * oi.unit_price_cents as line_total,
            o.created_at
          from public.order_items oi
          join public.orders o on o.id = oi.order_id
          where oi.order_id = any(b.order_ids)
        ) artigo
        group by artigo.name, artigo.notes
      ) l
    ),
    'notes', null,
    'subtotal_cents', (
      select coalesce(sum(o.subtotal_cents), 0) from public.orders o where o.id = any(b.order_ids)
    ),
    'delivery_fee_cents', 0,
    'discount_cents', (
      select coalesce(sum(o.discount_cents), 0) from public.orders o where o.id = any(b.order_ids)
    ),
    'total_cents', b.total_cents,
    'payment_method', b.payments -> 0 ->> 'method',
    'payments', b.payments,
    'cash_received_cents', b.cash_received_cents,
    'change_cents', b.change_cents,
    'review_url', nullif(btrim(coalesce(bs.social ->> 'google_review', '')), ''),
    'instagram', nullif(btrim(coalesce(bs.contact ->> 'instagram', '')), ''),
    'instagram_url', nullif(btrim(coalesce(bs.social ->> 'instagram', '')), ''),
    'created_at', b.created_at
  )
  from public.table_bills b
  join public.stores s on s.id = b.store_id
  left join public.brand_settings bs on bs.id = 1
  where b.id = p_bill_id;
$$;

revoke all on function private.build_table_bill_ticket(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Os artigos de um pedido de mesa, a preço da loja
-- ---------------------------------------------------------------------------
-- As mesmas regras da venda de balcão (1077): preço da loja, a variante
-- substitui o preço base, cada extra soma e tem de ser um adicional activo
-- DESTE produto. O stock é descontado depois, por consume_order_stock.
create or replace function private.price_table_items(p_store_id uuid, p_items jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_menu_item_id uuid;
  v_variant_id uuid;
  v_qty integer;
  v_row record;
  v_variant record;
  v_unit_price integer;
  v_variant_name text;
  v_addon record;
  v_addon_id uuid;
  v_addon_text text;
  v_addon_ids uuid[];
  v_addons jsonb;
begin
  if p_items is null
    or jsonb_typeof(p_items) <> 'array'
    or jsonb_array_length(p_items) = 0
    or jsonb_array_length(p_items) > 100
  then
    raise exception 'invalid_items' using errcode = 'P0007';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    begin
      v_menu_item_id := nullif(v_item ->> 'menuItemId', '')::uuid;
      v_qty := (v_item ->> 'qty')::integer;
      v_variant_id := nullif(btrim(v_item ->> 'variantId'), '')::uuid;
    exception when invalid_text_representation then
      raise exception 'invalid_item' using errcode = 'P0007';
    end;

    if v_menu_item_id is null or v_qty is null or v_qty < 1 or v_qty > 99 then
      raise exception 'invalid_item' using errcode = 'P0007';
    end if;

    select
      mi.name,
      mc.station,
      si.available,
      coalesce(si.price_cents_override, mi.price_cents) as price_cents
    into v_row
    from public.store_items si
    join public.menu_items mi on mi.id = si.menu_item_id
    join public.menu_categories mc on mc.id = mi.category_id
    where si.store_id = p_store_id
      and si.menu_item_id = v_menu_item_id;

    if not found or not v_row.available then
      raise exception 'item_unavailable:%', v_menu_item_id using errcode = 'P0014';
    end if;

    v_unit_price := v_row.price_cents;
    v_variant_name := null;
    if v_variant_id is not null then
      select mv.name, mv.price_cents
      into v_variant
      from public.menu_item_variants mv
      where mv.id = v_variant_id
        and mv.menu_item_id = v_menu_item_id
        and mv.active;
      if not found then
        raise exception 'invalid_variant:%', v_variant_id using errcode = 'P0015';
      end if;
      v_unit_price := v_variant.price_cents;
      v_variant_name := v_variant.name;
    end if;

    v_addons := '[]'::jsonb;
    v_addon_ids := array[]::uuid[];
    if jsonb_typeof(v_item -> 'addonIds') is not null
      and jsonb_typeof(v_item -> 'addonIds') <> 'null'
    then
      if jsonb_typeof(v_item -> 'addonIds') <> 'array'
        or jsonb_array_length(v_item -> 'addonIds') > 20
      then
        raise exception 'invalid_addons' using errcode = 'P0007';
      end if;

      for v_addon_text in select value from jsonb_array_elements_text(v_item -> 'addonIds')
      loop
        begin
          v_addon_id := nullif(btrim(v_addon_text), '')::uuid;
        exception when invalid_text_representation then
          raise exception 'invalid_addon:%', v_addon_text using errcode = 'P0016';
        end;
        if v_addon_id is null then
          raise exception 'invalid_addon:%', v_addon_text using errcode = 'P0016';
        end if;
        if v_addon_id = any(v_addon_ids) then
          raise exception 'duplicate_addon:%', v_addon_id using errcode = 'P0016';
        end if;
        v_addon_ids := array_append(v_addon_ids, v_addon_id);

        select a.name, a.price_cents
        into v_addon
        from public.menu_addons a
        where a.id = v_addon_id
          and a.menu_item_id = v_menu_item_id
          and a.active;
        if not found then
          raise exception 'invalid_addon:%', v_addon_id using errcode = 'P0016';
        end if;

        v_unit_price := v_unit_price + v_addon.price_cents;
        v_addons := v_addons || jsonb_build_array(
          jsonb_build_object('name', v_addon.name, 'price_cents', v_addon.price_cents)
        );
      end loop;
    end if;

    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'menu_item_id', v_menu_item_id,
      'name', v_row.name,
      'station', v_row.station,
      'qty', v_qty,
      'unit_price_cents', v_unit_price,
      'variant_name', v_variant_name,
      'addons', v_addons,
      'notes', nullif(btrim(v_item ->> 'notes'), '')
    ));
  end loop;

  return v_lines;
end;
$$;

revoke all on function private.price_table_items(uuid, jsonb) from public, anon, authenticated;

-- Terminal do POS desta pessoa, desbloqueado. Devolve a loja.
create or replace function private.pos_device_store(p_device_id uuid)
returns public.stores
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_device public.devices%rowtype;
  v_store public.stores%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated' using errcode = 'P0020';
  end if;
  if coalesce(private.auth_role(), '') not in ('owner', 'manager', 'cashier') then
    raise exception 'pos_access_denied' using errcode = 'P0403';
  end if;

  select d.* into v_device
  from public.devices d
  where d.id = p_device_id
    and d.kind = 'pos'
    and d.active
    and private.auth_can_store(d.store_id);
  if not found then
    raise exception 'invalid_or_unauthorised_device' using errcode = 'P0403';
  end if;
  if v_device.locked_at is not null then
    raise exception 'device_locked' using errcode = 'P0403';
  end if;

  select s.* into v_store
  from public.stores s
  where s.id = v_device.store_id
    and s.active
    and s.counter_enabled;
  if not found then
    raise exception 'counter_disabled' using errcode = 'P0403';
  end if;

  return v_store;
end;
$$;

revoke all on function private.pos_device_store(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. O caixa lança um pedido na mesa
-- ---------------------------------------------------------------------------
create or replace function public.launch_table_order(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_client_sale_id uuid;
  v_device_id uuid;
  v_table_id uuid;
  v_store public.stores%rowtype;
  v_table public.tables%rowtype;
  v_existing public.orders%rowtype;
  v_lines jsonb;
  v_line jsonb;
  v_subtotal integer := 0;
  v_day date;
  v_daily integer;
  v_order_number text;
  v_order_id uuid;
begin
  begin
    v_client_sale_id := nullif(p_payload ->> 'clientSaleId', '')::uuid;
    v_device_id := nullif(p_payload ->> 'deviceId', '')::uuid;
    v_table_id := nullif(p_payload ->> 'tableId', '')::uuid;
  exception when invalid_text_representation then
    raise exception 'invalid_pos_payload' using errcode = 'P0007';
  end;
  if v_client_sale_id is null then
    raise exception 'client_sale_id_required' using errcode = 'P0007';
  end if;

  -- Repetir o mesmo lançamento devolve o mesmo pedido (Regra 4), mesmo com o
  -- terminal entretanto bloqueado.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_client_sale_id::text, 0)
  );
  select o.* into v_existing
  from public.orders o
  where o.client_sale_id = v_client_sale_id;
  if found then
    if v_uid is null or not private.auth_can_store(v_existing.store_id) then
      raise exception 'client_sale_id_store_conflict' using errcode = 'P0409';
    end if;
    return jsonb_build_object(
      'order_id', v_existing.id,
      'order_number', v_existing.order_number,
      'daily_number', v_existing.daily_number,
      'total_cents', v_existing.total_cents,
      'table_id', v_existing.table_id,
      'duplicate', true
    );
  end if;

  v_store := private.pos_device_store(v_device_id);

  select t.* into v_table
  from public.tables t
  where t.id = v_table_id
    and t.store_id = v_store.id
    and t.active;
  if not found then
    raise exception 'invalid_table' using errcode = 'P0060';
  end if;

  v_lines := private.price_table_items(v_store.id, p_payload -> 'items');
  for v_line in select value from jsonb_array_elements(v_lines)
  loop
    v_subtotal := v_subtotal
      + (v_line ->> 'unit_price_cents')::integer * (v_line ->> 'qty')::integer;
  end loop;

  v_day := (now() at time zone 'Africa/Maputo')::date;
  insert into public.order_counters (store_id, day, seq)
  values (v_store.id, v_day, 1)
  on conflict (store_id, day) do update
    set seq = public.order_counters.seq + 1
  returning seq into v_daily;

  v_order_number := private.next_order_number(v_store.id);

  perform set_config('app.request_store_id', v_store.id::text, true);

  insert into public.orders (
    store_id, order_number, daily_number, client_sale_id, table_id,
    status, flow, fulfillment_type, channel,
    customer_name, subtotal_cents, delivery_fee_cents, total_cents,
    payment_method, notes
  ) values (
    v_store.id, v_order_number, v_daily, v_client_sale_id, v_table.id,
    'in_preparation', 'dine_in', 'dine_in', 'dine_in',
    'Mesa ' || v_table.number, v_subtotal, 0, v_subtotal,
    'no_payment', nullif(btrim(p_payload ->> 'notes'), '')
  )
  returning id into v_order_id;

  for v_line in select value from jsonb_array_elements(v_lines)
  loop
    insert into public.order_items (
      order_id, store_id, menu_item_id, name_snapshot, qty, unit_price_cents,
      station, notes, variant_name_snapshot, addons
    ) values (
      v_order_id,
      v_store.id,
      (v_line ->> 'menu_item_id')::uuid,
      v_line ->> 'name',
      (v_line ->> 'qty')::integer,
      (v_line ->> 'unit_price_cents')::integer,
      v_line ->> 'station',
      v_line ->> 'notes',
      v_line ->> 'variant_name',
      coalesce(v_line -> 'addons', '[]'::jsonb)
    );
  end loop;

  -- Stock do produto e matéria-prima, na mesma transacção: se faltar, o
  -- lançamento inteiro reverte (out_of_stock / out_of_ingredient).
  perform private.consume_order_stock(v_order_id);

  insert into public.event_log (order_id, store_id, actor_user_id, type, payload)
  values (
    v_order_id, v_store.id, v_uid, 'table.order_launched',
    jsonb_build_object(
      'client_sale_id', v_client_sale_id,
      'device_id', v_device_id,
      'table_number', v_table.number,
      'total_cents', v_subtotal
    )
  );

  -- O papel e a atribuição do upsell são best-effort (Regra 1).
  begin
    perform private.enqueue_table_comanda(v_order_id);
  exception when others then
    insert into public.event_log (order_id, store_id, actor_user_id, type, payload)
    values (v_order_id, v_store.id, v_uid, 'print.table_comanda_failed',
      jsonb_build_object('error', sqlstate));
  end;
  begin
    perform private.record_order_upsells(v_order_id, p_payload);
  exception when others then
    raise warning 'upsell_tracking_failed: %', sqlstate;
  end;

  update public.devices set last_seen_at = now() where id = v_device_id;

  return jsonb_build_object(
    'order_id', v_order_id,
    'order_number', v_order_number,
    'daily_number', v_daily,
    'total_cents', v_subtotal,
    'table_id', v_table.id,
    'table_number', v_table.number,
    'duplicate', false
  );
end;
$$;

revoke all on function public.launch_table_order(jsonb) from public, anon;
grant execute on function public.launch_table_order(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Fechar a conta da mesa
-- ---------------------------------------------------------------------------
create or replace function public.close_table_bill(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_client_close_id uuid;
  v_device_id uuid;
  v_table_id uuid;
  v_expected integer;
  v_store public.stores%rowtype;
  v_table public.tables%rowtype;
  v_existing public.table_bills%rowtype;
  v_order_ids uuid[];
  v_total integer;
  v_payment jsonb;
  v_payments jsonb := '[]'::jsonb;
  v_amount integer;
  v_payment_total integer := 0;
  v_cash_payment integer := 0;
  v_cash_received integer;
  v_change integer;
  v_bill_id uuid;
  v_order record;
  v_due integer;
  v_index integer := -1;
  v_left integer := 0;
  v_method text;
  v_first_method text;
  v_seq integer := 0;
  v_take integer;
  v_job_id uuid;
begin
  begin
    v_client_close_id := nullif(p_payload ->> 'clientCloseId', '')::uuid;
    v_device_id := nullif(p_payload ->> 'deviceId', '')::uuid;
    v_table_id := nullif(p_payload ->> 'tableId', '')::uuid;
    v_expected := (p_payload ->> 'expectedTotalCents')::integer;
  exception when invalid_text_representation then
    raise exception 'invalid_pos_payload' using errcode = 'P0007';
  end;
  if v_client_close_id is null then
    raise exception 'client_close_id_required' using errcode = 'P0007';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('table_bill:' || v_client_close_id::text, 0)
  );
  select b.* into v_existing
  from public.table_bills b
  where b.client_close_id = v_client_close_id;
  if found then
    if v_uid is null or not private.auth_can_store(v_existing.store_id) then
      raise exception 'client_close_id_store_conflict' using errcode = 'P0409';
    end if;
    return jsonb_build_object(
      'bill_id', v_existing.id,
      'table_number', v_existing.table_number,
      'total_cents', v_existing.total_cents,
      'cash_received_cents', v_existing.cash_received_cents,
      'change_cents', v_existing.change_cents,
      'order_count', coalesce(array_length(v_existing.order_ids, 1), 0),
      'duplicate', true
    );
  end if;

  v_store := private.pos_device_store(v_device_id);

  select t.* into v_table
  from public.tables t
  where t.id = v_table_id
    and t.store_id = v_store.id;
  if not found then
    raise exception 'invalid_table' using errcode = 'P0060';
  end if;

  -- Duas caixas a fechar a mesma mesa: a segunda espera por esta e depois
  -- já não encontra o que cobrar.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('table_tab:' || v_table.id::text, 0)
  );

  select array_agg(t.id order by o.created_at, o.id), sum(o.total_cents)::integer
  into v_order_ids, v_total
  from private.table_tab_order_ids(v_store.id, v_table.id) t(id)
  join public.orders o on o.id = t.id;

  if v_order_ids is null or v_total is null or v_total <= 0 then
    raise exception 'table_has_no_open_orders' using errcode = 'P0409';
  end if;

  perform 1 from public.orders o where o.id = any(v_order_ids) for update;

  -- Só se cobra o que o caixa viu. Um pedido do QR que entrou entretanto
  -- muda o total: a conta não fecha e o POS mostra-a outra vez.
  if v_expected is null or v_expected <> v_total then
    raise exception 'table_bill_changed' using errcode = 'P0409';
  end if;

  if p_payload -> 'payments' is null
    or jsonb_typeof(p_payload -> 'payments') <> 'array'
    or jsonb_array_length(p_payload -> 'payments') = 0
    or jsonb_array_length(p_payload -> 'payments') > 4
  then
    raise exception 'invalid_payments' using errcode = 'P0007';
  end if;

  for v_payment in select value from jsonb_array_elements(p_payload -> 'payments')
  loop
    if coalesce(v_payment ->> 'method', '') not in ('cash', 'mpesa', 'emola', 'credit_card') then
      raise exception 'invalid_payment_method' using errcode = 'P0007';
    end if;
    begin
      v_amount := (v_payment ->> 'amountCents')::integer;
    exception when invalid_text_representation then
      raise exception 'invalid_payment_amount' using errcode = 'P0007';
    end;
    if v_amount is null or v_amount <= 0 then
      raise exception 'invalid_payment_amount' using errcode = 'P0007';
    end if;
    v_payment_total := v_payment_total + v_amount;
    if v_payment ->> 'method' = 'cash' then
      v_cash_payment := v_cash_payment + v_amount;
    end if;
    v_payments := v_payments || jsonb_build_array(
      jsonb_build_object('method', v_payment ->> 'method', 'amount_cents', v_amount)
    );
  end loop;

  if v_payment_total <> v_total then
    raise exception 'payment_total_mismatch' using errcode = 'P0007';
  end if;

  if v_cash_payment > 0 then
    begin
      v_cash_received := (p_payload ->> 'cashReceivedCents')::integer;
    exception when invalid_text_representation then
      raise exception 'invalid_cash_received' using errcode = 'P0007';
    end;
    if v_cash_received is null or v_cash_received < v_cash_payment then
      raise exception 'insufficient_cash_received' using errcode = 'P0007';
    end if;
    v_change := v_cash_received - v_cash_payment;
  end if;

  insert into public.table_bills (
    store_id, table_id, table_number, client_close_id, device_id, order_ids,
    total_cents, payments, cash_received_cents, change_cents, closed_by
  ) values (
    v_store.id, v_table.id, v_table.number, v_client_close_id, v_device_id, v_order_ids,
    v_total, v_payments, v_cash_received, v_change, v_uid
  )
  returning id into v_bill_id;

  -- Os pagamentos repartem-se pelos pedidos, por ordem: o fecho de caixa soma
  -- pagamentos confirmados por pedido, e cada pedido fica pago por inteiro.
  for v_order in
    select o.id, o.total_cents
    from public.orders o
    where o.id = any(v_order_ids)
    order by o.created_at, o.id
  loop
    v_due := v_order.total_cents;
    v_first_method := null;
    while v_due > 0 loop
      if v_left = 0 then
        v_index := v_index + 1;
        v_method := v_payments -> v_index ->> 'method';
        v_left := (v_payments -> v_index ->> 'amount_cents')::integer;
      end if;
      v_take := least(v_due, v_left);
      v_seq := v_seq + 1;
      insert into public.payments (
        order_id, store_id, provider, method, amount_cents, status, idempotency_key
      ) values (
        v_order.id, v_store.id, 'counter', v_method, v_take, 'confirmed',
        'table:' || v_bill_id::text || ':' || v_seq::text
      );
      v_first_method := coalesce(v_first_method, v_method);
      v_due := v_due - v_take;
      v_left := v_left - v_take;
    end loop;

    update public.orders
    set table_bill_id = v_bill_id,
        payment_method = coalesce(v_first_method, v_payments -> 0 ->> 'method')
    where id = v_order.id;
  end loop;

  if not exists (
    select 1 from public.cash_sessions cs
    where cs.store_id = v_store.id and cs.closed_at is null
  ) then
    insert into public.cash_sessions (store_id, opened_by)
    values (v_store.id, v_uid);
    insert into public.event_log (store_id, actor_user_id, type, payload)
    values (v_store.id, v_uid, 'cash.session_auto_opened',
      jsonb_build_object('source', 'table_bill'));
  end if;

  insert into public.event_log (store_id, actor_user_id, type, payload)
  values (
    v_store.id, v_uid, 'table.bill_closed',
    jsonb_build_object(
      'bill_id', v_bill_id,
      'table_number', v_table.number,
      'order_ids', to_jsonb(v_order_ids),
      'total_cents', v_total,
      'payments', v_payments,
      'device_id', v_device_id
    )
  );

  -- O papel e a gaveta são best-effort (Regra 1): a conta fica fechada.
  -- `kind = 'order'` na estação do balcão é o caminho por onde o bridge de
  -- hoje já imprime o talão completo das vendas.
  begin
    insert into public.print_jobs (store_id, order_id, station, kind, reprint_seq, request_id, payload)
    values (
      v_store.id, null, 'counter', 'order', 0, v_bill_id,
      private.build_table_bill_ticket(v_bill_id)
    )
    returning id into v_job_id;

    if v_cash_payment > 0 then
      insert into public.print_jobs (store_id, order_id, station, kind, reprint_seq, request_id, payload)
      values (
        v_store.id, null, 'counter', 'drawer', 0, v_bill_id,
        jsonb_build_object('reason', 'table_bill', 'bill_id', v_bill_id)
      );
    end if;
  exception when others then
    insert into public.event_log (store_id, actor_user_id, type, payload)
    values (v_store.id, v_uid, 'print.table_bill_failed',
      jsonb_build_object('bill_id', v_bill_id, 'error', sqlstate));
  end;

  update public.devices set last_seen_at = now() where id = v_device_id;

  return jsonb_build_object(
    'bill_id', v_bill_id,
    'table_number', v_table.number,
    'total_cents', v_total,
    'cash_received_cents', v_cash_received,
    'change_cents', v_change,
    'order_count', array_length(v_order_ids, 1),
    'duplicate', false
  );
end;
$$;

revoke all on function public.close_table_bill(jsonb) from public, anon;
grant execute on function public.close_table_bill(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. As mesas da loja, para a aba do POS
-- ---------------------------------------------------------------------------
create or replace function public.pos_table_overview(p_device_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_store public.stores%rowtype;
begin
  v_store := private.pos_device_store(p_device_id);

  return jsonb_build_object(
    'store_id', v_store.id,
    'tables', (
      select coalesce(jsonb_agg(mesa order by (mesa ->> 'number')::integer), '[]'::jsonb)
      from (
        select jsonb_build_object(
          'id', t.id,
          'number', t.number,
          'active', t.active,
          'orders', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', o.id,
                'order_number', o.order_number,
                'daily_number', o.daily_number,
                'status', o.status,
                'origin', case when o.client_sale_id is null then 'qr' else 'pos' end,
                'customer_name', o.customer_name,
                'created_at', o.created_at,
                'total_cents', o.total_cents,
                'notes', o.notes,
                'items', (
                  select coalesce(jsonb_agg(
                    jsonb_build_object(
                      'name', oi.name_snapshot,
                      'variant', oi.variant_name_snapshot,
                      'qty', oi.qty,
                      'unit_price_cents', oi.unit_price_cents,
                      'notes', oi.notes,
                      'person', oi.person_label,
                      'addons', case when jsonb_typeof(oi.addons) = 'array' then oi.addons else '[]'::jsonb end
                    ) order by oi.person_label nulls first, oi.id
                  ), '[]'::jsonb)
                  from public.order_items oi
                  where oi.order_id = o.id
                )
              ) order by o.created_at, o.id
            )
            from private.table_tab_order_ids(v_store.id, t.id) tab(id)
            join public.orders o on o.id = tab.id
          ), '[]'::jsonb)
        ) as mesa
        from public.tables t
        where t.store_id = v_store.id
      ) mesas
      -- Uma mesa desactivada com conta por fechar continua a aparecer.
      where (mesa ->> 'active')::boolean
        or jsonb_array_length(mesa -> 'orders') > 0
    )
  );
end;
$$;

revoke all on function public.pos_table_overview(uuid) from public, anon;
grant execute on function public.pos_table_overview(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. O pedido pelo QR da mesa
-- ---------------------------------------------------------------------------
create or replace function private.after_qr_table_order(p_order_id uuid, p_table_number integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  -- O nome começa pela mesa: é o que o caixa e o talão lêem primeiro.
  select nullif(btrim(o.customer_name), '') into v_name
  from public.orders o where o.id = p_order_id;
  -- Um checkout repetido devolve o mesmo pedido: não se põe a mesa duas vezes.
  update public.orders
  set customer_name = case
    when v_name is null then 'Mesa ' || p_table_number
    when lower(v_name) like lower('Mesa ' || p_table_number) || '%' then v_name
    else 'Mesa ' || p_table_number || ' · ' || v_name
  end
  where id = p_order_id;

  -- Até aqui um pedido de mesa não baixava stock nem ficha técnica.
  perform private.consume_order_stock(p_order_id);

  begin
    perform private.enqueue_table_comanda(p_order_id);
  exception when others then
    insert into public.event_log (order_id, type, payload)
    values (p_order_id, 'print.table_comanda_failed', jsonb_build_object('error', sqlstate));
  end;
end;
$$;

revoke all on function private.after_qr_table_order(uuid, integer) from public, anon, authenticated;

create or replace function public.create_order(p_store_slug text, p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  result uuid;
  v_table_id uuid;
  v_table_number integer;
begin
  -- (1081) Pedido de mesa: a mesa tem de ser desta loja e estar activa.
  if p_payload ->> 'fulfillmentType' = 'dine_in' then
    begin
      v_table_id := nullif(p_payload ->> 'tableId', '')::uuid;
    exception when invalid_text_representation then
      raise exception 'invalid_table' using errcode = 'P0060';
    end;
    select t.number into v_table_number
    from public.tables t
    join public.stores s on s.id = t.store_id
    where t.id = v_table_id
      and t.active
      and s.slug = p_store_slug;
    if not found then
      raise exception 'invalid_table' using errcode = 'P0060';
    end if;
  end if;

  result := private.create_order_before_upsell(p_store_slug, p_payload);

  if v_table_number is not null then
    perform private.after_qr_table_order(result, v_table_number);
  end if;

  begin
    perform private.record_order_upsells(result, p_payload);
  exception when others then
    raise warning 'upsell_tracking_failed: %', sqlstate;
  end;
  return result;
end;
$$;

revoke all on function public.create_order(text, jsonb) from public;
grant execute on function public.create_order(text, jsonb) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
