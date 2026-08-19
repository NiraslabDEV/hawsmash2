-- ============================================================================
-- F1.4 — Feedback e Lista de Espera
-- Tabelas para feedback de pedidos e lista de espera quando a loja está fechada.
-- ============================================================================

-- Tabela de feedback de pedidos
create table if not exists public.order_feedback (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid references public.orders(id) on delete set null,
  rating           int not null check (rating >= 1 and rating <= 5),
  comment          text,
  created_at       timestamptz not null default now()
);

-- RLS para order_feedback
alter table public.order_feedback enable row level security;

-- Staff (authenticated) pode tudo
create policy "staff_all" on public.order_feedback
  for all to authenticated
  using (true)
  with check (true);

-- Tabela de lista de espera
create table if not exists public.waitlist (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  phone            text not null,
  notes            text,
  created_at       timestamptz not null default now()
);

-- RLS para waitlist
alter table public.waitlist enable row level security;

-- Staff (authenticated) pode tudo
create policy "staff_all" on public.waitlist
  for all to authenticated
  using (true)
  with check (true);

-- ============================================================================
-- RPCs públicas (anon) para feedback e waitlist com rate-limit no DB
-- ============================================================================

-- Rate limiting via tabela auxiliar (append-only)
create table if not exists public.rate_limits (
  id               text primary key,  -- hash do identificador (ex: phone + action)
  action           text not null,      -- 'feedback', 'waitlist'
  last_attempt     timestamptz not null default now(),
  attempt_count    int not null default 1
);

-- RLS para rate_limits (apenas escrita, anon não lê)
alter table public.rate_limits enable row level security;

-- Ninguém pode ler rate_limits (privado)
create policy "rate_limits_no_read" on public.rate_limits
  for select to authenticated
  using (false);

-- Anon pode inserir (via RPC com check)
create policy "rate_limits_anon_insert" on public.rate_limits
  for insert to anon
  with check (true);

-- RPC para submeter feedback (com rate-limit por telefone)
create or replace function public.submit_feedback(
  p_order_id uuid,
  p_rating int,
  p_comment text default null,
  p_customer_phone text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rate_key text;
  v_limit_exceeded boolean;
  v_feedback_id uuid;
  v_order_status text;
begin
  -- Validar rating
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    return jsonb_build_object('success', false, 'error', 'invalid_rating');
  end if;

  -- Pedido tem de existir e estar entregue
  select status into v_order_status from orders where id = p_order_id;
  if not found then
    return jsonb_build_object('success', false, 'error', 'order_not_found');
  end if;
  if v_order_status <> 'delivered' then
    return jsonb_build_object('success', false, 'error', 'order_not_delivered');
  end if;

  -- Um feedback por pedido
  if exists (select 1 from order_feedback where order_id = p_order_id) then
    return jsonb_build_object('success', false, 'error', 'feedback_already_submitted');
  end if;

  -- Rate limit: 1 feedback por telefone por hora
  if p_customer_phone is not null then
    v_rate_key := encode(sha256(convert_to(p_customer_phone || '_feedback', 'UTF8')), 'hex');
    
    -- Verificar se excedeu o limite (última tentativa há menos de 1 hora e já tentou 5+ vezes)
    select (last_attempt > now() - interval '1 hour' and attempt_count >= 5) into v_limit_exceeded
    from rate_limits
    where id = v_rate_key;
    
    if v_limit_exceeded then
      return jsonb_build_object('success', false, 'error', 'rate_limit_exceeded');
    end if;
    
    -- Atualizar ou criar rate limit entry
    insert into rate_limits (id, action, last_attempt, attempt_count)
    values (v_rate_key, 'feedback', now(), 1)
    on conflict (id) do update set
      last_attempt = now(),
      attempt_count = rate_limits.attempt_count + 1;
  end if;
  
  -- Inserir feedback
  insert into order_feedback (order_id, rating, comment)
  values (p_order_id, p_rating, p_comment)
  returning id into v_feedback_id;
  
  return jsonb_build_object('success', true, 'feedback_id', v_feedback_id);
end;
$$;

-- RPC para adicionar à lista de espera (com rate-limit por telefone)
create or replace function public.join_waitlist(
  p_name text,
  p_phone text,
  p_notes text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rate_key text;
  v_limit_exceeded boolean;
  v_waitlist_id uuid;
begin
  -- Rate limit: 1 entrada na lista por telefone por 15 minutos
  v_rate_key := encode(sha256(convert_to(p_phone || '_waitlist', 'UTF8')), 'hex');
  
  -- Verificar se excedeu o limite
  select (last_attempt > now() - interval '15 minutes' and attempt_count >= 3) into v_limit_exceeded
  from rate_limits
  where id = v_rate_key;
  
  if v_limit_exceeded then
    return jsonb_build_object('success', false, 'error', 'rate_limit_exceeded');
  end if;
  
  -- Atualizar ou criar rate limit entry
  insert into rate_limits (id, action, last_attempt, attempt_count)
  values (v_rate_key, 'waitlist', now(), 1)
  on conflict (id) do update set
    last_attempt = now(),
    attempt_count = rate_limits.attempt_count + 1;
  
  -- Inserir na lista de espera
  insert into waitlist (name, phone, notes)
  values (p_name, p_phone, p_notes)
  returning id into v_waitlist_id;
  
  return jsonb_build_object('success', true, 'waitlist_id', v_waitlist_id);
end;
$$;

-- RPC para admin listar feedbacks
create or replace function public.admin_list_feedbacks(
  p_limit int default 50,
  p_offset int default 0
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return jsonb_build_object(
    'feedbacks', (
      select coalesce(jsonb_agg(r), '[]'::jsonb)
      from (
        select 
          f.id,
          f.rating,
          f.comment,
          f.created_at,
          o.order_number,
          o.status as order_status,
          o.total_cents,
          o.customer_name,
          o.customer_phone
        from order_feedback f
        left join orders o on o.id = f.order_id
        order by f.created_at desc
        limit p_limit
        offset p_offset
      ) r
    ),
    'total', (
      select count(*) from order_feedback
    )
  );
end;
$$;

-- RPC para admin listar waitlist
create or replace function public.admin_list_waitlist(
  p_limit int default 50,
  p_offset int default 0
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return jsonb_build_object(
    'entries', (
      select coalesce(jsonb_agg(r), '[]'::jsonb)
      from (
        select 
          id,
          name,
          phone,
          notes,
          created_at
        from waitlist
        order by created_at desc
        limit p_limit
        offset p_offset
      ) r
    ),
    'total', (
      select count(*) from waitlist
    )
  );
end;
$$;

-- Permissões para RPCs públicas
revoke all on function public.submit_feedback(uuid, int, text, text) from public;
grant execute on function public.submit_feedback(uuid, int, text, text) to anon;

revoke all on function public.join_waitlist(text, text, text) from public;
grant execute on function public.join_waitlist(text, text, text) to anon;

-- Permissões para RPCs de admin
revoke all on function public.admin_list_feedbacks(int, int) from public;
grant execute on function public.admin_list_feedbacks(int, int) to authenticated;

revoke all on function public.admin_list_waitlist(int, int) from public;
grant execute on function public.admin_list_waitlist(int, int) to authenticated;