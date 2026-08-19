-- HAWSMASH 2.0 — F8: digest diário por loja (CLAUDE §11.5).
--
-- Um resumo do dia, no fuso da loja: vendas, decomposição por forma de
-- pagamento, fecho de caixa e incidentes. Serve o email ao dono e o painel.

create or replace function public.get_daily_digest(p_day date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_day date := coalesce(p_day, (now() at time zone 'Africa/Maputo')::date);
  v_start timestamptz := (v_day::timestamp at time zone 'Africa/Maputo');
  v_end timestamptz := ((v_day + 1)::timestamp at time zone 'Africa/Maputo');
begin
  if (select auth.uid()) is null and current_setting('role', true) <> 'service_role' then
    raise exception 'not_authenticated' using errcode = 'P0020';
  end if;

  return jsonb_build_object(
    'day', v_day,
    'stores', coalesce(
      (
        select jsonb_agg(entry order by entry.sort, entry.store_name)
        from (
          select
            s.id as store_id,
            s.short_name as store_name,
            s.owner_email,
            s.sort,
            (
              select count(*)::integer
              from public.orders o
              where o.store_id = s.id
                and o.created_at >= v_start and o.created_at < v_end
                and o.status in ('paid', 'approved', 'in_preparation', 'ready', 'delivered')
            ) as orders_count,
            (
              select coalesce(sum(o.total_cents), 0)::integer
              from public.orders o
              where o.store_id = s.id
                and o.created_at >= v_start and o.created_at < v_end
                and o.status in ('paid', 'approved', 'in_preparation', 'ready', 'delivered')
            ) as revenue_cents,
            (
              select coalesce(jsonb_object_agg(p.method, p.total), '{}'::jsonb)
              from (
                select pay.method, sum(pay.amount_cents)::integer as total
                from public.payments pay
                where pay.store_id = s.id
                  and pay.status = 'confirmed'
                  and pay.created_at >= v_start and pay.created_at < v_end
                group by pay.method
              ) p
            ) as payments,
            (
              select count(*)::integer
              from public.orders o
              where o.store_id = s.id
                and o.created_at >= v_start and o.created_at < v_end
                and o.status = 'cancelled'
            ) as cancelled_count,
            (
              select coalesce(jsonb_agg(jsonb_build_object(
                'closed_at', cs.closed_at,
                'expected_cash_cents', cs.expected_cash_cents,
                'counted_cash_cents', cs.counted_cash_cents,
                'difference_cents', cs.difference_cents,
                'difference_reason', cs.difference_reason
              ) order by cs.closed_at), '[]'::jsonb)
              from public.cash_sessions cs
              where cs.store_id = s.id
                and cs.closed_at >= v_start and cs.closed_at < v_end
            ) as cash_closes,
            (
              select count(*)::integer
              from public.event_log el
              where el.store_id = s.id
                and el.created_at >= v_start and el.created_at < v_end
                and el.type in ('alert.sent', 'counter.sale_voided', 'print.sale_enqueue_failed')
            ) as incidents
          from public.stores s
          where s.active
            and (
              current_setting('role', true) = 'service_role'
              or private.auth_can_store(s.id)
            )
        ) entry
      ),
      '[]'::jsonb
    )
  );
end;
$$;

revoke all on function public.get_daily_digest(date) from public, anon;
grant execute on function public.get_daily_digest(date) to authenticated, service_role;
