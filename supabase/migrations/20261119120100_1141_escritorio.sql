-- 1141 — Escritório: a papelada do restaurante num só sítio (ADR 0014).
--
--   · Compras com IVA: as facturas dos fornecedores, com foto, para o IVA a deduzir do mês.
--   · Obrigações: prazos (e-Declaração, IVA, INSS…) com os dias definidos com o contabilista, e o que já foi feito.
--   · Arquivo: alvará, licenças, certidões, contratos, com validade e aviso antes de caducar.
--   · Pessoal: a ficha fiscal de cada trabalhador (NUIT, INSS), só para o dono.
--   · Resumo do mês: vendas, IVA liquidado, IVA das compras e documentos, por loja.
--   · Contabilista: acesso só de leitura por ligação com token opaco (como o garçom e o estafeta), sem conta nem perfil.
--   · Avisos ao dono pelo cron do escritório.
--
-- Nada aqui é fiscal no sentido do art. 27.º: as compras são registos internos, editáveis com rasto. Os documentos
-- emitidos continuam imutáveis (1138). Escrita só por RPC; leitura por loja e por perfil (regra 3).

-- ── Ficheiros (privado) ─────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('office-files', 'office-files', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists office_files_manage on storage.objects;
create policy office_files_manage on storage.objects for all to authenticated
  using (bucket_id = 'office-files' and coalesce((select private.auth_role()), '') in ('owner', 'manager'))
  with check (bucket_id = 'office-files' and coalesce((select private.auth_role()), '') in ('owner', 'manager'));

create or replace function private.office_can(p_store_id uuid, p_owner_only boolean) returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when coalesce((select private.auth_role()), '') = 'owner' then true
    when p_owner_only then false
    when coalesce((select private.auth_role()), '') = 'manager' then p_store_id is not null and coalesce((select private.auth_can_store(p_store_id)), false)
    else false end;
$$;

-- ── Compras (facturas de fornecedores) ──────────────────────────────────────
create table if not exists public.supplier_invoices (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id),
  supplier_name text not null check (btrim(supplier_name) <> '' and length(supplier_name) <= 160),
  supplier_nuit text check (supplier_nuit is null or supplier_nuit ~ '^[0-9]{9}$'),
  invoice_number text not null check (btrim(invoice_number) <> '' and length(invoice_number) <= 60),
  invoice_date date not null,
  category text not null default 'mercadoria' check (category in ('mercadoria', 'servicos', 'equipamento', 'renda', 'utilidades', 'outros')),
  total_cents integer not null check (total_cents > 0),
  vat_cents integer not null default 0 check (vat_cents >= 0),
  deductible boolean not null default true,
  file_path text check (file_path is null or file_path ~ '^purchases/[0-9a-f-]{36}/[A-Za-z0-9._-]{1,120}$'),
  notes text check (notes is null or length(notes) <= 500),
  status text not null default 'active' check (status in ('active', 'voided')),
  void_reason text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  constraint supplier_invoices_vat_le_total check (vat_cents < total_cents),
  constraint supplier_invoices_void_reason check (status <> 'voided' or btrim(coalesce(void_reason, '')) <> '')
);
create unique index if not exists supplier_invoices_unique_active
  on public.supplier_invoices (store_id, coalesce(supplier_nuit, lower(btrim(supplier_name))), lower(btrim(invoice_number))) where status = 'active';
create index if not exists supplier_invoices_store_date_idx on public.supplier_invoices (store_id, invoice_date);

-- ── Obrigações ──────────────────────────────────────────────────────────────
create table if not exists public.office_obligations (
  id uuid primary key default gen_random_uuid(),
  store_id uuid references public.stores(id),      -- null = da empresa
  title text not null check (btrim(title) <> '' and length(title) <= 120),
  description text check (description is null or length(description) <= 600),
  recurrence text not null check (recurrence in ('monthly', 'yearly', 'once')),
  due_rule text not null default 'day' check (due_rule in ('day', 'last_business_day')),
  due_day smallint check (due_day between 1 and 31),
  due_month smallint check (due_month between 1 and 12),
  due_date date,
  -- O mês a que a obrigação respeita fica no mês anterior ao prazo (ex.: IVA de Outubro, entregue em Novembro).
  refers_to_previous boolean not null default true,
  remind_days smallint not null default 7 check (remind_days between 0 and 60),
  responsible text check (responsible is null or length(responsible) <= 80),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint office_obligations_rule check (
    (recurrence = 'once' and due_date is not null)
    or (recurrence = 'monthly' and (due_rule = 'last_business_day' or due_day is not null))
    or (recurrence = 'yearly' and due_month is not null and (due_rule = 'last_business_day' or due_day is not null))
  )
);
create table if not exists public.office_obligation_done (
  obligation_id uuid not null references public.office_obligations(id) on delete cascade,
  period text not null check (period ~ '^([0-9]{4}(-[0-9]{2})?|once)$'),
  done_at timestamptz not null default now(),
  done_by uuid,
  note text check (note is null or length(note) <= 300),
  primary key (obligation_id, period)
);

-- ── Arquivo ─────────────────────────────────────────────────────────────────
create table if not exists public.office_documents (
  id uuid primary key default gen_random_uuid(),
  store_id uuid references public.stores(id),
  title text not null check (btrim(title) <> '' and length(title) <= 120),
  category text not null default 'licenca' check (category in ('licenca', 'alvara', 'certidao', 'contrato', 'seguro', 'seguranca', 'fiscal', 'outros')),
  issuer text check (issuer is null or length(issuer) <= 120),
  reference text check (reference is null or length(reference) <= 80),
  issued_on date,
  expires_on date,
  remind_days smallint not null default 30 check (remind_days between 0 and 180),
  file_path text check (file_path is null or file_path ~ '^documents/[0-9a-f-]{36}/[A-Za-z0-9._-]{1,120}$'),
  notes text check (notes is null or length(notes) <= 500),
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Pessoal (só o dono: salário e documentos pessoais) ──────────────────────
create table if not exists public.office_employees (
  id uuid primary key default gen_random_uuid(),
  store_id uuid references public.stores(id),
  full_name text not null check (btrim(full_name) <> '' and length(full_name) <= 120),
  job_title text check (job_title is null or length(job_title) <= 80),
  nuit text check (nuit is null or nuit ~ '^[0-9]{9}$'),
  inss_number text check (inss_number is null or length(inss_number) <= 30),
  id_document text check (id_document is null or length(id_document) <= 40),
  phone text check (phone is null or length(phone) <= 30),
  hired_on date,
  left_on date,
  base_salary_cents integer check (base_salary_cents is null or base_salary_cents >= 0),
  notes text check (notes is null or length(notes) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint office_employees_dates check (left_on is null or hired_on is null or left_on >= hired_on)
);

-- ── Acesso do contabilista ──────────────────────────────────────────────────
create table if not exists public.accountant_access (
  id uuid primary key default gen_random_uuid(),
  label text not null check (btrim(label) <> '' and length(label) <= 80),
  token_hash text not null unique,
  created_by uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz
);

-- ── RLS: leitura por perfil e loja; escrita só pelas funções ────────────────
alter table public.supplier_invoices enable row level security;
alter table public.office_obligations enable row level security;
alter table public.office_obligation_done enable row level security;
alter table public.office_documents enable row level security;
alter table public.office_employees enable row level security;
alter table public.accountant_access enable row level security;
revoke all on public.supplier_invoices, public.office_obligations, public.office_obligation_done, public.office_documents,
  public.office_employees, public.accountant_access from public, anon, authenticated;
grant select on public.supplier_invoices, public.office_obligations, public.office_obligation_done, public.office_documents to authenticated;
grant select on public.office_employees to authenticated;
grant all on public.supplier_invoices, public.office_obligations, public.office_obligation_done, public.office_documents,
  public.office_employees, public.accountant_access to service_role;

drop policy if exists supplier_invoices_read on public.supplier_invoices;
create policy supplier_invoices_read on public.supplier_invoices for select to authenticated using ((select private.office_can(store_id, false)));
drop policy if exists office_obligations_read on public.office_obligations;
create policy office_obligations_read on public.office_obligations for select to authenticated
  using (coalesce((select private.auth_role()), '') in ('owner', 'manager') and (store_id is null or (select private.office_can(store_id, false))));
drop policy if exists office_obligation_done_read on public.office_obligation_done;
create policy office_obligation_done_read on public.office_obligation_done for select to authenticated
  using (exists (select 1 from public.office_obligations o where o.id = obligation_id));
drop policy if exists office_documents_read on public.office_documents;
create policy office_documents_read on public.office_documents for select to authenticated
  using (coalesce((select private.auth_role()), '') in ('owner', 'manager') and (store_id is null or (select private.office_can(store_id, false))));
drop policy if exists office_employees_read on public.office_employees;
create policy office_employees_read on public.office_employees for select to authenticated using ((select private.auth_is_owner()));

-- ── Escrita ─────────────────────────────────────────────────────────────────
create or replace function public.save_supplier_invoice(p jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_old public.supplier_invoices;
  v_store uuid := (p ->> 'store_id')::uuid;
  v_nuit text := nullif(regexp_replace(coalesce(p ->> 'supplier_nuit', ''), '\s', '', 'g'), '');
  v_row public.supplier_invoices;
begin
  if v_id is not null then
    select * into v_old from public.supplier_invoices where id = v_id;
    if v_old.id is null then raise exception 'not_found' using errcode = 'P0404'; end if;
    if v_old.status <> 'active' then raise exception 'office_invoice_voided' using errcode = 'P0409'; end if;
    v_store := v_old.store_id;
  end if;
  if not private.office_can(v_store, false) then raise exception 'forbidden' using errcode = 'P0403'; end if;
  if v_nuit is not null and v_nuit !~ '^[0-9]{9}$' then raise exception 'office_invalid_nuit' using errcode = 'P0400'; end if;
  if (p ->> 'invoice_date')::date > (now() at time zone 'Africa/Maputo')::date then raise exception 'office_future_date' using errcode = 'P0400'; end if;
  if v_id is null then
    insert into public.supplier_invoices (store_id, supplier_name, supplier_nuit, invoice_number, invoice_date, category, total_cents, vat_cents,
                                          deductible, file_path, notes, created_by, updated_by)
    values (v_store, btrim(p ->> 'supplier_name'), v_nuit, btrim(p ->> 'invoice_number'), (p ->> 'invoice_date')::date,
            coalesce(nullif(p ->> 'category', ''), 'mercadoria'), (p ->> 'total_cents')::integer, coalesce((p ->> 'vat_cents')::integer, 0),
            coalesce((p ->> 'deductible')::boolean, true), nullif(p ->> 'file_path', ''), nullif(btrim(coalesce(p ->> 'notes', '')), ''),
            (select auth.uid()), (select auth.uid()))
    returning * into v_row;
  else
    update public.supplier_invoices set
      supplier_name = btrim(p ->> 'supplier_name'), supplier_nuit = v_nuit, invoice_number = btrim(p ->> 'invoice_number'),
      invoice_date = (p ->> 'invoice_date')::date, category = coalesce(nullif(p ->> 'category', ''), category),
      total_cents = (p ->> 'total_cents')::integer, vat_cents = coalesce((p ->> 'vat_cents')::integer, 0),
      deductible = coalesce((p ->> 'deductible')::boolean, deductible), file_path = coalesce(nullif(p ->> 'file_path', ''), file_path),
      notes = nullif(btrim(coalesce(p ->> 'notes', '')), ''), updated_by = (select auth.uid()), updated_at = now()
    where id = v_id returning * into v_row;
  end if;
  insert into public.event_log (store_id, type, payload, actor_user_id)
  values (v_row.store_id, case when v_id is null then 'office.purchase_created' else 'office.purchase_updated' end,
          jsonb_build_object('id', v_row.id, 'supplier', v_row.supplier_name, 'number', v_row.invoice_number, 'total_cents', v_row.total_cents,
                             'vat_cents', v_row.vat_cents, 'before', case when v_id is null then null else to_jsonb(v_old) - 'notes' end),
          (select auth.uid()));
  return to_jsonb(v_row);
exception when unique_violation then
  raise exception 'office_duplicate_invoice' using errcode = 'P0409';
end $$;

create or replace function public.void_supplier_invoice(p_id uuid, p_reason text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_row public.supplier_invoices;
begin
  select * into v_row from public.supplier_invoices where id = p_id;
  if v_row.id is null then raise exception 'not_found' using errcode = 'P0404'; end if;
  if not private.office_can(v_row.store_id, false) then raise exception 'forbidden' using errcode = 'P0403'; end if;
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'office_reason_required' using errcode = 'P0400'; end if;
  update public.supplier_invoices set status = 'voided', void_reason = left(btrim(p_reason), 200), updated_by = (select auth.uid()), updated_at = now()
   where id = p_id and status = 'active' returning * into v_row;
  insert into public.event_log (store_id, type, payload, actor_user_id)
  values (v_row.store_id, 'office.purchase_voided', jsonb_build_object('id', p_id, 'reason', v_row.void_reason), (select auth.uid()));
  return to_jsonb(v_row);
end $$;

create or replace function public.save_office_obligation(p jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_row public.office_obligations;
begin
  if not coalesce((select private.auth_is_owner()), false) then raise exception 'forbidden' using errcode = 'P0403'; end if;
  if v_id is null then
    insert into public.office_obligations (store_id, title, description, recurrence, due_rule, due_day, due_month, due_date,
                                           refers_to_previous, remind_days, responsible, active)
    values (nullif(p ->> 'store_id', '')::uuid, btrim(p ->> 'title'), nullif(btrim(coalesce(p ->> 'description', '')), ''), p ->> 'recurrence',
            coalesce(nullif(p ->> 'due_rule', ''), 'day'), nullif(p ->> 'due_day', '')::smallint, nullif(p ->> 'due_month', '')::smallint,
            nullif(p ->> 'due_date', '')::date, coalesce((p ->> 'refers_to_previous')::boolean, true), coalesce((p ->> 'remind_days')::smallint, 7),
            nullif(btrim(coalesce(p ->> 'responsible', '')), ''), coalesce((p ->> 'active')::boolean, true))
    returning * into v_row;
  else
    update public.office_obligations set
      store_id = nullif(p ->> 'store_id', '')::uuid, title = btrim(p ->> 'title'), description = nullif(btrim(coalesce(p ->> 'description', '')), ''),
      recurrence = p ->> 'recurrence', due_rule = coalesce(nullif(p ->> 'due_rule', ''), 'day'), due_day = nullif(p ->> 'due_day', '')::smallint,
      due_month = nullif(p ->> 'due_month', '')::smallint, due_date = nullif(p ->> 'due_date', '')::date,
      refers_to_previous = coalesce((p ->> 'refers_to_previous')::boolean, true), remind_days = coalesce((p ->> 'remind_days')::smallint, 7),
      responsible = nullif(btrim(coalesce(p ->> 'responsible', '')), ''), active = coalesce((p ->> 'active')::boolean, true)
    where id = v_id returning * into v_row;
    if v_row.id is null then raise exception 'not_found' using errcode = 'P0404'; end if;
  end if;
  insert into public.event_log (type, payload, actor_user_id)
  values ('office.obligation_saved', jsonb_build_object('id', v_row.id, 'title', v_row.title, 'active', v_row.active), (select auth.uid()));
  return to_jsonb(v_row);
end $$;

-- Marcar feito (ou desfazer) um período. Gerente marca as da sua loja; as da empresa, só o dono.
create or replace function public.mark_office_obligation(p_id uuid, p_period text, p_done boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ob public.office_obligations;
begin
  select * into v_ob from public.office_obligations where id = p_id;
  if v_ob.id is null then raise exception 'not_found' using errcode = 'P0404'; end if;
  if not private.office_can(v_ob.store_id, v_ob.store_id is null) then raise exception 'forbidden' using errcode = 'P0403'; end if;
  if p_period !~ '^([0-9]{4}(-[0-9]{2})?|once)$' then raise exception 'office_invalid_period' using errcode = 'P0400'; end if;
  if p_done then
    insert into public.office_obligation_done (obligation_id, period, done_by, note)
    values (p_id, p_period, (select auth.uid()), nullif(left(btrim(coalesce(p_note, '')), 300), ''))
    on conflict (obligation_id, period) do update set note = excluded.note;
  else
    delete from public.office_obligation_done where obligation_id = p_id and period = p_period;
  end if;
  insert into public.event_log (store_id, type, payload, actor_user_id)
  values (v_ob.store_id, 'office.obligation_marked', jsonb_build_object('id', p_id, 'period', p_period, 'done', p_done), (select auth.uid()));
  return jsonb_build_object('id', p_id, 'period', p_period, 'done', p_done);
end $$;

create or replace function public.save_office_document(p jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_store uuid := nullif(p ->> 'store_id', '')::uuid;
  v_row public.office_documents;
begin
  if v_id is not null then
    select store_id into v_store from public.office_documents where id = v_id;
    if not found then raise exception 'not_found' using errcode = 'P0404'; end if;
  end if;
  if not private.office_can(v_store, v_store is null) then raise exception 'forbidden' using errcode = 'P0403'; end if;
  if v_id is null then
    insert into public.office_documents (store_id, title, category, issuer, reference, issued_on, expires_on, remind_days, file_path, notes)
    values (v_store, btrim(p ->> 'title'), coalesce(nullif(p ->> 'category', ''), 'outros'), nullif(btrim(coalesce(p ->> 'issuer', '')), ''),
            nullif(btrim(coalesce(p ->> 'reference', '')), ''), nullif(p ->> 'issued_on', '')::date, nullif(p ->> 'expires_on', '')::date,
            coalesce((p ->> 'remind_days')::smallint, 30), nullif(p ->> 'file_path', ''), nullif(btrim(coalesce(p ->> 'notes', '')), ''))
    returning * into v_row;
  else
    update public.office_documents set
      title = btrim(p ->> 'title'), category = coalesce(nullif(p ->> 'category', ''), category), issuer = nullif(btrim(coalesce(p ->> 'issuer', '')), ''),
      reference = nullif(btrim(coalesce(p ->> 'reference', '')), ''), issued_on = nullif(p ->> 'issued_on', '')::date,
      expires_on = nullif(p ->> 'expires_on', '')::date, remind_days = coalesce((p ->> 'remind_days')::smallint, remind_days),
      file_path = coalesce(nullif(p ->> 'file_path', ''), file_path), notes = nullif(btrim(coalesce(p ->> 'notes', '')), ''),
      archived = coalesce((p ->> 'archived')::boolean, archived), updated_at = now()
    where id = v_id returning * into v_row;
  end if;
  insert into public.event_log (store_id, type, payload, actor_user_id)
  values (v_row.store_id, 'office.document_saved', jsonb_build_object('id', v_row.id, 'title', v_row.title, 'expires_on', v_row.expires_on), (select auth.uid()));
  return to_jsonb(v_row);
end $$;

create or replace function public.save_office_employee(p jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_nuit text := nullif(regexp_replace(coalesce(p ->> 'nuit', ''), '\s', '', 'g'), '');
  v_row public.office_employees;
begin
  if not coalesce((select private.auth_is_owner()), false) then raise exception 'forbidden' using errcode = 'P0403'; end if;
  if v_nuit is not null and v_nuit !~ '^[0-9]{9}$' then raise exception 'office_invalid_nuit' using errcode = 'P0400'; end if;
  if v_id is null then
    insert into public.office_employees (store_id, full_name, job_title, nuit, inss_number, id_document, phone, hired_on, left_on, base_salary_cents, notes)
    values (nullif(p ->> 'store_id', '')::uuid, btrim(p ->> 'full_name'), nullif(btrim(coalesce(p ->> 'job_title', '')), ''), v_nuit,
            nullif(btrim(coalesce(p ->> 'inss_number', '')), ''), nullif(btrim(coalesce(p ->> 'id_document', '')), ''),
            nullif(btrim(coalesce(p ->> 'phone', '')), ''), nullif(p ->> 'hired_on', '')::date, nullif(p ->> 'left_on', '')::date,
            nullif(p ->> 'base_salary_cents', '')::integer, nullif(btrim(coalesce(p ->> 'notes', '')), ''))
    returning * into v_row;
  else
    update public.office_employees set
      store_id = nullif(p ->> 'store_id', '')::uuid, full_name = btrim(p ->> 'full_name'), job_title = nullif(btrim(coalesce(p ->> 'job_title', '')), ''),
      nuit = v_nuit, inss_number = nullif(btrim(coalesce(p ->> 'inss_number', '')), ''), id_document = nullif(btrim(coalesce(p ->> 'id_document', '')), ''),
      phone = nullif(btrim(coalesce(p ->> 'phone', '')), ''), hired_on = nullif(p ->> 'hired_on', '')::date, left_on = nullif(p ->> 'left_on', '')::date,
      base_salary_cents = nullif(p ->> 'base_salary_cents', '')::integer, notes = nullif(btrim(coalesce(p ->> 'notes', '')), ''), updated_at = now()
    where id = v_id returning * into v_row;
    if v_row.id is null then raise exception 'not_found' using errcode = 'P0404'; end if;
  end if;
  -- Sem o salário nem os documentos no registo: o registo diz que mudou, não o quê.
  insert into public.event_log (store_id, type, payload, actor_user_id)
  values (v_row.store_id, 'office.employee_saved', jsonb_build_object('id', v_row.id), (select auth.uid()));
  return to_jsonb(v_row);
end $$;

-- ── Resumo do mês ───────────────────────────────────────────────────────────
-- Por loja: documentos e IVA liquidado (FR em vigor menos NC do mês), compras e IVA dedutível, e o saldo estimado.
create or replace function private.office_month_summary(p_year integer, p_month integer, p_stores uuid[]) returns jsonb
language sql stable set search_path = '' as $$
  with periodo as (select make_date(p_year, p_month, 1) as d0, (make_date(p_year, p_month, 1) + interval '1 month')::date as d1),
  docs as (
    select d.store_id,
           count(*) filter (where d.doc_type = 'FR') as fr_count,
           count(*) filter (where d.doc_type = 'NC') as nc_count,
           coalesce(sum(d.total_cents) filter (where d.doc_type = 'FR'), 0) as fr_total,
           coalesce(sum(d.vat_cents) filter (where d.doc_type = 'FR'), 0) as fr_vat,
           coalesce(sum(d.base_cents) filter (where d.doc_type = 'FR'), 0) as fr_base,
           coalesce(sum(d.total_cents) filter (where d.doc_type = 'NC'), 0) as nc_total,
           coalesce(sum(d.vat_cents) filter (where d.doc_type = 'NC'), 0) as nc_vat,
           coalesce(sum(d.base_cents) filter (where d.doc_type = 'NC'), 0) as nc_base
      from public.fiscal_documents d, periodo
     where d.issue_date >= periodo.d0 and d.issue_date < periodo.d1 and d.store_id = any(p_stores)
     group by d.store_id),
  compras as (
    select c.store_id, count(*) as n, coalesce(sum(c.total_cents), 0) as total,
           coalesce(sum(c.vat_cents) filter (where c.deductible), 0) as vat
      from public.supplier_invoices c, periodo
     where c.status = 'active' and c.invoice_date >= periodo.d0 and c.invoice_date < periodo.d1 and c.store_id = any(p_stores)
     group by c.store_id),
  meios as (
    select d.store_id, jsonb_object_agg(coalesce(d.payment_method, 'outro'), d.total) as by_method
      from (select d.store_id, d.payment_method, sum(d.total_cents) as total
              from public.fiscal_documents d, periodo
             where d.doc_type = 'FR' and d.issue_date >= periodo.d0 and d.issue_date < periodo.d1 and d.store_id = any(p_stores)
             group by d.store_id, d.payment_method) d
     group by d.store_id)
  select jsonb_build_object(
    'year', p_year, 'month', p_month,
    'stores', coalesce(jsonb_agg(jsonb_build_object(
      'store_id', s.id, 'store_name', s.short_name,
      'fr_count', coalesce(docs.fr_count, 0), 'nc_count', coalesce(docs.nc_count, 0),
      'sales_total_cents', coalesce(docs.fr_total, 0) - coalesce(docs.nc_total, 0),
      'sales_base_cents', coalesce(docs.fr_base, 0) - coalesce(docs.nc_base, 0),
      'vat_output_cents', coalesce(docs.fr_vat, 0) - coalesce(docs.nc_vat, 0),
      'purchases_count', coalesce(compras.n, 0), 'purchases_total_cents', coalesce(compras.total, 0),
      'vat_input_cents', coalesce(compras.vat, 0),
      'vat_balance_cents', (coalesce(docs.fr_vat, 0) - coalesce(docs.nc_vat, 0)) - coalesce(compras.vat, 0),
      'by_method', coalesce(meios.by_method, '{}'::jsonb)) order by s.sort, s.short_name), '[]'::jsonb))
  from public.stores s
  left join docs on docs.store_id = s.id
  left join compras on compras.store_id = s.id
  left join meios on meios.store_id = s.id
  where s.id = any(p_stores);
$$;

create or replace function public.office_month_summary(p_year integer, p_month integer) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_stores uuid[];
begin
  if coalesce((select private.auth_role()), '') not in ('owner', 'manager') then raise exception 'forbidden' using errcode = 'P0403'; end if;
  if p_month not between 1 and 12 or p_year not between 2020 and 2100 then raise exception 'office_invalid_period' using errcode = 'P0400'; end if;
  select array_agg(s.id) into v_stores from public.stores s where (select private.office_can(s.id, false));
  return private.office_month_summary(p_year, p_month, coalesce(v_stores, '{}'));
end $$;

-- Compras do mês para o contabilista (CSV no painel e no portal).
create or replace function private.office_month_purchases(p_year integer, p_month integer, p_stores uuid[]) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'store', s.short_name, 'supplier_name', c.supplier_name, 'supplier_nuit', c.supplier_nuit, 'invoice_number', c.invoice_number,
      'invoice_date', c.invoice_date, 'category', c.category, 'total_cents', c.total_cents, 'vat_cents', c.vat_cents,
      'deductible', c.deductible, 'has_file', c.file_path is not null) order by c.invoice_date, c.supplier_name), '[]'::jsonb)
    from public.supplier_invoices c join public.stores s on s.id = c.store_id
   where c.status = 'active' and c.store_id = any(p_stores)
     and c.invoice_date >= make_date(p_year, p_month, 1) and c.invoice_date < (make_date(p_year, p_month, 1) + interval '1 month')::date;
$$;

create or replace function public.office_month_purchases(p_year integer, p_month integer) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_stores uuid[];
begin
  if coalesce((select private.auth_role()), '') not in ('owner', 'manager') then raise exception 'forbidden' using errcode = 'P0403'; end if;
  select array_agg(s.id) into v_stores from public.stores s where (select private.office_can(s.id, false));
  return private.office_month_purchases(p_year, p_month, coalesce(v_stores, '{}'));
end $$;

-- ── Contabilista: ligação com token opaco ───────────────────────────────────
-- O token só se vê uma vez, ao criar. Na BD fica o SHA-256 dele.
create or replace function public.create_accountant_access(p_label text, p_days integer default 90) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_token text := encode(extensions.gen_random_bytes(24), 'hex');
  v_row public.accountant_access;
begin
  if not coalesce((select private.auth_is_owner()), false) then raise exception 'forbidden' using errcode = 'P0403'; end if;
  if btrim(coalesce(p_label, '')) = '' then raise exception 'office_label_required' using errcode = 'P0400'; end if;
  insert into public.accountant_access (label, token_hash, created_by, expires_at)
  values (left(btrim(p_label), 80), encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), (select auth.uid()),
          now() + make_interval(days => least(greatest(coalesce(p_days, 90), 1), 366)))
  returning * into v_row;
  insert into public.event_log (type, payload, actor_user_id)
  values ('office.accountant_access_created', jsonb_build_object('id', v_row.id, 'label', v_row.label, 'expires_at', v_row.expires_at), (select auth.uid()));
  return jsonb_build_object('id', v_row.id, 'label', v_row.label, 'expires_at', v_row.expires_at, 'token', v_token);
end $$;

create or replace function public.list_accountant_access() returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not coalesce((select private.auth_is_owner()), false) then raise exception 'forbidden' using errcode = 'P0403'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'label', a.label, 'created_at', a.created_at, 'expires_at', a.expires_at,
                                                        'revoked_at', a.revoked_at, 'last_used_at', a.last_used_at) order by a.created_at desc)
                     from public.accountant_access a), '[]'::jsonb);
end $$;

create or replace function public.revoke_accountant_access(p_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce((select private.auth_is_owner()), false) then raise exception 'forbidden' using errcode = 'P0403'; end if;
  update public.accountant_access set revoked_at = coalesce(revoked_at, now()) where id = p_id;
  insert into public.event_log (type, payload, actor_user_id) values ('office.accountant_access_revoked', jsonb_build_object('id', p_id), (select auth.uid()));
  return public.list_accountant_access();
end $$;

create or replace function private.accountant_check(p_token text) returns public.accountant_access
language plpgsql security definer set search_path = '' as $$
declare
  v_row public.accountant_access;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{48}$' then raise exception 'accountant_invalid' using errcode = 'P0403'; end if;
  select * into v_row from public.accountant_access a
   where a.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex') and a.revoked_at is null and a.expires_at > now();
  if v_row.id is null then raise exception 'accountant_invalid' using errcode = 'P0403'; end if;
  update public.accountant_access set last_used_at = now() where id = v_row.id;
  return v_row;
end $$;

-- O que o contabilista vê: a empresa, as lojas e o resumo dos últimos meses. Nada de pedidos, clientes nem pessoal.
create or replace function public.accountant_portal(p_token text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_acc public.accountant_access := private.accountant_check(p_token);
  v_stores uuid[];
  v_months jsonb := '[]'::jsonb;
  v_now date := (now() at time zone 'Africa/Maputo')::date;
  v_d date;
  i integer;
begin
  select array_agg(s.id) into v_stores from public.stores s;
  for i in 0..5 loop
    v_d := (date_trunc('month', v_now) - make_interval(months => i))::date;
    v_months := v_months || private.office_month_summary(extract(year from v_d)::integer, extract(month from v_d)::integer, coalesce(v_stores, '{}'));
  end loop;
  insert into public.event_log (type, payload) values ('office.accountant_viewed', jsonb_build_object('access_id', v_acc.id));
  return jsonb_build_object(
    'label', v_acc.label, 'expires_at', v_acc.expires_at,
    'company', (select jsonb_build_object('name', f.legal_name, 'nuit', f.nuit, 'address', f.address, 'regime', f.regime,
                                          'active', f.active, 'active_since', f.active_since, 'at_certificate', f.at_certificate)
                  from public.fiscal_settings f where f.id = 1),
    'months', v_months);
end $$;

-- O ficheiro do mês e as compras, para o contabilista descarregar. Fica registado.
create or replace function public.accountant_month_export(p_token text, p_year integer, p_month integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_acc public.accountant_access := private.accountant_check(p_token);
  v_from date := make_date(p_year, p_month, 1);
  v_stores uuid[];
begin
  select array_agg(s.id) into v_stores from public.stores s;
  insert into public.event_log (type, payload) values ('office.accountant_exported', jsonb_build_object('access_id', v_acc.id, 'year', p_year, 'month', p_month));
  return jsonb_build_object(
    'issuer', (select jsonb_build_object('name', s.legal_name, 'nuit', s.nuit, 'address', s.address, 'at_certificate', s.at_certificate)
                 from public.fiscal_settings s where s.id = 1),
    'from', v_from, 'to', (v_from + interval '1 month' - interval '1 day')::date,
    'documents', coalesce((select jsonb_agg(private.fiscal_document_json(d.id) order by d.doc_type, d.series, d.number)
                             from public.fiscal_documents d
                            where d.issue_date >= v_from and d.issue_date < (v_from + interval '1 month')::date), '[]'::jsonb),
    'purchases', private.office_month_purchases(p_year, p_month, coalesce(v_stores, '{}')),
    'summary', private.office_month_summary(p_year, p_month, coalesce(v_stores, '{}')));
end $$;

-- ── Avisos para o cron do escritório ────────────────────────────────────────
-- Prazo de uma obrigação num mês (dia fixo ou último dia útil, seg–sex; feriados não entram).
create or replace function private.office_due_in_month(p_year integer, p_month integer, p_rule text, p_day integer) returns date
language plpgsql immutable set search_path = '' as $$
declare
  v_last date := (make_date(p_year, p_month, 1) + interval '1 month' - interval '1 day')::date;
  v_d date;
begin
  if p_rule = 'last_business_day' then
    v_d := v_last;
    while extract(isodow from v_d) > 5 loop v_d := v_d - 1; end loop;
    return v_d;
  end if;
  return make_date(p_year, p_month, least(coalesce(p_day, 1), extract(day from v_last)::integer));
end $$;

create or replace function public.office_alerts_all() returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone 'Africa/Maputo')::date;
  v_out jsonb := '[]'::jsonb;
  v_ob public.office_obligations;
  v_doc public.office_documents;
  v_due date;
  v_period text;
  v_ref date;
  v_cfg public.fiscal_settings;
  v_pending integer;
  v_failures integer;
  m integer;
begin
  -- Obrigações: o prazo deste mês e o do seguinte (para avisar cedo nos primeiros dias).
  for v_ob in select * from public.office_obligations where active loop
    for m in 0..1 loop
      v_ref := (date_trunc('month', v_today) + make_interval(months => m))::date;
      if v_ob.recurrence = 'once' then
        exit when m = 1;
        v_due := v_ob.due_date; v_period := 'once';
      elsif v_ob.recurrence = 'yearly' then
        continue when extract(month from v_ref)::integer <> v_ob.due_month;
        v_due := private.office_due_in_month(extract(year from v_ref)::integer, v_ob.due_month, v_ob.due_rule, v_ob.due_day);
        v_period := to_char(v_ref - case when v_ob.refers_to_previous then interval '1 year' else interval '0' end, 'YYYY');
      else
        v_due := private.office_due_in_month(extract(year from v_ref)::integer, extract(month from v_ref)::integer, v_ob.due_rule, v_ob.due_day);
        v_period := to_char(v_ref - case when v_ob.refers_to_previous then interval '1 month' else interval '0' end, 'YYYY-MM');
      end if;
      if v_due - v_ob.remind_days <= v_today
         and not exists (select 1 from public.office_obligation_done x where x.obligation_id = v_ob.id and x.period = v_period) then
        v_out := v_out || jsonb_build_object('kind', case when v_due < v_today then 'obligation_overdue' else 'obligation_due' end,
          'store_id', v_ob.store_id, 'key', v_ob.id::text || ':' || v_period, 'title', v_ob.title, 'period', v_period, 'due', v_due,
          'severity', case when v_due < v_today then 'critical' else 'warning' end);
      end if;
    end loop;
  end loop;
  -- Arquivo: a caducar ou caducado.
  for v_doc in select * from public.office_documents where not archived and expires_on is not null and expires_on - remind_days <= v_today loop
    v_out := v_out || jsonb_build_object('kind', case when v_doc.expires_on < v_today then 'document_expired' else 'document_expiring' end,
      'store_id', v_doc.store_id, 'key', v_doc.id::text || ':' || v_doc.expires_on, 'title', v_doc.title, 'due', v_doc.expires_on,
      'severity', case when v_doc.expires_on < v_today then 'critical' else 'warning' end);
  end loop;
  -- Facturação: vendas pagas sem documento há mais de 15 minutos, e falhas nas últimas 24 h.
  select * into v_cfg from public.fiscal_settings where id = 1;
  if coalesce(v_cfg.active, false) then
    select count(*) into v_pending from (
      select p.order_id from public.payments p
       where p.status = 'confirmed' and p.created_at >= v_cfg.active_since and p.created_at < now() - interval '15 minutes'
         and not exists (select 1 from public.fiscal_document_orders x where x.order_id = p.order_id)
       group by p.order_id
      having coalesce(private.fiscal_order_paid(p.order_id), false)
         and not exists (select 1 from public.table_bills b, unnest(b.order_ids) t(id)
                          where b.order_ids @> array[p.order_id] and not coalesce(private.fiscal_order_paid(t.id), false))) q;
    select count(*) into v_failures from public.event_log e where e.type = 'fiscal.emit_failed' and e.created_at > now() - interval '24 hours';
    if v_pending > 0 then
      v_out := v_out || jsonb_build_object('kind', 'fiscal_pending', 'store_id', null, 'key', 'fiscal_pending:' || v_today,
        'title', v_pending || ' venda(s) paga(s) sem factura', 'severity', 'critical');
    end if;
    if v_failures > 0 then
      v_out := v_out || jsonb_build_object('kind', 'fiscal_failures', 'store_id', null, 'key', 'fiscal_failures:' || v_today,
        'title', v_failures || ' falha(s) a emitir factura nas últimas 24 h', 'severity', 'warning');
    end if;
  end if;
  return v_out;
end $$;

-- ── Permissões ──────────────────────────────────────────────────────────────
revoke all on function private.office_can(uuid, boolean) from public, anon, authenticated;
revoke all on function private.office_month_summary(integer, integer, uuid[]) from public, anon, authenticated;
revoke all on function private.office_month_purchases(integer, integer, uuid[]) from public, anon, authenticated;
revoke all on function private.accountant_check(text) from public, anon, authenticated;
revoke all on function private.office_due_in_month(integer, integer, text, integer) from public, anon, authenticated;
grant execute on function private.office_can(uuid, boolean) to authenticated;

do $$
declare f text;
begin
  foreach f in array array[
    'public.save_supplier_invoice(jsonb)', 'public.void_supplier_invoice(uuid, text)', 'public.save_office_obligation(jsonb)',
    'public.mark_office_obligation(uuid, text, boolean, text)', 'public.save_office_document(jsonb)', 'public.save_office_employee(jsonb)',
    'public.office_month_summary(integer, integer)', 'public.office_month_purchases(integer, integer)',
    'public.create_accountant_access(text, integer)', 'public.list_accountant_access()', 'public.revoke_accountant_access(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
revoke all on function public.accountant_portal(text) from public;
revoke all on function public.accountant_month_export(text, integer, integer) from public;
grant execute on function public.accountant_portal(text), public.accountant_month_export(text, integer, integer) to anon, authenticated, service_role;
revoke all on function public.office_alerts_all() from public, anon, authenticated;
grant execute on function public.office_alerts_all() to service_role;

notify pgrst, 'reload schema';
