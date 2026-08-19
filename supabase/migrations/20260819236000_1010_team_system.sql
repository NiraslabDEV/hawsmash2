-- HAWSMASH 2.0 — F8 / 1010: equipa, permissões e painel Sistema.
--
-- Quem entra, quem sai e o que cada um alcança é decisão do dono, e fica
-- registado. O semáforo por loja existe para o sistema avisar sozinho — é o
-- que substitui o telefonema de sábado (CLAUDE §6 e §11.5).

create or replace function private.assert_staff_admin()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated' using errcode = 'P0020';
  end if;
  if not private.auth_is_owner() then
    raise exception 'staff_admin_denied' using errcode = 'P0403';
  end if;
end;
$$;

revoke all on function private.assert_staff_admin() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Equipa
-- ---------------------------------------------------------------------------
create or replace function public.list_staff()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_staff_admin();

  return coalesce(
    (
      select jsonb_agg(entry order by entry.full_name)
      from (
        select
          sp.user_id,
          sp.full_name,
          sp.role,
          sp.active,
          (sp.pin_hash is not null) as has_pin,
          sp.created_at,
          u.email,
          (
            select coalesce(jsonb_agg(jsonb_build_object(
              'store_id', s.id,
              'slug', s.slug,
              'short_name', s.short_name
            ) order by s.sort), '[]'::jsonb)
            from public.staff_stores ss
            join public.stores s on s.id = ss.store_id
            where ss.user_id = sp.user_id
          ) as stores
        from public.staff_profiles sp
        left join auth.users u on u.id = sp.user_id
      ) entry
    ),
    '[]'::jsonb
  );
end;
$$;

revoke all on function public.list_staff() from public, anon;
grant execute on function public.list_staff() to authenticated;

create or replace function public.set_staff_access(
  p_user_id uuid,
  p_role text,
  p_store_ids uuid[],
  p_active boolean default true,
  p_full_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_previous record;
begin
  perform private.assert_staff_admin();

  if p_role not in ('owner', 'manager', 'cashier', 'kitchen') then
    raise exception 'invalid_staff_role' using errcode = 'P0007';
  end if;

  select sp.role, sp.active, sp.full_name
  into v_previous
  from public.staff_profiles sp
  where sp.user_id = p_user_id;

  if not found then
    raise exception 'staff_not_found' using errcode = 'P0404';
  end if;

  -- Um dono não se despromove nem se desactiva a si próprio: sem isto a
  -- instância pode ficar sem ninguém com acesso total.
  if p_user_id = v_uid and (p_role <> 'owner' or not coalesce(p_active, true)) then
    raise exception 'cannot_demote_self' using errcode = 'P0403';
  end if;

  update public.staff_profiles sp
  set role = p_role,
      active = coalesce(p_active, sp.active),
      full_name = coalesce(nullif(btrim(coalesce(p_full_name, '')), ''), sp.full_name)
  where sp.user_id = p_user_id;

  delete from public.staff_stores ss
  where ss.user_id = p_user_id
    and (p_store_ids is null or ss.store_id <> all(p_store_ids));

  if p_store_ids is not null then
    insert into public.staff_stores (user_id, store_id)
    select p_user_id, unnest(p_store_ids)
    on conflict (user_id, store_id) do nothing;
  end if;

  insert into public.event_log (actor_user_id, type, payload)
  values (
    v_uid,
    'staff.access_changed',
    jsonb_build_object(
      'user_id', p_user_id,
      'previous_role', v_previous.role,
      'role', p_role,
      'active', coalesce(p_active, v_previous.active),
      'store_ids', coalesce(to_jsonb(p_store_ids), '[]'::jsonb)
    )
  );

  return jsonb_build_object(
    'user_id', p_user_id,
    'role', p_role,
    'active', coalesce(p_active, v_previous.active)
  );
end;
$$;

revoke all on function public.set_staff_access(uuid, text, uuid[], boolean, text)
  from public, anon;
grant execute on function public.set_staff_access(uuid, text, uuid[], boolean, text)
  to authenticated;

create or replace function public.deactivate_staff(
  p_user_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_reason text := btrim(coalesce(p_reason, ''));
  v_removed integer;
begin
  perform private.assert_staff_admin();

  if length(v_reason) < 3 then
    raise exception 'revoke_reason_required' using errcode = 'P0007';
  end if;
  if p_user_id = v_uid then
    raise exception 'cannot_revoke_self' using errcode = 'P0403';
  end if;

  update public.staff_profiles sp
  set active = false,
      pin_hash = null
  where sp.user_id = p_user_id;

  if not found then
    raise exception 'staff_not_found' using errcode = 'P0404';
  end if;

  -- Remoção imediata: sem linhas em staff_stores, a RLS fecha tudo já.
  with removed as (
    delete from public.staff_stores ss
    where ss.user_id = p_user_id
    returning 1
  )
  select count(*)::integer into v_removed from removed;

  insert into public.event_log (actor_user_id, type, payload)
  values (
    v_uid,
    'staff.access_revoked',
    jsonb_build_object('user_id', p_user_id, 'reason', v_reason, 'stores_removed', v_removed)
  );

  return jsonb_build_object('user_id', p_user_id, 'active', false, 'stores_removed', v_removed);
end;
$$;

revoke all on function public.deactivate_staff(uuid, text) from public, anon;
grant execute on function public.deactivate_staff(uuid, text) to authenticated;

create or replace function public.set_staff_pin(
  p_user_id uuid,
  p_pin text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  perform private.assert_staff_admin();

  if coalesce(p_pin, '') !~ '^[0-9]{4,6}$' then
    raise exception 'invalid_pin_format' using errcode = 'P0007';
  end if;

  update public.staff_profiles sp
  set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf', 10))
  where sp.user_id = p_user_id;

  if not found then
    raise exception 'staff_not_found' using errcode = 'P0404';
  end if;

  insert into public.event_log (actor_user_id, type, payload)
  values (v_uid, 'staff.pin_set', jsonb_build_object('user_id', p_user_id));

  return jsonb_build_object('user_id', p_user_id, 'configured', true);
end;
$$;

revoke all on function public.set_staff_pin(uuid, text) from public, anon;
grant execute on function public.set_staff_pin(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Painel Sistema: um semáforo por loja.
-- ---------------------------------------------------------------------------
create or replace function public.get_system_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_silent_after interval := interval '5 minutes';
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated' using errcode = 'P0020';
  end if;

  return jsonb_build_object(
    'checked_at', now(),
    'silent_after_seconds', extract(epoch from v_silent_after)::integer,
    'stores', coalesce(
      (
        select jsonb_agg(entry order by entry.sort, entry.store_name)
        from (
          select
            s.id as store_id,
            s.slug as store_slug,
            s.short_name as store_name,
            s.sort,
            s.accepting_orders,
            (
              select coalesce(jsonb_agg(jsonb_build_object(
                'id', d.id,
                'kind', d.kind,
                'label', d.label,
                'app_version', d.app_version,
                'last_seen_at', d.last_seen_at,
                'online', d.last_seen_at is not null and d.last_seen_at > now() - v_silent_after
              ) order by d.kind, d.label), '[]'::jsonb)
              from public.devices d
              where d.store_id = s.id and d.active
            ) as devices,
            jsonb_build_object(
              'pending', (
                select count(*)::integer from public.print_jobs pj
                where pj.store_id = s.id and pj.status = 'pending'
              ),
              'failed', (
                select count(*)::integer from public.print_jobs pj
                where pj.store_id = s.id and pj.status = 'failed'
              ),
              'oldest_pending_at', (
                select min(pj.created_at) from public.print_jobs pj
                where pj.store_id = s.id and pj.status = 'pending'
              )
            ) as print_queue,
            (
              select max(o.created_at) from public.orders o where o.store_id = s.id
            ) as last_order_at,
            (
              select count(*)::integer
              from public.store_items si
              where si.store_id = s.id
                and si.track_stock
                and private.stock_level(si.track_stock, si.stock_qty, si.low_stock_qty) <> 'ok'
            ) as stock_alerts,
            exists (
              select 1 from public.cash_sessions cs
              where cs.store_id = s.id and cs.closed_at is null
            ) as cash_open
          from public.stores s
          where s.active
            and private.auth_can_store(s.id)
        ) entry
      ),
      '[]'::jsonb
    )
  );
end;
$$;

revoke all on function public.get_system_status() from public, anon;
grant execute on function public.get_system_status() to authenticated;

-- ---------------------------------------------------------------------------
-- Alertas automáticos (CLAUDE §11.5). A lista é calculada aqui para o painel,
-- para o cron de email/WhatsApp e para o digest — uma regra, um sítio.
-- ---------------------------------------------------------------------------
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
          and private.auth_can_store(d.store_id)
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
          and private.auth_can_store(pj.store_id)
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
          and private.auth_can_store(o.store_id)
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
          and private.auth_can_store(si.store_id)
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
          and private.auth_can_store(s.id)
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

revoke all on function public.list_system_alerts() from public, anon;
grant execute on function public.list_system_alerts() to authenticated, service_role;
