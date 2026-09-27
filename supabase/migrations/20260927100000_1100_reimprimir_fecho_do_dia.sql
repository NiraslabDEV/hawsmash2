-- HAWSMASH 2.0 — 1100: reimprimir um fecho do dia, com os artigos vendidos.
--
-- Pedido do dono (27 Set): um botão "Reimprimir" nos fechos do dia — no Caixa
-- do painel e no POS. Até aqui o talão do dia só saía uma vez, no momento do
-- fecho (1091), e não havia maneira de o voltar a pôr na impressora.
--
-- Regras (CLAUDE §7.4, a reimpressão não pode virar via de fraude):
--   - só a equipa da loja com caixa: owner, manager, cashier (não a cozinha);
--     o service_role também, para o suporte reimprimir à distância;
--   - sai marcado REIMPRESSÃO, na impressora do balcão;
--   - idempotente por `p_request_id`: repetir o toque não gasta mais papel;
--   - fica em `event_log` como `cash.day_close_reprinted`, com quem e quando.
--
-- Os artigos vendidos (1095): um fecho feito antes da 1095 não os congelou.
-- A reimpressão junta-os ao papel com a mesma regra do fecho do dia —
-- `private.cash_day_sold` sobre os turnos desse fecho — sem reescrever o
-- relatório gravado em `cash_day_closes` (o fecho fica como foi feito).
-- Se a contagem falhar, o talão sai na mesma, sem a lista (regra 1).

create or replace function public.reprint_cash_day(p_day_close_id uuid, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_service boolean := coalesce((select auth.jwt() ->> 'role') = 'service_role', false);
  v_role text;
  v_close public.cash_day_closes%rowtype;
  v_report jsonb;
  v_sessions uuid[];
  v_sold jsonb;
  v_short_name text;
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

  select d.* into v_close
  from public.cash_day_closes d
  where d.id = p_day_close_id;
  if not found or not (v_service or private.auth_can_store(v_close.store_id)) then
    raise exception 'day_close_not_found' using errcode = 'P0404';
  end if;

  -- Repetição do mesmo toque: devolve o trabalho que já está na fila.
  select pj.id, pj.reprint_seq into v_job_id, v_seq
  from public.print_jobs pj
  where pj.store_id = v_close.store_id
    and pj.request_id = p_request_id
    and pj.station = 'counter'
    and pj.kind = 'cash_close';
  if v_job_id is not null then
    return jsonb_build_object('job_id', v_job_id, 'day_close_id', v_close.id,
      'reprint_seq', v_seq, 'duplicate', true);
  end if;

  v_report := v_close.report;
  if pg_catalog.jsonb_typeof(v_report -> 'sold') is distinct from 'object' then
    begin
      select coalesce(array_agg(cs.id), '{}') into v_sessions
      from public.cash_sessions cs
      where cs.store_id = v_close.store_id and cs.day_close_id = v_close.id;
      v_sold := private.cash_day_sold(v_close.store_id, v_sessions);
      if v_sold is not null then
        v_report := v_report || jsonb_build_object('sold', v_sold);
      end if;
    exception when others then
      null; -- Sem a lista, o talão sai na mesma.
    end;
  end if;

  select s.short_name into v_short_name from public.stores s where s.id = v_close.store_id;

  select coalesce(max(pj.reprint_seq), 0) + 1 into v_seq
  from public.print_jobs pj
  where pj.store_id = v_close.store_id
    and pj.kind = 'cash_close'
    and pj.payload ->> 'day_close_id' = v_close.id::text;

  v_payload := private.cash_day_print_payload(v_report, v_short_name);
  -- `shift_label` é o que o bridge antigo imprime no lugar do título do dia:
  -- a marca de reimpressão tem de aparecer também nesse papel.
  v_payload := v_payload || jsonb_build_object(
    'reprint', true,
    'shift_label', 'REIMPRESSÃO - ' || coalesce(v_payload ->> 'shift_label', 'FECHO DO DIA')
  );

  insert into public.print_jobs (
    store_id, order_id, request_id, station, kind, reprint_seq, payload
  ) values (
    v_close.store_id, null, p_request_id, 'counter', 'cash_close', v_seq, v_payload
  )
  on conflict (store_id, request_id, station, kind)
    where request_id is not null
    do nothing
  returning id into v_job_id;

  if v_job_id is null then
    -- Corrida entre dois toques iguais: o outro gravou primeiro.
    select pj.id, pj.reprint_seq into v_job_id, v_seq
    from public.print_jobs pj
    where pj.store_id = v_close.store_id and pj.request_id = p_request_id
      and pj.station = 'counter' and pj.kind = 'cash_close';
    return jsonb_build_object('job_id', v_job_id, 'day_close_id', v_close.id,
      'reprint_seq', v_seq, 'duplicate', true);
  end if;

  insert into public.event_log (store_id, actor_user_id, type, payload)
  values (
    v_close.store_id, v_uid, 'cash.day_close_reprinted',
    jsonb_build_object(
      'day_close_id', v_close.id,
      'business_date', v_close.business_date,
      'job_id', v_job_id,
      'reprint_seq', v_seq,
      'with_sold', pg_catalog.jsonb_typeof(v_report -> 'sold') = 'object',
      'source', case when v_service then 'service_role' else 'staff' end
    )
  );

  return jsonb_build_object(
    'job_id', v_job_id,
    'day_close_id', v_close.id,
    'reprint_seq', v_seq,
    'duplicate', false,
    'report', v_report
  );
end;
$$;

revoke all on function public.reprint_cash_day(uuid, uuid) from public, anon;
grant execute on function public.reprint_cash_day(uuid, uuid) to authenticated, service_role;
