-- HAWSMASH 2.0 — 1108: reimprimir o fecho de um turno.
--
-- Pedido do dono (30 Set): no Caixa do POS, um botão "Reimprimir" em cada
-- turno fechado. Até aqui o talão de fecho do turno só saía uma vez, pelo
-- trigger da F5 no momento do fecho; só o fecho do dia voltava à impressora
-- (1100).
--
-- As regras da 1100, agora para o turno (CLAUDE §7.4, a reimpressão não pode
-- virar via de fraude):
--   - só a equipa da loja com caixa: owner, manager, cashier (não a cozinha);
--     o service_role também, para o suporte reimprimir à distância;
--   - sai marcado REIMPRESSÃO, na impressora do balcão. O bridge imprime o
--     `shift_label` por baixo de "FECHO DE CAIXA": a marca vai nesse campo,
--     e sai também com o bridge que está hoje nas lojas;
--   - idempotente por `p_request_id`: repetir o toque não gasta mais papel;
--   - fica em `event_log` como `cash.session_close_reprinted`, com quem e
--     quando.
--
-- O papel sai do `report` que o fecho congelou: os números não se
-- recalculam. Um turno fechado antes da 1095 não guardou os artigos
-- vendidos; a reimpressão conta-os com a regra do fecho (`private.cash_sold`
-- no período do turno), sem reescrever o `report`. Se a contagem falhar, o
-- talão sai na mesma, sem a lista (regra 1).
--
-- Forward-only: acrescenta uma função, não toca em dados.

create or replace function public.reprint_cash_session(p_session_id uuid, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_service boolean := coalesce((select auth.jwt() ->> 'role') = 'service_role', false);
  v_role text;
  v_session public.cash_sessions%rowtype;
  v_report jsonb;
  v_sold jsonb;
  v_short_name text;
  v_closed_by_name text;
  v_payload jsonb;
  v_seq integer;
  v_job_id uuid;
begin
  if p_request_id is null then
    raise exception 'request_id_required' using errcode = 'P0007';
  end if;
  if not v_service then
    if v_uid is null then
      raise exception 'not_authenticated' using errcode = 'P0020';
    end if;
    v_role := coalesce(private.auth_role(), '');
    if v_role not in ('owner', 'manager', 'cashier') then
      raise exception 'cash_access_denied' using errcode = 'P0403';
    end if;
  end if;

  select cs.* into v_session
  from public.cash_sessions cs
  where cs.id = p_session_id;
  if not found or not (v_service or private.auth_can_store(v_session.store_id)) then
    raise exception 'session_not_found' using errcode = 'P0404';
  end if;
  if v_session.closed_at is null then
    raise exception 'session_still_open' using errcode = 'P0409';
  end if;

  -- Sem os pagamentos, o talão sairia com zeros com ar de certos: melhor
  -- recusar e a equipa chamar o suporte.
  v_report := v_session.report;
  if pg_catalog.jsonb_typeof(v_report) is distinct from 'object'
     or pg_catalog.jsonb_typeof(v_report -> 'payments') is distinct from 'object' then
    raise exception 'session_report_unreadable' using errcode = 'P0422';
  end if;

  -- Repetição do mesmo toque: devolve o trabalho que já está na fila.
  select pj.id, pj.reprint_seq into v_job_id, v_seq
  from public.print_jobs pj
  where pj.store_id = v_session.store_id
    and pj.request_id = p_request_id
    and pj.station = 'counter'
    and pj.kind = 'cash_close';
  if v_job_id is not null then
    return jsonb_build_object('job_id', v_job_id, 'session_id', v_session.id,
      'reprint_seq', v_seq, 'duplicate', true);
  end if;

  if pg_catalog.jsonb_typeof(v_report -> 'sold') is distinct from 'object' then
    begin
      v_sold := private.cash_sold(
        v_session.store_id,
        coalesce((v_report ->> 'period_start')::timestamptz, v_session.opened_at),
        v_session.closed_at
      );
      if v_sold is not null then
        v_report := v_report || jsonb_build_object('sold', v_sold);
      end if;
    exception when others then
      null; -- Sem a lista, o talão sai na mesma.
    end;
  end if;

  select s.short_name into v_short_name from public.stores s where s.id = v_session.store_id;
  select sp.full_name into v_closed_by_name
  from public.staff_profiles sp where sp.user_id = v_session.closed_by;

  -- O original entra na fila com `reprint_seq` 0 (F5); cada reimpressão, a seguinte.
  select coalesce(max(pj.reprint_seq), 0) + 1 into v_seq
  from public.print_jobs pj
  where pj.store_id = v_session.store_id
    and pj.kind = 'cash_close'
    and (pj.request_id = v_session.id or pj.payload ->> 'session_id' = v_session.id::text);

  -- O `report` manda; as colunas da sessão só preenchem o que faltar.
  v_payload := pg_catalog.jsonb_strip_nulls(jsonb_build_object(
      'session_id', v_session.id,
      'shift_label', v_session.shift_label,
      'opened_at', v_session.opened_at,
      'closed_at', v_session.closed_at,
      'opening_float_cents', v_session.opening_float_cents,
      'expected_cash_cents', v_session.expected_cash_cents,
      'counted_cash_cents', v_session.counted_cash_cents,
      'difference_cents', v_session.difference_cents,
      'difference_reason', v_session.difference_reason
    ))
    || v_report
    || jsonb_build_object(
      'template', 'cash_close',
      'store_short_name', coalesce(v_short_name, 'Loja'),
      'closed_by_name', v_closed_by_name,
      'reprint', true
    );
  v_payload := v_payload || jsonb_build_object(
    'shift_label', 'REIMPRESSÃO - ' || coalesce(nullif(v_payload ->> 'shift_label', ''), 'FECHO DE CAIXA')
  );

  insert into public.print_jobs (
    store_id, order_id, request_id, station, kind, reprint_seq, payload
  ) values (
    v_session.store_id, null, p_request_id, 'counter', 'cash_close', v_seq, v_payload
  )
  on conflict (store_id, request_id, station, kind)
    where request_id is not null
    do nothing
  returning id into v_job_id;

  if v_job_id is null then
    -- Corrida entre dois toques iguais: o outro gravou primeiro.
    select pj.id, pj.reprint_seq into v_job_id, v_seq
    from public.print_jobs pj
    where pj.store_id = v_session.store_id and pj.request_id = p_request_id
      and pj.station = 'counter' and pj.kind = 'cash_close';
    return jsonb_build_object('job_id', v_job_id, 'session_id', v_session.id,
      'reprint_seq', v_seq, 'duplicate', true);
  end if;

  insert into public.event_log (store_id, actor_user_id, type, payload)
  values (
    v_session.store_id, v_uid, 'cash.session_close_reprinted',
    jsonb_build_object(
      'session_id', v_session.id,
      'shift_label', v_session.shift_label,
      'job_id', v_job_id,
      'reprint_seq', v_seq,
      'with_sold', pg_catalog.jsonb_typeof(v_report -> 'sold') = 'object',
      'source', case when v_service then 'service_role' else 'staff' end
    )
  );

  return jsonb_build_object(
    'job_id', v_job_id,
    'session_id', v_session.id,
    'reprint_seq', v_seq,
    'duplicate', false
  );
end;
$$;

revoke all on function public.reprint_cash_session(uuid, uuid) from public, anon;
grant execute on function public.reprint_cash_session(uuid, uuid) to authenticated, service_role;
