-- 1140 — Facturação completa (ADR 0013, módulo Escritório). Continua DESLIGADA sem `fiscal_settings.active`.
--
--   · Adquirente com NUIT, nome e MORADA (CIVA art. 27.º), pedido ANTES de pagar: o POS, o site e a conta da mesa
--     deixam o pedido numa fila pela chave da venda (`client_sale_id`, `client_checkout_id`, `client_close_id`);
--     a emissão lê-o lá. Nenhuma RPC de venda muda.
--   · Impressão da Factura-Recibo e da Nota de Crédito no talão de 80 mm, pela fila de impressão (kind `fiscal`).
--     Uma bridge antiga não tem o formato e falha o trabalho em vez de imprimir uma factura incompleta.
--   · Lista de documentos, documento para imprimir em A4, 2.ª via e reemissão com morada.

-- ── Definições ──────────────────────────────────────────────────────────────
alter table public.fiscal_settings add column if not exists auto_print boolean not null default true;
alter table public.orders add column if not exists customer_fiscal_address text;

-- ── Pedido de factura com NUIT, antes da venda ──────────────────────────────
create table if not exists public.fiscal_buyer_requests (
  store_id uuid not null references public.stores(id),
  request_key uuid not null,
  nuit text not null check (nuit ~ '^[0-9]{9}$'),
  name text not null check (btrim(name) <> '' and length(name) <= 120),
  address text check (address is null or length(address) <= 200),
  created_by uuid,
  created_at timestamptz not null default now(),
  primary key (store_id, request_key)
);
alter table public.fiscal_buyer_requests enable row level security;
revoke all on public.fiscal_buyer_requests from public, anon, authenticated;
grant select on public.fiscal_buyer_requests to service_role;

create or replace function private.fiscal_clean_buyer(p_nuit text, p_name text, p_address text)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  v_nuit text := regexp_replace(coalesce(p_nuit, ''), '\s', '', 'g');
  v_name text := left(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'), 120);
  v_address text := nullif(left(regexp_replace(btrim(coalesce(p_address, '')), '\s+', ' ', 'g'), 200), '');
begin
  if v_nuit !~ '^[0-9]{9}$' then raise exception 'fiscal_invalid_nuit' using errcode = 'P0400'; end if;
  if v_name = '' then raise exception 'fiscal_buyer_name_required' using errcode = 'P0400'; end if;
  return jsonb_build_object('nuit', v_nuit, 'name', v_name, 'address', v_address);
end $$;

-- Uma venda que já tem documento fiscal não muda de adquirente por aqui: só por reemissão.
create or replace function private.fiscal_stage_buyer(p_store_id uuid, p_key uuid, p_buyer jsonb, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if p_key is null then raise exception 'fiscal_invalid_request' using errcode = 'P0400'; end if;
  if exists (
    select 1 from public.orders o
      join public.fiscal_document_orders x on x.order_id = o.id
     where o.store_id = p_store_id
       and (o.id = p_key or o.client_sale_id = p_key or o.client_checkout_id = p_key
            or o.id in (select unnest(b.order_ids) from public.table_bills b where b.store_id = p_store_id and b.client_close_id = p_key))
  ) then
    raise exception 'fiscal_already_issued' using errcode = 'P0409';
  end if;
  insert into public.fiscal_buyer_requests (store_id, request_key, nuit, name, address, created_by)
  values (p_store_id, p_key, p_buyer ->> 'nuit', p_buyer ->> 'name', p_buyer ->> 'address', p_actor)
  on conflict (store_id, request_key) do update
    set nuit = excluded.nuit, name = excluded.name, address = excluded.address, created_by = excluded.created_by, created_at = now();
  return p_buyer;
end $$;

-- POS (venda e conta da mesa): quem vende nesta loja.
create or replace function public.stage_fiscal_buyer(p_store_id uuid, p_key uuid, p_nuit text, p_name text, p_address text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce((select private.auth_can_store(p_store_id)), false)
     or coalesce((select private.auth_role()), '') not in ('owner', 'manager', 'cashier') then
    raise exception 'forbidden' using errcode = 'P0403';
  end if;
  return private.fiscal_stage_buyer(p_store_id, p_key, private.fiscal_clean_buyer(p_nuit, p_name, p_address), (select auth.uid()));
end $$;

-- Site: a chave é o `clientCheckoutId` (pagamento automático, antes de criar o pedido) ou o id do pedido acabado
-- de criar (comprovativo) — o mesmo que o browser já usa para mandar o comprovativo. Só enquanto espera pagamento.
create or replace function public.stage_checkout_fiscal_buyer(p_store_slug text, p_checkout_id uuid, p_nuit text, p_name text, p_address text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_store uuid;
  v_order public.orders;
begin
  select s.id into v_store from public.stores s where s.slug = p_store_slug and s.active;
  if v_store is null then raise exception 'store_not_found' using errcode = 'P0404'; end if;
  select * into v_order from public.orders o where o.id = p_checkout_id and o.store_id = v_store;
  if v_order.id is not null and (v_order.status not in ('draft', 'awaiting_payment', 'awaiting_approval', 'payment_failed')
                                 or v_order.created_at < now() - interval '2 hours') then
    raise exception 'fiscal_too_late' using errcode = 'P0409';
  end if;
  return private.fiscal_stage_buyer(v_store, p_checkout_id, private.fiscal_clean_buyer(p_nuit, p_name, p_address), null);
end $$;

-- O adquirente de um conjunto de vendas: pedido pela chave da venda, senão o gravado no pedido, senão consumidor final.
create or replace function private.fiscal_buyer_for(p_order_ids uuid[]) returns jsonb language sql stable set search_path = '' as $$
  select coalesce(
    (select jsonb_build_object('name', r.name, 'nuit', r.nuit, 'address', r.address)
       from public.orders o
       join public.fiscal_buyer_requests r on r.store_id = o.store_id
        and r.request_key in (o.id, o.client_sale_id, o.client_checkout_id,
                              (select b.client_close_id from public.table_bills b where b.store_id = o.store_id and b.order_ids @> array[o.id] limit 1))
      where o.id = any(p_order_ids)
      order by r.created_at desc limit 1),
    (select jsonb_build_object('name', coalesce(nullif(btrim(o.customer_fiscal_name), ''), nullif(btrim(o.customer_name), ''), 'Consumidor final'),
                               'nuit', o.customer_nuit, 'address', o.customer_fiscal_address)
       from public.orders o where o.id = any(p_order_ids) and o.customer_nuit is not null order by o.created_at limit 1),
    jsonb_build_object('name', 'Consumidor final', 'nuit', '', 'address', null));
$$;

-- ── Impressão ───────────────────────────────────────────────────────────────
alter table public.print_jobs drop constraint if exists print_jobs_kind_check;
alter table public.print_jobs add constraint print_jobs_kind_check
  check (kind in ('order', 'receipt', 'drawer', 'cash_close', 'test', 'fiscal'));

-- O talão leva tudo o que o documento gravou; nunca as definições de agora.
create or replace function private.fiscal_print_payload(p_id uuid, p_via text) returns jsonb language sql stable set search_path = '' as $$
  select private.fiscal_document_json(d.id) || jsonb_build_object(
      'template', 'fiscal', 'format_version', 1, 'via', p_via,
      'store_phone', s.phone,
      'order_numbers', (select jsonb_agg(o.order_number order by o.created_at) from public.fiscal_document_orders x
                          join public.orders o on o.id = x.order_id where x.document_id = d.id),
      'cash_received_cents', (select sum(o.cash_received_cents) from public.fiscal_document_orders x
                               join public.orders o on o.id = x.order_id where x.document_id = d.id and d.doc_type = 'FR'),
      'change_cents', (select sum(o.change_cents) from public.fiscal_document_orders x
                        join public.orders o on o.id = x.order_id where x.document_id = d.id and d.doc_type = 'FR'),
      'product', 'WinTable')
    from public.fiscal_documents d join public.stores s on s.id = d.store_id
   where d.id = p_id;
$$;

create or replace function private.fiscal_enqueue_print(p_id uuid, p_via text) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_doc public.fiscal_documents;
  v_order uuid;
  v_seq integer;
  v_job uuid;
begin
  select * into v_doc from public.fiscal_documents where id = p_id;
  if v_doc.id is null then return null; end if;
  select x.order_id into v_order from public.fiscal_document_orders x
    join public.orders o on o.id = x.order_id where x.document_id = p_id order by o.created_at limit 1;
  -- Cada documento (e cada 2.ª via) é um trabalho próprio na fila da venda.
  perform pg_advisory_xact_lock(hashtext('fiscal_print:' || coalesce(v_order::text, p_id::text)));
  select coalesce(max(j.reprint_seq) + 1, 0) into v_seq from public.print_jobs j
   where j.order_id is not distinct from v_order and j.station = 'counter' and j.kind = 'fiscal';
  insert into public.print_jobs (store_id, order_id, station, kind, reprint_seq, payload)
  values (v_doc.store_id, v_order, 'counter', 'fiscal', v_seq, private.fiscal_print_payload(p_id, p_via))
  returning id into v_job;
  return v_job;
end $$;

-- 2.ª via: quem vê dinheiro na loja; fica no registo.
create or replace function public.reprint_fiscal_document(p_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_doc public.fiscal_documents;
  v_job uuid;
begin
  select * into v_doc from public.fiscal_documents where id = p_id;
  if v_doc.id is null then raise exception 'fiscal_document_not_found' using errcode = 'P0404'; end if;
  if not coalesce((select private.auth_can_store(v_doc.store_id)), false)
     or coalesce((select private.auth_role()), '') not in ('owner', 'manager', 'cashier') then
    raise exception 'forbidden' using errcode = 'P0403';
  end if;
  v_job := private.fiscal_enqueue_print(p_id, '2.ª via');
  insert into public.event_log (store_id, type, payload, actor_user_id)
  values (v_doc.store_id, 'fiscal.reprinted', jsonb_build_object('document_id', p_id, 'number', v_doc.full_number, 'job_id', v_job), (select auth.uid()));
  return jsonb_build_object('job_id', v_job);
end $$;

-- ── Emissão (1138) com o adquirente da fila e o talão ───────────────────────
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
    -- 1140: o adquirente pedido antes de pagar (POS, site, conta da mesa), com morada.
    v_buyer := coalesce(p_buyer, private.fiscal_buyer_for(p_order_ids));
  end if;
  if coalesce(jsonb_array_length(v_lines), 0) = 0 then raise exception 'fiscal_no_lines' using errcode = 'P0400'; end if;
  if coalesce(v_buyer ->> 'nuit', '') <> '' and (v_buyer ->> 'nuit') !~ '^[0-9]{9}$' then
    raise exception 'fiscal_invalid_nuit' using errcode = 'P0400';
  end if;

  v_bp := case when v_cfg.regime = 'normal' then v_cfg.vat_bp else 0 end;
  v_exemption := case v_cfg.regime when 'normal' then null when 'ispc' then 'IVA não aplicável — regime ISPC' else btrim(v_cfg.exemption_reason) end;
  v_issuer := jsonb_build_object(
    'name', v_cfg.legal_name, 'nuit', v_cfg.nuit, 'address', v_cfg.address, 'regime', v_cfg.regime,
    'at_certificate', v_cfg.at_certificate, 'store_name', v_store.name, 'store_address', v_store.address, 'store_phone', v_store.phone);

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

  -- 1140: o talão sai sozinho na loja. Best-effort (regra 1): falhar a fila não desfaz o documento.
  if v_cfg.auto_print then
    begin
      perform private.fiscal_enqueue_print(v_id, 'Original');
    exception when others then
      insert into public.event_log (store_id, order_id, type, payload)
      values (p_store_id, p_order_ids[1], 'print.enqueue_failed', jsonb_build_object('document_id', v_id, 'kind', 'fiscal', 'sqlstate', sqlstate));
    end;
  end if;
  return v_id;
end $$;

-- ── Reemissão com morada ────────────────────────────────────────────────────
create or replace function public.fiscal_reissue(p_order_id uuid, p_nuit text, p_name text, p_address text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_doc public.fiscal_documents;
  v_buyer jsonb;
  v_orders uuid[];
  v_new uuid;
begin
  select d.* into v_doc from public.fiscal_documents d where d.id = private.fiscal_active_document(p_order_id);
  if v_doc.id is null then raise exception 'fiscal_document_not_found' using errcode = 'P0404'; end if;
  if not coalesce((select private.auth_can_store(v_doc.store_id)), false)
     or coalesce((select private.auth_role()), '') not in ('owner', 'manager') then
    raise exception 'forbidden' using errcode = 'P0403';
  end if;
  v_buyer := private.fiscal_clean_buyer(p_nuit, p_name, p_address);
  select array_agg(x.order_id) into v_orders from public.fiscal_document_orders x where x.document_id = v_doc.id;
  if private.fiscal_emit(v_doc.store_id, 'NC', v_orders, v_doc.id, 'Reemissão com o NUIT do adquirente', null, false) is null then
    raise exception 'fiscal_already_credited' using errcode = 'P0409';
  end if;
  v_new := private.fiscal_emit(v_doc.store_id, 'FR', v_orders, v_doc.id, 'Substitui ' || v_doc.full_number, v_buyer, false);
  insert into public.event_log (store_id, order_id, type, payload, actor_user_id)
  values (v_doc.store_id, p_order_id, 'fiscal.reissued', jsonb_build_object('from', v_doc.full_number, 'document_id', v_new), (select auth.uid()));
  return private.fiscal_document_json(v_new);
end $$;

create or replace function public.fiscal_reissue(p_order_id uuid, p_nuit text, p_name text) returns jsonb
language sql security definer set search_path = '' as $$
  select public.fiscal_reissue(p_order_id, p_nuit, p_name, null);
$$;

-- ── Consulta ────────────────────────────────────────────────────────────────
-- O documento inteiro, para o A4 e para o ecrã. A cozinha não vê dinheiro.
create or replace function public.get_fiscal_document(p_id uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_doc public.fiscal_documents;
begin
  select * into v_doc from public.fiscal_documents where id = p_id;
  if v_doc.id is null then raise exception 'fiscal_document_not_found' using errcode = 'P0404'; end if;
  if not coalesce((select private.auth_can_store(v_doc.store_id)), false)
     or coalesce((select private.auth_role()), '') not in ('owner', 'manager', 'cashier') then
    raise exception 'forbidden' using errcode = 'P0403';
  end if;
  return private.fiscal_print_payload(p_id, 'Original') - 'template' - 'format_version';
end $$;

-- Lista paginada, por loja e período, com pesquisa por número, NUIT ou nome.
create or replace function public.list_fiscal_documents(
  p_store_id uuid, p_from date, p_to date, p_search text default null, p_type text default null,
  p_limit integer default 50, p_offset integer default 0
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_role text := coalesce((select private.auth_role()), '');
  v_q text := nullif(btrim(coalesce(p_search, '')), '');
  v_rows jsonb;
  v_total integer;
begin
  if v_role not in ('owner', 'manager', 'cashier') then raise exception 'forbidden' using errcode = 'P0403'; end if;
  if p_store_id is not null and not coalesce((select private.auth_can_store(p_store_id)), false) then
    raise exception 'forbidden' using errcode = 'P0403';
  end if;
  with base as (
    select d.* from public.fiscal_documents d
     where (p_store_id is null or d.store_id = p_store_id)
       and (select private.auth_can_store(d.store_id))
       and d.issue_date between coalesce(p_from, '-infinity'::date) and coalesce(p_to, 'infinity'::date)
       and (p_type is null or d.doc_type = p_type)
       and (v_q is null or d.full_number ilike '%' || v_q || '%' or coalesce(d.buyer ->> 'nuit', '') like '%' || regexp_replace(v_q, '\s', '', 'g') || '%'
            or coalesce(d.buyer ->> 'name', '') ilike '%' || v_q || '%')
  )
  select count(*)::integer,
         coalesce((select jsonb_agg(jsonb_build_object(
             'id', b.id, 'store_id', b.store_id, 'doc_type', b.doc_type, 'full_number', b.full_number, 'issue_date', b.issue_date,
             'emitted_at', b.emitted_at, 'buyer_name', b.buyer ->> 'name', 'buyer_nuit', b.buyer ->> 'nuit', 'total_cents', b.total_cents,
             'vat_cents', b.vat_cents, 'origin_number', b.origin_number, 'payment_method', b.payment_method,
             'voided', exists (select 1 from public.fiscal_documents n where n.origin_id = b.id and n.doc_type = 'NC'),
             'order_ids', (select jsonb_agg(x.order_id) from public.fiscal_document_orders x where x.document_id = b.id))
           order by b.emitted_at desc, b.number desc)
           from (select * from base order by emitted_at desc, number desc
                  limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0)) b), '[]'::jsonb)
    into v_total, v_rows
    from base;
  return jsonb_build_object('total', v_total, 'rows', v_rows);
end $$;

-- O POS e o checkout precisam de saber se pedem NUIT: só o interruptor, sem dados da empresa.
create or replace function public.fiscal_status() returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('active', coalesce((select s.active from public.fiscal_settings s where s.id = 1), false));
$$;

-- Definições: acrescenta a impressão automática (o resto como na 1138).
create or replace function public.get_fiscal_settings() returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v public.fiscal_settings;
begin
  if not coalesce((select private.auth_is_owner()), false) then raise exception 'forbidden' using errcode = 'P0403'; end if;
  select * into v from public.fiscal_settings where id = 1;
  return jsonb_build_object(
    'active', v.active, 'legal_name', v.legal_name, 'nuit', v.nuit, 'address', v.address, 'regime', v.regime,
    'vat_bp', v.vat_bp, 'exemption_reason', v.exemption_reason, 'at_certificate', v.at_certificate, 'active_since', v.active_since,
    'auto_print', v.auto_print,
    'documents', (select count(*) from public.fiscal_documents),
    'pending', case when v.active then (
      select count(*) from (
        select p.order_id from public.payments p
         where p.status = 'confirmed' and p.created_at >= v.active_since
           and not exists (select 1 from public.fiscal_document_orders x where x.order_id = p.order_id)
         group by p.order_id
        having coalesce(private.fiscal_order_paid(p.order_id), false)
           -- Conta de mesa paga a meio não é pendente: factura-se quando fechar.
           and not exists (select 1 from public.table_bills b, unnest(b.order_ids) t(id)
                            where b.order_ids @> array[p.order_id] and not coalesce(private.fiscal_order_paid(t.id), false))
      ) q
    ) else 0 end,
    'failures_24h', (select count(*) from public.event_log e where e.type = 'fiscal.emit_failed' and e.created_at > now() - interval '24 hours'));
end $$;

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
    auto_print = coalesce((p ->> 'auto_print')::boolean, v_old.auto_print),
    active_since = case when v_active and not v_old.active then clock_timestamp() else v_old.active_since end,
    updated_at = now()
  where id = 1;
  insert into public.event_log (type, payload, actor_user_id)
  values ('fiscal.settings_saved', jsonb_build_object('active', v_active, 'was_active', v_old.active, 'regime', v_regime, 'vat_bp', v_bp), (select auth.uid()));
  return public.get_fiscal_settings();
end $$;

revoke all on function private.fiscal_clean_buyer(text, text, text) from public, anon, authenticated;
revoke all on function private.fiscal_stage_buyer(uuid, uuid, jsonb, uuid) from public, anon, authenticated;
revoke all on function private.fiscal_buyer_for(uuid[]) from public, anon, authenticated;
revoke all on function private.fiscal_print_payload(uuid, text) from public, anon, authenticated;
revoke all on function private.fiscal_enqueue_print(uuid, text) from public, anon, authenticated;
revoke all on function public.stage_fiscal_buyer(uuid, uuid, text, text, text) from public, anon;
revoke all on function public.stage_checkout_fiscal_buyer(text, uuid, text, text, text) from public;
revoke all on function public.reprint_fiscal_document(uuid) from public, anon;
revoke all on function public.fiscal_reissue(uuid, text, text, text) from public, anon;
revoke all on function public.fiscal_reissue(uuid, text, text) from public, anon;
revoke all on function public.get_fiscal_document(uuid) from public, anon;
revoke all on function public.list_fiscal_documents(uuid, date, date, text, text, integer, integer) from public, anon;
revoke all on function public.fiscal_status() from public;
grant execute on function public.stage_fiscal_buyer(uuid, uuid, text, text, text), public.reprint_fiscal_document(uuid),
  public.fiscal_reissue(uuid, text, text, text), public.fiscal_reissue(uuid, text, text), public.get_fiscal_document(uuid),
  public.list_fiscal_documents(uuid, date, date, text, text, integer, integer) to authenticated, service_role;
grant execute on function public.stage_checkout_fiscal_buyer(text, uuid, text, text, text), public.fiscal_status() to anon, authenticated, service_role;

notify pgrst, 'reload schema';
