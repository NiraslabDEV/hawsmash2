-- HAWSMASH 2.0 — 1096: o resumo do mês ao dono, com a loja no Google.
--
-- Pedido do dono (26 Set): no dia 1 de cada mês o email da casa recebe o
-- resumo do mês que acabou e, no mesmo email, como está cada loja no Google.
--
-- Vendas: as regras do digest diário (f8) e do fecho (1095) — os estados que
-- contam como venda, no fuso de Maputo — com o mês anterior ao lado.
--
-- Google: a nota e o número de avaliações vêm da Places API, lidos pelo
-- servidor no momento do envio. O Google só dá o número de hoje; para dizer
-- quantas avaliações entraram no mês guarda-se uma fotografia por loja e por
-- mês, e o mês é a diferença entre duas fotografias seguidas. Visualizações,
-- chamadas e pedidos de direcções exigem acesso aprovado à API do Perfil de
-- Empresa (B-114) e entram quando houver.
--
-- O perfil é da loja (cada unidade física tem o seu no Google): o Place ID
-- vive em `stores` e muda-se na aba Lojas, pelo dono (CLAUDE §5.6).
--
-- Forward-only: uma coluna, uma tabela e duas funções. Não mexe em dados.

-- ---------------------------------------------------------------------------
-- 1. O perfil de cada loja no Google.
-- ---------------------------------------------------------------------------
alter table public.stores add column if not exists google_place_id text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'stores_google_place_id_format'
      and conrelid = 'public.stores'::regclass
  ) then
    alter table public.stores
      add constraint stores_google_place_id_format
      check (google_place_id is null or google_place_id ~ '^[A-Za-z0-9_-]{10,512}$');
  end if;
end;
$$;

-- Não é segredo: o Place ID é público. O painel lê-o como lê a morada.
grant select (google_place_id) on public.stores to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Fotografia mensal do perfil.
-- ---------------------------------------------------------------------------
create table if not exists public.google_profile_snapshots (
  store_id uuid not null references public.stores(id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  place_id text not null,
  rating numeric(2, 1) null check (rating between 1 and 5),
  review_count integer null check (review_count >= 0),
  captured_at timestamptz not null default now(),
  primary key (store_id, month)
);

comment on table public.google_profile_snapshots is
  'Nota e avaliações de cada loja no Google, uma fotografia por mês (1096). `month` é o mês que a fotografia fecha: a lida a 1 de Outubro guarda-se como Setembro. Escrita só pelo servidor.';

alter table public.google_profile_snapshots enable row level security;

drop policy if exists google_profile_snapshots_select on public.google_profile_snapshots;
create policy google_profile_snapshots_select on public.google_profile_snapshots
for select to authenticated
using ((select private.auth_can_store(store_id)));

-- Escreve só o cron, com a chave de serviço: o número vem do Google, não de
-- quem está no painel.
revoke all on public.google_profile_snapshots from anon;
revoke insert, update, delete on public.google_profile_snapshots from authenticated;
grant select on public.google_profile_snapshots to authenticated;
grant select, insert, update, delete on public.google_profile_snapshots to service_role;

-- ---------------------------------------------------------------------------
-- 3. O resumo do mês — só o cron o lê, com a chave de serviço.
-- ---------------------------------------------------------------------------
-- Sem `p_month`, é o último mês fechado no fuso de Maputo: a 1 de Outubro,
-- Setembro. Com `p_month`, qualquer dia desse mês serve.
create or replace function public.get_monthly_digest(p_month date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_month date := coalesce(
    date_trunc('month', p_month::timestamp)::date,
    (date_trunc('month', now() at time zone 'Africa/Maputo') - interval '1 month')::date
  );
  v_previous date := (v_month - interval '1 month')::date;
  v_start timestamptz := v_month::timestamp at time zone 'Africa/Maputo';
  v_end timestamptz := (v_month + interval '1 month')::timestamp at time zone 'Africa/Maputo';
  v_previous_start timestamptz := v_previous::timestamp at time zone 'Africa/Maputo';
begin
  return jsonb_build_object(
    'month', v_month,
    'previous_month', v_previous,
    'stores', coalesce(
      (
        select jsonb_agg(entry order by entry.sort, entry.store_name)
        from (
          select
            s.id as store_id,
            s.short_name as store_name,
            s.owner_email,
            s.sort,
            s.google_place_id,
            cur.orders_count,
            cur.revenue_cents,
            prev.orders_count as previous_orders_count,
            prev.revenue_cents as previous_revenue_cents,
            (
              select count(*)::integer
              from public.orders o
              where o.store_id = s.id
                and o.created_at >= v_start and o.created_at < v_end
                and o.status = 'cancelled'
            ) as cancelled_count,
            (
              select coalesce(jsonb_object_agg(c.channel, jsonb_build_object(
                'orders', c.orders_count,
                'revenue_cents', c.revenue_cents
              )), '{}'::jsonb)
              from (
                select o.channel, count(*)::integer as orders_count,
                       sum(o.total_cents)::bigint as revenue_cents
                from public.orders o
                where o.store_id = s.id
                  and o.created_at >= v_start and o.created_at < v_end
                  and o.status in ('approved', 'paid', 'in_preparation', 'ready', 'delivered')
                group by o.channel
              ) c
            ) as channels,
            (
              select coalesce(jsonb_object_agg(p.method, p.total), '{}'::jsonb)
              from (
                select pay.method, sum(pay.amount_cents)::bigint as total
                from public.payments pay
                where pay.store_id = s.id
                  and pay.status = 'confirmed'
                  and pay.created_at >= v_start and pay.created_at < v_end
                group by pay.method
              ) p
            ) as payments,
            -- Os cinco mais vendidos, com as regras do fecho (1095).
            (
              select coalesce(jsonb_agg(item.value order by item.position), '[]'::jsonb)
              from jsonb_array_elements(
                private.cash_sold(s.id, v_start, v_end) -> 'items'
              ) with ordinality as item(value, position)
              where item.position <= 5
            ) as top_items,
            (
              select jsonb_build_object(
                'rating', g.rating, 'review_count', g.review_count, 'captured_at', g.captured_at
              )
              from public.google_profile_snapshots g
              where g.store_id = s.id and g.month = v_month
            ) as google_snapshot,
            (
              select jsonb_build_object(
                'rating', g.rating, 'review_count', g.review_count, 'captured_at', g.captured_at
              )
              from public.google_profile_snapshots g
              where g.store_id = s.id and g.month = v_previous
            ) as google_previous
          from public.stores s
          cross join lateral (
            select count(*)::integer as orders_count,
                   coalesce(sum(o.total_cents), 0)::bigint as revenue_cents
            from public.orders o
            where o.store_id = s.id
              and o.created_at >= v_start and o.created_at < v_end
              and o.status in ('approved', 'paid', 'in_preparation', 'ready', 'delivered')
          ) cur
          cross join lateral (
            select count(*)::integer as orders_count,
                   coalesce(sum(o.total_cents), 0)::bigint as revenue_cents
            from public.orders o
            where o.store_id = s.id
              and o.created_at >= v_previous_start and o.created_at < v_start
              and o.status in ('approved', 'paid', 'in_preparation', 'ready', 'delivered')
          ) prev
          where s.active
        ) entry
      ),
      '[]'::jsonb
    )
  );
end;
$$;

revoke all on function public.get_monthly_digest(date) from public, anon, authenticated;
grant execute on function public.get_monthly_digest(date) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Ligar a loja ao seu perfil no Google. Só o dono, com registo.
-- ---------------------------------------------------------------------------
create or replace function public.set_store_google_place(p_store_id uuid, p_place_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_place text := nullif(btrim(coalesce(p_place_id, '')), '');
  v_previous text;
begin
  perform private.assert_staff_admin();

  if v_place is not null and v_place !~ '^[A-Za-z0-9_-]{10,512}$' then
    raise exception 'invalid_google_place_id' using errcode = 'P0007';
  end if;

  select s.google_place_id into v_previous
  from public.stores s
  where s.id = p_store_id
  for update;
  if not found then
    raise exception 'store_not_found' using errcode = 'P0404';
  end if;

  update public.stores s set google_place_id = v_place where s.id = p_store_id;

  insert into public.event_log (store_id, actor_user_id, type, payload)
  values (
    p_store_id,
    v_uid,
    'store.updated',
    jsonb_build_object(
      'fields', jsonb_build_array('google_place_id'),
      'google_place_id', v_place,
      'previous', v_previous
    )
  );

  return jsonb_build_object('store_id', p_store_id, 'google_place_id', v_place);
end;
$$;

revoke all on function public.set_store_google_place(uuid, text) from public, anon;
grant execute on function public.set_store_google_place(uuid, text) to authenticated;
