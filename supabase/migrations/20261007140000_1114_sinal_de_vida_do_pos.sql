-- HAWSMASH 2.0 — 1114: o POS passa a dar sinal de vida, e o alerta a medir o
-- que diz medir.
--
-- Medido no LIVE a 07/10, com Maputo a vender e o painel a mostrar quatro
-- `device_silent` críticos:
--
--   Maputo · POS 3e2a…   visto 06/10 21:45  → o terminal está ligado e a vender
--   Maputo · POS 6bc1…   visto 30/09 15:53  → binding abandonado, ainda activo
--   Matola · POS 5992…   visto 02/09 09:27  → loja com `stores.active = false`
--   Matola · bridge 49e… visto 02/09 11:25  → idem
--
-- Nenhum dos quatro era uma avaria. São três defeitos distintos:
--
-- 1. O POS nunca escreve `devices.last_seen_at` por iniciativa própria. Só o
--    `create_counter_sale`, os RPCs de mesa e o lock/unlock por PIN lhe mexem.
--    A bridge tem `bridge_heartbeat` num `setInterval`; o POS não tinha nada.
--    Com o limiar de 5 minutos igual para os dois, "calado" passou a querer
--    dizer "sem venda há 5 minutos" — acende em toda a hora morta e toda a
--    noite. A correcção é o `pos_heartbeat` desta migration, batido a cada
--    60 s pelo terminal.
--
-- 2. O limiar era um só. A bridge é 24/7 e bate a cada 30 s: 5 minutos de
--    silêncio é avaria. O POS é um ecrã que alguém liga, vende offline por
--    desenho (regra 1) e sofre wifi fraco ao balcão: 15 minutos — quinze
--    batidas falhadas seguidas — é que é avaria. Daí o
--    `private.device_silent_after`.
--
-- 3. O ramo `device_silent` juntava-se a `stores` sem olhar para `s.active` —
--    só o `no_sales` o fazia. A Matola está inactiva e continuava a gerar dois
--    críticos há 35 dias. Agora todos os ramos exigem loja activa.
--
-- O custo de não corrigir não é estético: com o painel sempre vermelho deixa-se
-- de olhar para ele, e o dia em que a bridge cair a sério o aviso vai estar no
-- meio de quatro falsos. É o contrário do §11.5.
--
-- Nada aqui toca no caminho da venda. O heartbeat é best-effort (§17): falhar
-- não pode travar nem atrasar uma cobrança.

-- ---------------------------------------------------------------------------
-- Horário: a mesma janela que o ramo `no_sales` já usava, agora num sítio só.
-- Loja sem horário activo configurado conta como aberta — é melhor um aviso a
-- mais do que uma loja mal configurada a silenciar avarias para sempre.
-- ---------------------------------------------------------------------------
create or replace function private.store_open_now(p_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    not exists (
      select 1 from public.store_hours h
      where h.store_id = p_store_id and h.active
    )
    or exists (
      select 1 from public.store_hours h
      where h.store_id = p_store_id
        and h.active
        and h.dow = extract(dow from (now() at time zone 'Africa/Maputo'))::smallint
        and (now() at time zone 'Africa/Maputo')::time >= h.opens
        and (now() at time zone 'Africa/Maputo')::time < h.closes
    );
$$;

revoke all on function private.store_open_now(uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- "A loja está a operar": o horário configurado ou um turno aberto.
--
-- O horário é o que o dono declarou; o turno é o que está a acontecer. Qualquer
-- um dos dois significa que devia haver um POS ligado — e fora dos dois não há
-- nada a avisar, porque de noite o terminal está desligado de propósito. É isto
-- que impede o "POS balcão sem sinal desde 21:45" a piscar a crítico das 22h às
-- 11h, todos os dias.
-- ---------------------------------------------------------------------------
create or replace function private.store_operating_now(p_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.store_open_now(p_store_id)
    or exists (
      select 1 from public.cash_sessions cs
      where cs.store_id = p_store_id and cs.closed_at is null
    );
$$;

revoke all on function private.store_operating_now(uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Quanto silêncio é avaria, por tipo de dispositivo. Uma regra, um sítio: o
-- painel e o cron passam a ler daqui, para dizerem o mesmo.
-- ---------------------------------------------------------------------------
create or replace function private.device_silent_after(p_kind text)
returns interval
language sql
immutable
as $$
  select case p_kind
    when 'bridge' then interval '5 minutes'
    else interval '15 minutes'
  end;
$$;

revoke all on function private.device_silent_after(text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- O sinal de vida do POS.
--
-- Qualquer pessoa da equipa da loja o pode bater — inclusive `cashier`, que a
-- RLS da `devices` não deixa escrever (só manager/owner). Por isso é
-- `security definer`, e por isso valida ele mesmo a loja: a regra 3 continua
-- de pé, ninguém mantém vivo um terminal de outra loja.
--
-- Não mexe em `locked_at`: um POS bloqueado continua ligado, e desbloquear é
-- só com PIN. Não grava `event_log`: são 1440 batidas por terminal por dia, e
-- a auditoria serve para acções sensíveis, não para respiração.
-- ---------------------------------------------------------------------------
create or replace function public.pos_heartbeat(
  p_device_id uuid,
  p_app_version text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_store_id uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0020';
  end if;
  if p_device_id is null then
    raise exception 'device_required' using errcode = 'P0007';
  end if;

  select d.store_id into v_store_id
  from public.devices d
  where d.id = p_device_id
    and d.kind in ('pos', 'kds')
    and d.active
    and private.auth_can_store(d.store_id);

  if not found then
    raise exception 'invalid_or_unauthorised_device' using errcode = 'P0403';
  end if;

  update public.devices d
  set last_seen_at = now(),
      app_version = coalesce(nullif(btrim(p_app_version), ''), d.app_version)
  where d.id = p_device_id;

  return jsonb_build_object(
    'ok', true,
    'device_id', p_device_id,
    'last_seen_at', now()
  );
end;
$$;

revoke all on function public.pos_heartbeat(uuid, text) from public, anon;
grant execute on function public.pos_heartbeat(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Retirar um dispositivo.
--
-- É daqui que vêm os fantasmas: o `bind_pos_device` insere uma linha nova de
-- cada vez que o terminal perde o `localStorage` (cache limpa, PWA
-- reinstalada, browser novo), e nada desactivava a anterior. Em Maputo havia
-- nove linhas de POS, sete desactivadas à mão e uma esquecida a alertar.
--
-- Não se apaga — a linha é histórico de quem vendeu em que terminal (§17).
-- Desactiva-se, com motivo e registo.
-- ---------------------------------------------------------------------------
create or replace function public.retire_device(
  p_device_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_store_id uuid;
  v_kind text;
  v_label text;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0020';
  end if;
  if private.auth_role() not in ('owner', 'manager') then
    raise exception 'retire_device_access_denied' using errcode = 'P0403';
  end if;

  update public.devices d
  set active = false
  where d.id = p_device_id
    and d.active
    and private.auth_can_store(d.store_id)
  returning d.store_id, d.kind, d.label into v_store_id, v_kind, v_label;

  if not found then
    raise exception 'invalid_or_unauthorised_device' using errcode = 'P0403';
  end if;

  insert into public.event_log (store_id, actor_user_id, type, payload)
  values (
    v_store_id,
    v_uid,
    'device.retired',
    jsonb_build_object(
      'device_id', p_device_id,
      'kind', v_kind,
      'label', v_label,
      'reason', nullif(btrim(coalesce(p_reason, '')), '')
    )
  );

  return jsonb_build_object('retired', true, 'device_id', p_device_id);
end;
$$;

revoke all on function public.retire_device(uuid, text) from public, anon;
grant execute on function public.retire_device(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- O `bind_pos_device` deixa de criar fantasmas.
--
-- Ao vincular um terminal, retira os outros POS da mesma loja que já estejam
-- calados há mais de 48 h. Um segundo terminal a sério bate de 60 em 60 s e
-- nunca cai nesta rede; o que cai é a linha que o mesmo PC deixou atrás
-- quando perdeu o `localStorage`. O resto da função é o que era.
-- ---------------------------------------------------------------------------
create or replace function public.bind_pos_device(
  p_store_id uuid,
  p_label text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_label text := btrim(coalesce(p_label, ''));
  v_device_id uuid;
  v_retired uuid[];
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0020';
  end if;
  if private.auth_role() not in ('owner', 'manager') then
    raise exception 'device_binding_access_denied' using errcode = 'P0403';
  end if;
  if not private.auth_can_store(p_store_id) then
    raise exception 'device_binding_store_denied' using errcode = 'P0403';
  end if;
  if length(v_label) < 3 or length(v_label) > 80 then
    raise exception 'invalid_device_label' using errcode = 'P0007';
  end if;

  with abandonados as (
    update public.devices d
    set active = false
    where d.store_id = p_store_id
      and d.kind = 'pos'
      and d.active
      and (d.last_seen_at is null or d.last_seen_at < now() - interval '48 hours')
    returning d.id
  )
  select coalesce(array_agg(id), '{}'::uuid[]) into v_retired from abandonados;

  if array_length(v_retired, 1) > 0 then
    insert into public.event_log (store_id, actor_user_id, type, payload)
    values (
      p_store_id,
      v_uid,
      'device.retired',
      jsonb_build_object(
        'device_ids', to_jsonb(v_retired),
        'kind', 'pos',
        'reason', 'binding_substituido'
      )
    );
  end if;

  insert into public.devices (
    store_id, kind, label, device_key_hash, locked_at, created_by
  ) values (
    p_store_id,
    'pos',
    v_label,
    encode(
      extensions.digest(
        gen_random_uuid()::text || ':' || clock_timestamp()::text,
        'sha256'
      ),
      'hex'
    ),
    now(),
    v_uid
  )
  returning id into v_device_id;

  insert into public.event_log (store_id, actor_user_id, type, payload)
  values (
    p_store_id,
    v_uid,
    'pos.device_bound',
    jsonb_build_object('device_id', v_device_id, 'label', v_label)
  );

  return jsonb_build_object('device_id', v_device_id, 'locked', true);
end;
$$;

revoke all on function public.bind_pos_device(uuid, text) from public, anon;
grant execute on function public.bind_pos_device(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Os alertas: limiar por tipo, loja activa em todos os ramos, e o POS calado
-- só dentro do horário.
--
-- A bridge não ganha a porta do horário de propósito: é 24/7 (§3), e quem a
-- encontra morta às 7h da manhã conserta-a antes da primeira comanda, em vez
-- de descobrir às 11h com fila ao balcão. O POS é o contrário — é um ecrã que
-- alguém desliga à noite — e por isso só é vigiado com a loja a operar.
-- ---------------------------------------------------------------------------
create or replace function private.system_alerts(p_todas boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return coalesce(
    (
      select jsonb_agg(entry order by entry.severity, entry.store_name, entry.kind)
      from (
        -- Dispositivo calado para além do limiar do seu tipo.
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
          and s.active
          and (p_todas or private.auth_can_store(d.store_id))
          and (
            d.last_seen_at is null
            or d.last_seen_at < now() - private.device_silent_after(d.kind)
          )
          and (d.kind = 'bridge' or private.store_operating_now(d.store_id))

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
          and s.active
          and (p_todas or private.auth_can_store(pj.store_id))
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
          and s.active
          and (p_todas or private.auth_can_store(o.store_id))
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
          and s.active
          and (p_todas or private.auth_can_store(si.store_id))
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
          and (p_todas or private.auth_can_store(s.id))
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

revoke all on function private.system_alerts(boolean)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- O painel passa a usar o mesmo limiar por tipo que os alertas, para o ponto
-- verde e o email não se contradizerem. `silent_after_seconds` fica a dizer o
-- limiar da bridge, que é o mais curto, e cada dispositivo leva o seu.
-- ---------------------------------------------------------------------------
create or replace function public.get_system_status()
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

  return jsonb_build_object(
    'checked_at', now(),
    'silent_after_seconds',
      extract(epoch from private.device_silent_after('bridge'))::integer,
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
                'silent_after_seconds',
                  extract(epoch from private.device_silent_after(d.kind))::integer,
                'online', d.last_seen_at is not null
                  and d.last_seen_at > now() - private.device_silent_after(d.kind)
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
-- Correcção de dados, uma vez: retira os bindings de POS abandonados.
--
-- Por regra, não por id: de cada loja activa guarda-se o POS visto mais
-- recentemente — é o terminal que lá está — e retira-se o que esteja calado há
-- mais de 48 h. Em Maputo isto apanha a linha de 30/09 e deixa em paz a de
-- ontem à noite. Numa instância nova não há o que apanhar.
-- ---------------------------------------------------------------------------
with recentes as (
  select distinct on (d.store_id) d.store_id, d.id
  from public.devices d
  join public.stores s on s.id = d.store_id
  where d.kind = 'pos' and d.active and s.active
  order by d.store_id, d.last_seen_at desc nulls last
)
update public.devices d
set active = false
from public.stores s
where s.id = d.store_id
  and s.active
  and d.kind = 'pos'
  and d.active
  and d.id not in (select id from recentes)
  and (d.last_seen_at is null or d.last_seen_at < now() - interval '48 hours');
