-- HAWSMASH 2.0 — 1072: o caixa muda a morada e a hora de um pedido.
--
-- Pergunta do caixa (24 Set): "e se o cliente quiser mudar o endereço ou o
-- horário, eu posso?" Não podia. O POS não tinha onde o escrever, e o que
-- acontecia era anular e refazer — ou riscar o papel à mão. Em nenhum dos
-- casos ficava registado quem mudou o quê, que é a pergunta que se faz quando
-- a entrega corre mal.
--
-- As regras, por ordem de quanto custa errar:
--
--   · O DINHEIRO NÃO SE MEXE AQUI. Mudar de zona só passa se a taxa da zona
--     nova for a que o pedido já tem. Com outra taxa o total mudava, e o
--     pedido pode já estar pago — cobrar ou devolver a diferença não é
--     decisão do caixa (regra 2, §7.4). A saída é anular e refazer, com
--     gerente. `delivery_fee_would_change` diz isso ao POS.
--   · A HORA muda até o pedido estar pronto. Depois de pronto a comida já
--     está feita; mudar a hora não a desfaz. Valida-se como na 1022: nada no
--     passado, nada a mais de uma semana. `null` volta a "agora".
--   · A MORADA muda até o pedido sair (pronto incluído — é quando o
--     entregador ainda está à porta). Só em entregas.
--   · O PAPEL ACOMPANHA. Se a comanda já saiu, a via do saco tem a morada e a
--     hora antigas, e é essa que o entregador lê. Sai uma via nova na
--     cozinha, marcada ALTERADO, com o que mudou. É best-effort: falhar a
--     impressão nunca reverte a alteração (regra 1).
--   · Repetir o toque não imprime duas vezes: `p_request_id`, como no
--     `reprint` (regra 4).
--   · Tudo em event_log, com antes, depois e quem.
--
-- Quem: owner, manager e cashier da loja do pedido. A cozinha não.

create or replace function public.update_order_details(
  p_order_id uuid,
  p_changes jsonb,
  p_request_id uuid default gen_random_uuid()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_role text := private.auth_role();
  v_order public.orders%rowtype;
  v_zone public.delivery_zones%rowtype;
  v_changes jsonb := coalesce(p_changes, '{}'::jsonb);
  v_new_address text;
  v_new_zone_id uuid;
  v_new_scheduled timestamptz;
  v_changed text[] := array[]::text[];
  v_address_changed boolean := false;
  v_schedule_changed boolean := false;
  v_seq integer;
  v_job_id uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0020';
  end if;
  if v_role is null or v_role not in ('owner', 'manager', 'cashier') then
    raise exception 'order_edit_access_denied' using errcode = 'P0403';
  end if;
  if p_request_id is null then
    raise exception 'request_id_required' using errcode = 'P0007';
  end if;
  if jsonb_typeof(v_changes) <> 'object' then
    raise exception 'invalid_changes' using errcode = 'P0007';
  end if;

  -- Serializa o mesmo pedido: dois terminais a mudar a morada ao mesmo tempo
  -- não podem deixar um event_log que não bate com a linha.
  select o.*
  into v_order
  from public.orders o
  where o.id = p_order_id
    and private.auth_can_store(o.store_id)
  for update;

  if not found then
    raise exception 'order_not_found_or_unauthorised' using errcode = 'P0404';
  end if;

  -- O mesmo toque outra vez: devolve o que já foi feito, sem segunda via.
  if exists (
    select 1
    from public.event_log e
    where e.order_id = p_order_id
      and e.type in ('order.address_changed', 'order.schedule_changed')
      and e.payload ->> 'request_id' = p_request_id::text
  ) then
    return jsonb_build_object(
      'changed', '[]'::jsonb,
      'reprinted', false,
      'job_id', null,
      'duplicate', true
    );
  end if;

  if v_order.channel = 'dine_in'
     or v_order.status not in (
       'awaiting_payment', 'awaiting_approval', 'approved', 'paid',
       'in_preparation', 'ready'
     ) then
    raise exception 'order_not_editable' using errcode = 'P0409';
  end if;

  -- ── Morada e zona ──────────────────────────────────────────────────────
  v_new_address := v_order.address;
  v_new_zone_id := v_order.delivery_zone_id;

  if v_changes ? 'address' or v_changes ? 'deliveryZoneId' then
    if v_order.fulfillment_type <> 'delivery' then
      raise exception 'not_a_delivery' using errcode = 'P0007';
    end if;

    if v_changes ? 'address' then
      v_new_address := btrim(coalesce(v_changes ->> 'address', ''));
      if v_new_address = '' then
        raise exception 'address_required' using errcode = 'P0007';
      end if;
      if char_length(v_new_address) > 300 then
        raise exception 'address_too_long' using errcode = 'P0007';
      end if;
    end if;

    if v_changes ? 'deliveryZoneId' then
      begin
        v_new_zone_id := nullif(btrim(v_changes ->> 'deliveryZoneId'), '')::uuid;
      exception when invalid_text_representation then
        raise exception 'invalid_delivery_zone' using errcode = 'P0008';
      end;

      select z.*
      into v_zone
      from public.delivery_zones z
      where z.id = v_new_zone_id
        and z.store_id = v_order.store_id
        and z.active;

      if not found then
        raise exception 'invalid_delivery_zone' using errcode = 'P0008';
      end if;

      -- DECISÃO (24 Set): taxa diferente não se acerta aqui. O pedido pode
      -- estar pago; mexer no total é cobrança ou devolução, e isso é anular
      -- e refazer com gerente (§7.4).
      if v_new_zone_id is distinct from v_order.delivery_zone_id
         and v_zone.fee_cents <> v_order.delivery_fee_cents then
        raise exception 'delivery_fee_would_change:%:%',
          v_order.delivery_fee_cents, v_zone.fee_cents
          using errcode = 'P0409';
      end if;
    end if;

    v_address_changed :=
      v_new_address is distinct from v_order.address
      or v_new_zone_id is distinct from v_order.delivery_zone_id;
  end if;

  -- ── Hora marcada ───────────────────────────────────────────────────────
  v_new_scheduled := v_order.scheduled_for;

  if v_changes ? 'scheduledFor' then
    if nullif(btrim(coalesce(v_changes ->> 'scheduledFor', '')), '') is null then
      v_new_scheduled := null;
    else
      begin
        v_new_scheduled := (v_changes ->> 'scheduledFor')::timestamptz;
      exception when others then
        raise exception 'invalid_scheduled_for' using errcode = 'P0007';
      end;
    end if;

    if v_new_scheduled is distinct from v_order.scheduled_for then
      if v_order.status = 'ready' then
        raise exception 'schedule_not_editable' using errcode = 'P0409';
      end if;
      if v_new_scheduled is not null then
        if v_new_scheduled < now() - interval '5 minutes' then
          raise exception 'scheduled_for_in_past' using errcode = 'P0007';
        end if;
        if v_new_scheduled > now() + interval '7 days' then
          raise exception 'scheduled_for_too_far' using errcode = 'P0007';
        end if;
      end if;
      v_schedule_changed := true;
    end if;
  end if;

  if not v_address_changed and not v_schedule_changed then
    return jsonb_build_object(
      'changed', '[]'::jsonb,
      'reprinted', false,
      'job_id', null,
      'duplicate', false
    );
  end if;

  update public.orders o
  set address = v_new_address,
      delivery_zone_id = v_new_zone_id,
      scheduled_for = v_new_scheduled,
      updated_at = now()
  where o.id = v_order.id;

  if v_address_changed then
    v_changed := array_append(v_changed, 'address');
    insert into public.event_log (order_id, store_id, actor_user_id, type, payload)
    values (
      v_order.id, v_order.store_id, v_uid, 'order.address_changed',
      jsonb_build_object(
        'request_id', p_request_id,
        'before', jsonb_build_object(
          'address', v_order.address,
          'delivery_zone_id', v_order.delivery_zone_id
        ),
        'after', jsonb_build_object(
          'address', v_new_address,
          'delivery_zone_id', v_new_zone_id
        )
      )
    );
  end if;

  if v_schedule_changed then
    v_changed := array_append(v_changed, 'scheduled_for');
    insert into public.event_log (order_id, store_id, actor_user_id, type, payload)
    values (
      v_order.id, v_order.store_id, v_uid, 'order.schedule_changed',
      jsonb_build_object(
        'request_id', p_request_id,
        'before', jsonb_build_object('scheduled_for', v_order.scheduled_for),
        'after', jsonb_build_object('scheduled_for', v_new_scheduled)
      )
    );
  end if;

  -- ── O papel: só se a comanda já saiu para a fila ───────────────────────
  -- Um pedido ainda por aprovar não tem papel: quando for aprovado, a
  -- comanda já sai com a morada e a hora novas.
  if exists (
    select 1
    from public.print_jobs pj
    where pj.order_id = v_order.id
      and pj.store_id = v_order.store_id
      and pj.kind = 'order'
  ) then
    begin
      select coalesce(max(pj.reprint_seq), 0) + 1
      into v_seq
      from public.print_jobs pj
      where pj.order_id = v_order.id
        and pj.kind = 'order';

      insert into public.print_jobs (
        store_id, order_id, request_id, station, kind, reprint_seq, payload
      ) values (
        v_order.store_id,
        v_order.id,
        p_request_id,
        'kitchen',
        'order',
        v_seq,
        private.build_full_ticket_payload(v_order.id, 'alteracao')
          || jsonb_build_object('station', 'kitchen', 'alteracoes', to_jsonb(v_changed))
      )
      returning id into v_job_id;

      insert into public.event_log (order_id, store_id, actor_user_id, type, payload)
      values (
        v_order.id, v_order.store_id, v_uid, 'print.change_job_queued',
        jsonb_build_object('job_id', v_job_id, 'request_id', p_request_id,
          'alteracoes', to_jsonb(v_changed))
      );
    exception when others then
      -- Regra 1: o papel é redundância. A alteração fica; o painel é o canal
      -- primário e o caixa pode reimprimir à mão.
      v_job_id := null;
    end;
  end if;

  return jsonb_build_object(
    'changed', to_jsonb(v_changed),
    'reprinted', v_job_id is not null,
    'job_id', v_job_id,
    'duplicate', false
  );
end;
$$;

revoke all on function public.update_order_details(uuid, jsonb, uuid) from public, anon;
grant execute on function public.update_order_details(uuid, jsonb, uuid) to authenticated;

comment on function public.update_order_details(uuid, jsonb, uuid) is
  'Muda a morada/zona (só com a mesma taxa) e a hora marcada de um pedido. Regista em event_log e, se a comanda já saiu, põe na fila da cozinha uma via ALTERADO. Idempotente por p_request_id.';
