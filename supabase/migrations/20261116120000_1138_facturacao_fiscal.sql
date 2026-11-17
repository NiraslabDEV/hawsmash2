-- Facturação fiscal (Moçambique, AT) — ADR 0013. Nasce DESLIGADA: sem `fiscal_settings.active`, nada aqui
-- corre e nenhuma venda muda.
--
-- O que garante, na BD e não no ecrã:
--   · Factura-Recibo (FR) quando a venda fica paga, em TODOS os canais: o gatilho está em `payments`, por onde
--     passam o balcão, a venda offline sincronizada, o site, o WhatsApp, a mesa e o garçom. Não há caminho a esquecer.
--   · A venda nunca pára (regra 1): a emissão corre num bloco com `exception`; o que falhar fica no `event_log`
--     e é emitido depois por `fiscal_emit_pending`.
--   · Numeração sequencial sem falhas por tipo e série; uma série por loja e por ano (`FR MPT2026/000001`).
--   · Documento emitido não se altera nem se apaga (UPDATE, DELETE e TRUNCATE recusados pela BD, a qualquer papel).
--     Anular é Nota de Crédito (NC) com motivo, ligada ao original.
--   · Cada documento guarda o hash do anterior da mesma série: mexer num antigo parte a cadeia.
--   · Dinheiro em centavos inteiros; o total do documento é o `total_cents` da venda, sempre.
--
-- Uma conta de mesa (vários lançamentos) leva UMA factura. Anular um lançamento de uma conta já facturada
-- emite a NC do documento inteiro e uma FR nova para o que continua pago.

-- ── Definições (da empresa: o emitente é um só, as lojas são estabelecimentos) ──
create table if not exists public.fiscal_settings (
  id smallint primary key default 1 check (id = 1),
  active boolean not null default false,
  legal_name text not null default '',
  nuit text not null default '',
  address text not null default '',
  regime text not null default 'normal' check (regime in ('normal', 'ispc', 'isento')),
  vat_bp integer not null default 1600 check (vat_bp between 0 and 5000),
  exemption_reason text not null default '',
  -- Número de certificação do programa pela AT. Vazio até a AT o atribuir: nunca se imprime "certificado" sem ele.
  at_certificate text not null default '',
  -- Instante da activação: o que foi pago antes nunca é facturado.
  active_since timestamptz,
  updated_at timestamptz not null default now(),
  constraint fiscal_settings_complete check (
    not active or (
      btrim(legal_name) <> '' and nuit ~ '^[0-9]{9}$' and btrim(address) <> '' and active_since is not null
      and (regime <> 'normal' or vat_bp > 0)
      and (regime <> 'isento' or length(btrim(exemption_reason)) >= 10)
    )
  )
);
insert into public.fiscal_settings (id) values (1) on conflict (id) do nothing;

-- NUIT e nome fiscal do adquirente, quando o cliente os pede na venda. Opcionais; sem eles é "Consumidor final".
alter table public.orders add column if not exists customer_nuit text;
alter table public.orders add column if not exists customer_fiscal_name text;
do $$ begin
  alter table public.orders add constraint orders_customer_nuit_check check (customer_nuit is null or customer_nuit ~ '^[0-9]{9}$');
exception when duplicate_object then null; end $$;

-- ── Séries, documentos, linhas ──────────────────────────────────────────────
create table if not exists public.fiscal_series (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id),
  doc_type text not null check (doc_type in ('FR', 'NC')),
  series text not null,
  last_number integer not null default 0,
  last_hash text not null default '',
  last_emitted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (doc_type, series)
);

create table if not exists public.fiscal_documents (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id),
  doc_type text not null check (doc_type in ('FR', 'NC')),
  series_id uuid not null references public.fiscal_series(id),
  series text not null,
  number integer not null check (number > 0),
  full_number text not null unique,
  issue_date date not null,
  emitted_at timestamptz not null,
  -- NC: o documento anulado. FR reemitida: o documento que substitui.
  origin_id uuid references public.fiscal_documents(id),
  origin_number text,
  reason text,
  -- Fotografia do emitente e do adquirente no momento: mudar as definições não muda o que já saiu.
  issuer jsonb not null,
  buyer jsonb not null,
  base_cents integer not null check (base_cents >= 0),
  vat_cents integer not null check (vat_cents >= 0),
  total_cents integer not null check (total_cents >= 0),
  payment_method text,
  operator text,
  hash text not null,
  previous_hash text not null,
  constraint fiscal_documents_totals check (base_cents + vat_cents = total_cents),
  constraint fiscal_documents_credit_note check (doc_type <> 'NC' or (origin_id is not null and btrim(coalesce(reason, '')) <> '')),
  unique (series_id, number)
);
create unique index if not exists fiscal_documents_one_credit_note on public.fiscal_documents (origin_id) where doc_type = 'NC';
create index if not exists fiscal_documents_store_date_idx on public.fiscal_documents (store_id, issue_date);

create table if not exists public.fiscal_document_lines (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.fiscal_documents(id),
  store_id uuid not null references public.stores(id),
  position integer not null,
  description text not null,
  quantity integer not null check (quantity > 0),
  unit_price_cents integer not null,        -- sem IVA
  vat_bp integer not null,                  -- 16 % = 1600
  exemption_reason text,
  base_cents integer not null,
  vat_cents integer not null,
  total_cents integer not null,
  constraint fiscal_document_lines_totals check (base_cents + vat_cents = total_cents),
  unique (document_id, position)
);

-- Que vendas cobre cada documento. `original` = a primeira FR dessa venda: só pode haver uma.
create table if not exists public.fiscal_document_orders (
  document_id uuid not null references public.fiscal_documents(id),
  order_id uuid not null references public.orders(id),
  store_id uuid not null references public.stores(id),
  original boolean not null default true,
  primary key (document_id, order_id)
);
create unique index if not exists fiscal_document_orders_one_original on public.fiscal_document_orders (order_id) where original;
create index if not exists fiscal_document_orders_order_idx on public.fiscal_document_orders (order_id);

-- Para achar a conta de mesa de um lançamento sem varrer a tabela a cada pagamento.
create index if not exists table_bills_order_ids_idx on public.table_bills using gin (order_ids);

-- ── Imutabilidade ───────────────────────────────────────────────────────────
create or replace function private.fiscal_immutable() returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'fiscal_document_immutable' using errcode = 'P0403',
    hint = 'Um documento fiscal emitido não se altera nem se apaga. Corrige-se com uma Nota de Crédito.';
end $$;

do $$
declare t text;
begin
  foreach t in array array['fiscal_documents', 'fiscal_document_lines', 'fiscal_document_orders'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_immutable', t);
    execute format('create trigger %I before update or delete on public.%I for each row execute function private.fiscal_immutable()', t || '_immutable', t);
    -- TRUNCATE não dispara gatilhos de linha.
    execute format('drop trigger if exists %I on public.%I', t || '_no_truncate', t);
    execute format('create trigger %I before truncate on public.%I for each statement execute function private.fiscal_immutable()', t || '_no_truncate', t);
  end loop;
  -- A série só avança; apagar uma série apagaria a numeração.
  drop trigger if exists fiscal_series_no_delete on public.fiscal_series;
  create trigger fiscal_series_no_delete before delete on public.fiscal_series for each row execute function private.fiscal_immutable();
  drop trigger if exists fiscal_series_no_truncate on public.fiscal_series;
  create trigger fiscal_series_no_truncate before truncate on public.fiscal_series for each statement execute function private.fiscal_immutable();
end $$;

-- ── RLS: leitura por loja, escrita só pelas funções abaixo ──────────────────
alter table public.fiscal_settings enable row level security;
alter table public.fiscal_series enable row level security;
alter table public.fiscal_documents enable row level security;
alter table public.fiscal_document_lines enable row level security;
alter table public.fiscal_document_orders enable row level security;

revoke all on public.fiscal_settings, public.fiscal_series, public.fiscal_documents, public.fiscal_document_lines, public.fiscal_document_orders
  from public, anon, authenticated;
grant select on public.fiscal_documents, public.fiscal_document_lines, public.fiscal_document_orders to authenticated;
grant select on public.fiscal_settings, public.fiscal_series, public.fiscal_documents, public.fiscal_document_lines, public.fiscal_document_orders to service_role;

-- A cozinha não vê dinheiro (CLAUDE §6).
drop policy if exists fiscal_documents_store_read on public.fiscal_documents;
create policy fiscal_documents_store_read on public.fiscal_documents for select to authenticated
  using ((select private.auth_can_store(store_id)) and coalesce((select private.auth_role()), '') in ('owner', 'manager', 'cashier'));
drop policy if exists fiscal_document_lines_store_read on public.fiscal_document_lines;
create policy fiscal_document_lines_store_read on public.fiscal_document_lines for select to authenticated
  using ((select private.auth_can_store(store_id)) and coalesce((select private.auth_role()), '') in ('owner', 'manager', 'cashier'));
drop policy if exists fiscal_document_orders_store_read on public.fiscal_document_orders;
create policy fiscal_document_orders_store_read on public.fiscal_document_orders for select to authenticated
  using ((select private.auth_can_store(store_id)) and coalesce((select private.auth_role()), '') in ('owner', 'manager', 'cashier'));

-- ── Texto do hash (igual, byte a byte, a `textoParaHash` de packages/fiscal) ─
create or replace function private.fiscal_hash(
  p_issue_date date, p_emitted_at timestamptz, p_full_number text, p_total_cents integer, p_buyer_nuit text, p_previous_hash text
) returns text language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(
    to_char(p_issue_date, 'YYYY-MM-DD') || ';' ||
    to_char(p_emitted_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') || ';' ||
    p_full_number || ';' ||
    (p_total_cents / 100)::text || '.' || lpad((p_total_cents % 100)::text, 2, '0') || ';' ||
    coalesce(nullif(p_buyer_nuit, ''), '999999999') || ';' ||
    p_previous_hash, 'UTF8')), 'base64');
$$;

-- ── Linhas de uma venda, com IVA incluído ───────────────────────────────────
-- O total das linhas é o que o cliente pagou: os descontos repartem-se pelos artigos na proporção do seu valor
-- (o resto do arredondamento vai para o artigo de maior valor) e a entrega é uma linha própria.
create or replace function private.fiscal_order_lines(p_order_ids uuid[])
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  v_order public.orders;
  v_lines jsonb := '[]'::jsonb;
  v_delivery integer;
  v_target integer;
  v_weight bigint;
  v_given integer;
  v_item record;
  v_share integer;
  v_first integer;
  v_best integer;
  v_best_weight bigint;
begin
  for v_order in
    select o.* from public.orders o where o.id = any(p_order_ids) order by o.created_at, o.id
  loop
    v_delivery := least(greatest(coalesce(v_order.delivery_fee_cents, 0) - coalesce(v_order.delivery_discount_cents, 0), 0), v_order.total_cents);
    v_target := v_order.total_cents - v_delivery;
    select coalesce(sum(oi.qty::bigint * oi.unit_price_cents), 0) into v_weight from public.order_items oi where oi.order_id = v_order.id;
    v_first := jsonb_array_length(v_lines);
    v_given := 0;
    v_best := null;
    v_best_weight := -1;
    if v_weight > 0 then
      for v_item in
        select oi.name_snapshot, oi.variant_name_snapshot, oi.qty, oi.qty::bigint * oi.unit_price_cents as weight
          from public.order_items oi where oi.order_id = v_order.id
         order by oi.name_snapshot, oi.id
      loop
        v_share := floor(v_item.weight::numeric * v_target / v_weight)::integer;
        v_given := v_given + v_share;
        if v_item.weight > v_best_weight then
          v_best_weight := v_item.weight;
          v_best := jsonb_array_length(v_lines);
        end if;
        v_lines := v_lines || jsonb_build_object(
          'description', left(v_item.name_snapshot || case
            when coalesce(v_item.variant_name_snapshot, '') <> '' and position(v_item.variant_name_snapshot in v_item.name_snapshot) = 0
            then ' — ' || v_item.variant_name_snapshot else '' end, 200),
          'quantity', v_item.qty, 'total_cents', v_share);
      end loop;
      if v_given <> v_target then
        v_lines := jsonb_set(v_lines, array[v_best::text, 'total_cents'],
          to_jsonb((v_lines -> v_best ->> 'total_cents')::integer + (v_target - v_given)));
      end if;
    elsif v_target > 0 then
      v_lines := v_lines || jsonb_build_object('description', 'Venda ' || v_order.order_number, 'quantity', 1, 'total_cents', v_target);
    end if;
    if v_delivery > 0 then
      v_lines := v_lines || jsonb_build_object('description', 'Taxa de entrega', 'quantity', 1, 'total_cents', v_delivery);
    end if;
  end loop;
  return v_lines;
end $$;

-- ── Emitir um documento ─────────────────────────────────────────────────────
-- Tranca a série, dá o número seguinte e só DEPOIS decide a data/hora: número e instante crescem juntos.
create or replace function private.fiscal_emit(
  p_store_id uuid, p_doc_type text, p_order_ids uuid[], p_origin_id uuid, p_reason text, p_buyer jsonb, p_original boolean
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_cfg public.fiscal_settings;
  v_store public.stores;
  v_origin public.fiscal_documents;
  v_series public.fiscal_series;
  v_series_name text;
  v_emitted timestamptz;
  v_date date;
  v_number integer;
  v_full text;
  v_lines jsonb;
  v_line jsonb;
  v_bp integer;
  v_exemption text;
  v_base integer := 0;
  v_vat integer := 0;
  v_total integer := 0;
  v_line_base integer;
  v_line_total integer;
  v_buyer jsonb;
  v_issuer jsonb;
  v_hash text;
  v_id uuid := gen_random_uuid();
  v_pos integer := 0;
  v_method text;
  v_operator text;
  v_try integer := 0;
begin
  select * into v_cfg from public.fiscal_settings where id = 1;
  if v_cfg.id is null or not v_cfg.active then return null; end if;
  select * into v_store from public.stores where id = p_store_id;
  if v_store.id is null then raise exception 'fiscal_store_not_found' using errcode = 'P0404'; end if;
  if p_doc_type not in ('FR', 'NC') or coalesce(array_length(p_order_ids, 1), 0) = 0 then
    raise exception 'fiscal_invalid_request' using errcode = 'P0400';
  end if;

  if p_origin_id is not null then
    select * into v_origin from public.fiscal_documents where id = p_origin_id and store_id = p_store_id;
    if v_origin.id is null then raise exception 'fiscal_origin_not_found' using errcode = 'P0404'; end if;
  end if;

  -- Linhas e adquirente.
  if p_doc_type = 'NC' then
    select jsonb_agg(jsonb_build_object('description', l.description, 'quantity', l.quantity, 'total_cents', l.total_cents,
                                         'vat_bp', l.vat_bp, 'exemption_reason', l.exemption_reason, 'base_cents', l.base_cents,
                                         'unit_price_cents', l.unit_price_cents) order by l.position)
      into v_lines from public.fiscal_document_lines l where l.document_id = v_origin.id;
    v_buyer := v_origin.buyer;
  else
    v_lines := private.fiscal_order_lines(p_order_ids);
    v_buyer := coalesce(p_buyer, (
      select jsonb_build_object('name', coalesce(nullif(btrim(o.customer_fiscal_name), ''), nullif(btrim(o.customer_name), ''), 'Consumidor final'),
                                'nuit', o.customer_nuit)
        from public.orders o where o.id = any(p_order_ids) and o.customer_nuit is not null order by o.created_at limit 1
    ), jsonb_build_object('name', 'Consumidor final', 'nuit', ''));
  end if;
  if coalesce(jsonb_array_length(v_lines), 0) = 0 then raise exception 'fiscal_no_lines' using errcode = 'P0400'; end if;
  if coalesce(v_buyer ->> 'nuit', '') <> '' and (v_buyer ->> 'nuit') !~ '^[0-9]{9}$' then
    raise exception 'fiscal_invalid_nuit' using errcode = 'P0400';
  end if;

  v_bp := case when v_cfg.regime = 'normal' then v_cfg.vat_bp else 0 end;
  v_exemption := case v_cfg.regime when 'normal' then null when 'ispc' then 'IVA não aplicável — regime ISPC' else btrim(v_cfg.exemption_reason) end;
  v_issuer := jsonb_build_object(
    'name', v_cfg.legal_name, 'nuit', v_cfg.nuit, 'address', v_cfg.address, 'regime', v_cfg.regime,
    'at_certificate', v_cfg.at_certificate, 'store_name', v_store.name, 'store_address', v_store.address);

  -- Série do ano (fuso de Maputo), trancada. Se a espera atravessar a passagem de ano, troca-se de série.
  loop
    v_try := v_try + 1;
    v_series_name := v_store.order_prefix || to_char(clock_timestamp() at time zone 'Africa/Maputo', 'YYYY');
    insert into public.fiscal_series (store_id, doc_type, series) values (p_store_id, p_doc_type, v_series_name)
    on conflict (doc_type, series) do nothing;
    select * into v_series from public.fiscal_series where doc_type = p_doc_type and series = v_series_name for update;
    if v_series.store_id <> p_store_id then raise exception 'fiscal_series_of_another_store' using errcode = 'P0409'; end if;
    -- Milissegundos: é a precisão que o ficheiro e o hash levam.
    v_emitted := greatest(date_trunc('milliseconds', clock_timestamp()), coalesce(v_series.last_emitted_at, '-infinity'::timestamptz));
    v_date := (v_emitted at time zone 'Africa/Maputo')::date;
    exit when v_series_name = v_store.order_prefix || to_char(v_date, 'YYYY') or v_try >= 3;
  end loop;

  -- Com a série trancada: uma venda só tem uma FR original; um documento só tem uma NC.
  if p_doc_type = 'FR' and p_original and exists (
    select 1 from public.fiscal_document_orders x where x.order_id = any(p_order_ids) and x.original
  ) then
    return null;
  end if;
  if p_doc_type = 'NC' and exists (select 1 from public.fiscal_documents d where d.origin_id = v_origin.id and d.doc_type = 'NC') then
    return null;
  end if;

  v_number := v_series.last_number + 1;
  v_full := p_doc_type || ' ' || v_series_name || '/' || lpad(v_number::text, 6, '0');

  for v_line in select * from jsonb_array_elements(v_lines) loop
    v_line_total := (v_line ->> 'total_cents')::integer;
    v_line_base := case when p_doc_type = 'NC' then (v_line ->> 'base_cents')::integer
                        when v_bp > 0 then round(v_line_total::numeric * 10000 / (10000 + v_bp))::integer
                        else v_line_total end;
    v_base := v_base + v_line_base;
    v_total := v_total + v_line_total;
  end loop;
  v_vat := v_total - v_base;

  select string_agg(distinct coalesce(p.method, p.provider), '+' order by coalesce(p.method, p.provider)) into v_method
    from public.payments p where p.order_id = any(p_order_ids) and p.status in ('confirmed', 'refunded');
  select sp.full_name into v_operator from public.staff_profiles sp where sp.user_id = (select auth.uid());

  v_hash := private.fiscal_hash(v_date, v_emitted, v_full, v_total, v_buyer ->> 'nuit', v_series.last_hash);

  insert into public.fiscal_documents (
    id, store_id, doc_type, series_id, series, number, full_number, issue_date, emitted_at, origin_id, origin_number, reason,
    issuer, buyer, base_cents, vat_cents, total_cents, payment_method, operator, hash, previous_hash
  ) values (
    v_id, p_store_id, p_doc_type, v_series.id, v_series_name, v_number, v_full, v_date, v_emitted, v_origin.id, v_origin.full_number,
    nullif(btrim(coalesce(p_reason, '')), ''), v_issuer, v_buyer, v_base, v_vat, v_total, v_method, v_operator, v_hash, v_series.last_hash
  );

  for v_line in select * from jsonb_array_elements(v_lines) loop
    v_pos := v_pos + 1;
    v_line_total := (v_line ->> 'total_cents')::integer;
    if p_doc_type = 'NC' then
      insert into public.fiscal_document_lines (document_id, store_id, position, description, quantity, unit_price_cents, vat_bp, exemption_reason, base_cents, vat_cents, total_cents)
      values (v_id, p_store_id, v_pos, v_line ->> 'description', (v_line ->> 'quantity')::integer, (v_line ->> 'unit_price_cents')::integer,
              (v_line ->> 'vat_bp')::integer, v_line ->> 'exemption_reason', (v_line ->> 'base_cents')::integer,
              v_line_total - (v_line ->> 'base_cents')::integer, v_line_total);
    else
      v_line_base := case when v_bp > 0 then round(v_line_total::numeric * 10000 / (10000 + v_bp))::integer else v_line_total end;
      insert into public.fiscal_document_lines (document_id, store_id, position, description, quantity, unit_price_cents, vat_bp, exemption_reason, base_cents, vat_cents, total_cents)
      values (v_id, p_store_id, v_pos, v_line ->> 'description', greatest((v_line ->> 'quantity')::integer, 1),
              round(v_line_base::numeric / greatest((v_line ->> 'quantity')::integer, 1))::integer,
              v_bp, v_exemption, v_line_base, v_line_total - v_line_base, v_line_total);
    end if;
  end loop;

  insert into public.fiscal_document_orders (document_id, order_id, store_id, original)
  select v_id, o.id, p_store_id, (p_doc_type = 'FR' and p_original)
    from public.orders o where o.id = any(p_order_ids) and o.store_id = p_store_id;

  update public.fiscal_series set last_number = v_number, last_hash = v_hash, last_emitted_at = v_emitted where id = v_series.id;

  insert into public.event_log (store_id, order_id, type, payload)
  values (p_store_id, p_order_ids[1], 'fiscal.document_emitted',
          jsonb_build_object('document_id', v_id, 'number', v_full, 'total_cents', v_total, 'origin', v_origin.full_number));
  return v_id;
end $$;

-- Totalmente paga = os pagamentos confirmados cobrem o total. Uma venda a zero não tem o que facturar.
create or replace function private.fiscal_order_paid(p_order_id uuid) returns boolean language sql stable set search_path = '' as $$
  select o.total_cents > 0 and o.status <> 'cancelled'
     and coalesce((select sum(p.amount_cents) from public.payments p where p.order_id = o.id and p.status = 'confirmed'), 0) >= o.total_cents
    from public.orders o where o.id = p_order_id;
$$;

-- O documento em vigor de uma venda: a FR (original ou reemitida) que ainda não tem Nota de Crédito.
create or replace function private.fiscal_active_document(p_order_id uuid) returns uuid language sql stable set search_path = '' as $$
  select d.id
    from public.fiscal_document_orders x
    join public.fiscal_documents d on d.id = x.document_id
   where x.order_id = p_order_id and d.doc_type = 'FR'
     and not exists (select 1 from public.fiscal_documents n where n.origin_id = d.id and n.doc_type = 'NC')
   order by d.emitted_at desc, d.number desc
   limit 1;
$$;

-- FR da venda — ou da conta inteira, se a venda é de uma conta de mesa, e só quando toda a conta está paga.
create or replace function private.fiscal_emit_for_order(p_order_id uuid) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_order public.orders;
  v_ids uuid[];
begin
  select * into v_order from public.orders where id = p_order_id;
  if v_order.id is null then return null; end if;
  -- A conta de mesa grava primeiro `table_bills.order_ids` e só depois paga cada lançamento (e só no fim de
  -- cada um lhe põe `table_bill_id`): é pela lista da conta que se sabe o que vai na mesma factura.
  if v_order.table_bill_id is not null or v_order.table_id is not null then
    select array_agg(o.id order by o.created_at, o.id) into v_ids
      from public.table_bills b
      join public.orders o on o.id = any(b.order_ids)
     where b.store_id = v_order.store_id
       and (b.id = v_order.table_bill_id or b.order_ids @> array[v_order.id])
       and o.store_id = v_order.store_id and o.status <> 'cancelled' and o.total_cents > 0;
  end if;
  v_ids := coalesce(v_ids, array[v_order.id]);
  if v_ids is null or exists (select 1 from unnest(v_ids) as t(id) where not coalesce(private.fiscal_order_paid(t.id), false)) then
    return null;
  end if;
  return private.fiscal_emit(v_order.store_id, 'FR', v_ids, null, null, null, true);
end $$;

-- Anulação: NC do documento em vigor; se o documento cobria outras vendas que continuam pagas, FR nova para essas.
create or replace function private.fiscal_credit_for_order(p_order_id uuid, p_reason text) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_doc public.fiscal_documents;
  v_credit uuid;
  v_rest uuid[];
begin
  select d.* into v_doc from public.fiscal_documents d where d.id = private.fiscal_active_document(p_order_id);
  if v_doc.id is null then return null; end if;
  v_credit := private.fiscal_emit(v_doc.store_id, 'NC', array[p_order_id], v_doc.id,
                                  coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'Anulação da venda'), null, false);
  if v_credit is null then return null; end if;
  select array_agg(x.order_id) into v_rest
    from public.fiscal_document_orders x
   where x.document_id = v_doc.id and coalesce(private.fiscal_order_paid(x.order_id), false);
  if v_rest is not null then
    perform private.fiscal_emit(v_doc.store_id, 'FR', v_rest, v_doc.id, 'Substitui ' || v_doc.full_number, v_doc.buyer, false);
  end if;
  return v_credit;
end $$;

-- ── O gatilho: todos os caminhos de venda passam por `payments` ─────────────
create or replace function private.fiscal_on_payment() returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_timeout text;
begin
  if not exists (select 1 from public.fiscal_settings where id = 1 and active) then return null; end if;
  -- A venda nunca pára (regra 1): o que falhar aqui fica registado e é emitido por `fiscal_emit_pending`.
  begin
    v_timeout := current_setting('lock_timeout');
    -- Outra venda da mesma loja a emitir: espera-se pouco pela série, não se prende o caixa.
    perform set_config('lock_timeout', '4s', true);
    if new.status = 'confirmed' and (tg_op = 'INSERT' or old.status is distinct from 'confirmed') then
      perform private.fiscal_emit_for_order(new.order_id);
    elsif tg_op = 'UPDATE' and new.status = 'refunded' and old.status = 'confirmed' then
      perform private.fiscal_credit_for_order(new.order_id, nullif(current_setting('app.fiscal_reason', true), ''));
    end if;
    perform set_config('lock_timeout', v_timeout, true);
  exception when others then
    begin
      perform set_config('lock_timeout', coalesce(v_timeout, '0'), true);
      insert into public.event_log (store_id, order_id, type, payload)
      values (new.store_id, new.order_id, 'fiscal.emit_failed', jsonb_build_object('sqlstate', sqlstate, 'error', left(sqlerrm, 300), 'status', new.status));
    exception when others then null;
    end;
  end;
  return null;
end $$;

drop trigger if exists payments_fiscal_document on public.payments;
create trigger payments_fiscal_document
  after insert or update of status on public.payments
  for each row execute function private.fiscal_on_payment();

revoke all on function private.fiscal_emit(uuid, text, uuid[], uuid, text, jsonb, boolean) from public, anon, authenticated;
revoke all on function private.fiscal_emit_for_order(uuid) from public, anon, authenticated;
revoke all on function private.fiscal_credit_for_order(uuid, text) from public, anon, authenticated;
revoke all on function private.fiscal_on_payment() from public, anon, authenticated;

-- ── Definições: só o dono ───────────────────────────────────────────────────
create or replace function public.get_fiscal_settings() returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v public.fiscal_settings;
begin
  if not coalesce((select private.auth_is_owner()), false) then raise exception 'forbidden' using errcode = 'P0403'; end if;
  select * into v from public.fiscal_settings where id = 1;
  return jsonb_build_object(
    'active', v.active, 'legal_name', v.legal_name, 'nuit', v.nuit, 'address', v.address, 'regime', v.regime,
    'vat_bp', v.vat_bp, 'exemption_reason', v.exemption_reason, 'at_certificate', v.at_certificate, 'active_since', v.active_since,
    'documents', (select count(*) from public.fiscal_documents),
    'pending', case when v.active then (
      select count(distinct p.order_id) from public.payments p
       where p.status = 'confirmed' and p.created_at >= v.active_since
         and private.fiscal_active_document(p.order_id) is null
         and not exists (select 1 from public.fiscal_document_orders x where x.order_id = p.order_id)
    ) else 0 end);
end $$;

-- Activar grava o INSTANTE: o que foi pago antes nunca é facturado. Desligar não apaga nada.
create or replace function public.save_fiscal_settings(p jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_old public.fiscal_settings;
  v_active boolean;
  v_nuit text := regexp_replace(coalesce(p ->> 'nuit', ''), '\s', '', 'g');
  v_regime text := coalesce(p ->> 'regime', 'normal');
  v_bp integer := coalesce((p ->> 'vat_bp')::integer, 1600);
begin
  if not coalesce((select private.auth_is_owner()), false) then raise exception 'forbidden' using errcode = 'P0403'; end if;
  if jsonb_typeof(p) <> 'object' then raise exception 'invalid_payload' using errcode = 'P0400'; end if;
  select * into v_old from public.fiscal_settings where id = 1 for update;
  v_active := coalesce((p ->> 'active')::boolean, v_old.active);
  if v_regime not in ('normal', 'ispc', 'isento') then raise exception 'fiscal_invalid_regime' using errcode = 'P0400'; end if;
  if v_active then
    if btrim(coalesce(p ->> 'legal_name', '')) = '' then raise exception 'fiscal_legal_name_required' using errcode = 'P0400'; end if;
    if v_nuit !~ '^[0-9]{9}$' then raise exception 'fiscal_invalid_nuit' using errcode = 'P0400'; end if;
    if btrim(coalesce(p ->> 'address', '')) = '' then raise exception 'fiscal_address_required' using errcode = 'P0400'; end if;
    if v_regime = 'normal' and not (v_bp > 0 and v_bp <= 5000) then raise exception 'fiscal_invalid_vat' using errcode = 'P0400'; end if;
    if v_regime = 'isento' and length(btrim(coalesce(p ->> 'exemption_reason', ''))) < 10 then
      raise exception 'fiscal_exemption_reason_required' using errcode = 'P0400';
    end if;
  end if;
  update public.fiscal_settings set
    active = v_active,
    legal_name = btrim(coalesce(p ->> 'legal_name', '')),
    nuit = v_nuit,
    address = btrim(coalesce(p ->> 'address', '')),
    regime = v_regime,
    vat_bp = v_bp,
    exemption_reason = btrim(coalesce(p ->> 'exemption_reason', '')),
    at_certificate = btrim(coalesce(p ->> 'at_certificate', '')),
    active_since = case when v_active and not v_old.active then clock_timestamp() when v_active then v_old.active_since else v_old.active_since end,
    updated_at = now()
  where id = 1;
  insert into public.event_log (type, payload, actor_user_id)
  values ('fiscal.settings_saved', jsonb_build_object('active', v_active, 'was_active', v_old.active, 'regime', v_regime, 'vat_bp', v_bp), (select auth.uid()));
  return public.get_fiscal_settings();
end $$;

-- ── Pendentes: o que o gatilho não conseguiu emitir (série ocupada, erro) ───
create or replace function public.fiscal_emit_pending(p_limit integer default 50) returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_cfg public.fiscal_settings;
  v_order uuid;
  v_done integer := 0;
begin
  if coalesce((select auth.role()), '') <> 'service_role' and not coalesce((select private.auth_is_owner()), false) then
    raise exception 'forbidden' using errcode = 'P0403';
  end if;
  select * into v_cfg from public.fiscal_settings where id = 1;
  if not coalesce(v_cfg.active, false) then return 0; end if;
  for v_order in
    select q.order_id from (
      select p.order_id, min(p.created_at) as paid_at from public.payments p
       where p.status = 'confirmed' and p.created_at >= v_cfg.active_since
         and not exists (select 1 from public.fiscal_document_orders x where x.order_id = p.order_id)
       group by p.order_id
    ) q order by q.paid_at limit greatest(least(coalesce(p_limit, 50), 500), 1)
  loop
    begin
      if private.fiscal_emit_for_order(v_order) is not null then v_done := v_done + 1; end if;
    exception when others then
      insert into public.event_log (order_id, type, payload)
      values (v_order, 'fiscal.emit_failed', jsonb_build_object('sqlstate', sqlstate, 'error', left(sqlerrm, 300), 'pending', true));
    end;
  end loop;
  return v_done;
end $$;

-- ── O documento de uma venda, para imprimir e mostrar ───────────────────────
create or replace function public.get_order_fiscal_documents(p_order_id uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_store uuid;
begin
  select o.store_id into v_store from public.orders o where o.id = p_order_id;
  if v_store is null or not coalesce((select private.auth_can_store(v_store)), false)
     or coalesce((select private.auth_role()), '') not in ('owner', 'manager', 'cashier') then
    raise exception 'forbidden' using errcode = 'P0403';
  end if;
  return coalesce((
    select jsonb_agg(private.fiscal_document_json(d.id) order by d.emitted_at, d.number)
      from public.fiscal_documents d
     where d.id in (select x.document_id from public.fiscal_document_orders x where x.order_id = p_order_id)
  ), '[]'::jsonb);
end $$;

create or replace function private.fiscal_document_json(p_id uuid) returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', d.id, 'store_id', d.store_id, 'doc_type', d.doc_type, 'series', d.series, 'number', d.number, 'full_number', d.full_number,
    'issue_date', d.issue_date, 'emitted_at', d.emitted_at, 'origin_number', d.origin_number, 'reason', d.reason,
    'issuer', d.issuer, 'buyer', d.buyer, 'base_cents', d.base_cents, 'vat_cents', d.vat_cents, 'total_cents', d.total_cents,
    'payment_method', d.payment_method, 'operator', d.operator, 'hash', d.hash, 'previous_hash', d.previous_hash,
    -- 1.º, 11.º, 21.º e 31.º caracteres do hash: conferem o papel com o sistema.
    'control_code', substr(d.hash, 1, 1) || substr(d.hash, 11, 1) || substr(d.hash, 21, 1) || substr(d.hash, 31, 1),
    'voided', exists (select 1 from public.fiscal_documents n where n.origin_id = d.id and n.doc_type = 'NC'),
    'lines', (select jsonb_agg(jsonb_build_object(
        'position', l.position, 'description', l.description, 'quantity', l.quantity, 'unit_price_cents', l.unit_price_cents,
        'vat_bp', l.vat_bp, 'exemption_reason', l.exemption_reason, 'base_cents', l.base_cents, 'vat_cents', l.vat_cents,
        'total_cents', l.total_cents) order by l.position)
      from public.fiscal_document_lines l where l.document_id = d.id))
  from public.fiscal_documents d where d.id = p_id;
$$;

-- ── Cliente pede NUIT depois: NC do original + FR nova com o adquirente certo ─
create or replace function public.fiscal_reissue(p_order_id uuid, p_nuit text, p_name text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_doc public.fiscal_documents;
  v_nuit text := regexp_replace(coalesce(p_nuit, ''), '\s', '', 'g');
  v_name text := left(btrim(coalesce(p_name, '')), 120);
  v_orders uuid[];
  v_new uuid;
begin
  select d.* into v_doc from public.fiscal_documents d where d.id = private.fiscal_active_document(p_order_id);
  if v_doc.id is null then raise exception 'fiscal_document_not_found' using errcode = 'P0404'; end if;
  if not coalesce((select private.auth_can_store(v_doc.store_id)), false)
     or coalesce((select private.auth_role()), '') not in ('owner', 'manager') then
    raise exception 'forbidden' using errcode = 'P0403';
  end if;
  if v_nuit !~ '^[0-9]{9}$' then raise exception 'fiscal_invalid_nuit' using errcode = 'P0400'; end if;
  if v_name = '' then raise exception 'fiscal_buyer_name_required' using errcode = 'P0400'; end if;
  select array_agg(x.order_id) into v_orders from public.fiscal_document_orders x where x.document_id = v_doc.id;
  if private.fiscal_emit(v_doc.store_id, 'NC', v_orders, v_doc.id, 'Reemissão com o NUIT do adquirente', null, false) is null then
    raise exception 'fiscal_already_credited' using errcode = 'P0409';
  end if;
  v_new := private.fiscal_emit(v_doc.store_id, 'FR', v_orders, v_doc.id, 'Substitui ' || v_doc.full_number,
                               jsonb_build_object('name', v_name, 'nuit', v_nuit), false);
  insert into public.event_log (store_id, order_id, type, payload, actor_user_id)
  values (v_doc.store_id, p_order_id, 'fiscal.reissued', jsonb_build_object('from', v_doc.full_number, 'document_id', v_new), (select auth.uid()));
  return private.fiscal_document_json(v_new);
end $$;

-- ── Ficheiro do mês (e-Declaração) e verificação da cadeia: só o dono ───────
create or replace function public.fiscal_export_month(p_year integer, p_month integer) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_from date := make_date(p_year, p_month, 1);
  v_result jsonb;
begin
  if not coalesce((select private.auth_is_owner()), false) then raise exception 'forbidden' using errcode = 'P0403'; end if;
  select coalesce(jsonb_agg(private.fiscal_document_json(d.id) order by d.doc_type, d.series, d.number), '[]'::jsonb) into v_result
    from public.fiscal_documents d
   where d.issue_date >= v_from and d.issue_date < (v_from + interval '1 month')::date;
  insert into public.event_log (type, payload, actor_user_id)
  values ('fiscal.exported', jsonb_build_object('year', p_year, 'month', p_month, 'documents', jsonb_array_length(v_result)), (select auth.uid()));
  return jsonb_build_object(
    'issuer', (select jsonb_build_object('name', s.legal_name, 'nuit', s.nuit, 'address', s.address, 'at_certificate', s.at_certificate) from public.fiscal_settings s where s.id = 1),
    'from', v_from, 'to', (v_from + interval '1 month' - interval '1 day')::date, 'documents', v_result);
end $$;

-- Refaz o hash de cada documento, por série e por ordem: devolve o primeiro que não bate (ou nenhum).
create or replace function public.fiscal_verify_chain() returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_series public.fiscal_series;
  v_doc public.fiscal_documents;
  v_prev text;
  v_expected integer;
  v_broken jsonb := '[]'::jsonb;
  v_count integer := 0;
begin
  if not coalesce((select private.auth_is_owner()), false) then raise exception 'forbidden' using errcode = 'P0403'; end if;
  for v_series in select * from public.fiscal_series order by doc_type, series loop
    v_prev := '';
    v_expected := 1;
    for v_doc in select * from public.fiscal_documents d where d.series_id = v_series.id order by d.number loop
      v_count := v_count + 1;
      if v_doc.number <> v_expected then
        v_broken := v_broken || jsonb_build_object('number', v_doc.full_number, 'reason', 'sequence'); exit;
      elsif v_doc.previous_hash <> v_prev then
        v_broken := v_broken || jsonb_build_object('number', v_doc.full_number, 'reason', 'link'); exit;
      elsif private.fiscal_hash(v_doc.issue_date, v_doc.emitted_at, v_doc.full_number, v_doc.total_cents, v_doc.buyer ->> 'nuit', v_prev) <> v_doc.hash then
        v_broken := v_broken || jsonb_build_object('number', v_doc.full_number, 'reason', 'hash'); exit;
      end if;
      v_prev := v_doc.hash;
      v_expected := v_expected + 1;
    end loop;
    if jsonb_array_length(v_broken) = 0 and (v_series.last_number <> v_expected - 1 or v_series.last_hash <> v_prev) then
      v_broken := v_broken || jsonb_build_object('number', v_series.doc_type || ' ' || v_series.series, 'reason', 'series_counter');
    end if;
  end loop;
  return jsonb_build_object('ok', jsonb_array_length(v_broken) = 0, 'documents', v_count, 'broken', v_broken);
end $$;

revoke all on function public.get_fiscal_settings() from public, anon;
revoke all on function public.save_fiscal_settings(jsonb) from public, anon;
revoke all on function public.fiscal_emit_pending(integer) from public, anon;
revoke all on function public.get_order_fiscal_documents(uuid) from public, anon;
revoke all on function public.fiscal_reissue(uuid, text, text) from public, anon;
revoke all on function public.fiscal_export_month(integer, integer) from public, anon;
revoke all on function public.fiscal_verify_chain() from public, anon;
revoke all on function private.fiscal_document_json(uuid) from public, anon, authenticated;
grant execute on function public.get_fiscal_settings(), public.save_fiscal_settings(jsonb), public.fiscal_emit_pending(integer),
  public.get_order_fiscal_documents(uuid), public.fiscal_reissue(uuid, text, text), public.fiscal_export_month(integer, integer),
  public.fiscal_verify_chain() to authenticated, service_role;

notify pgrst, 'reload schema';
