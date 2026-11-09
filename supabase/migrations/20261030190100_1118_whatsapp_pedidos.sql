-- WhatsApp do HAWSMASH (ADR 0011) — a parte do RESTAURANTE, que não se copia para o Gym OS.
-- Cada estado do pedido online enfileira um aviso na 1117. Mapa evento → template em
-- apps/web/lib/whatsapp/events.ts. Best-effort: uma falha aqui nunca reverte o pedido (regra 1).

create or replace function private.whatsapp_order_event()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_phone text;
  v_vars jsonb;
  v_store_name text;
begin
  if TG_OP = 'UPDATE' and old.status = new.status then return new; end if;
  -- Só os canais online: ao balcão e na mesa o cliente está à frente da loja.
  if coalesce(new.channel, '') not in ('delivery', 'pickup') then return new; end if;

  if new.status = 'cancelled' then
    perform public.whatsapp_cancel_subject(new.store_id, 'order', new.id::text);
  end if;

  v_phone := private.whatsapp_phone_mz(new.customer_phone);
  if v_phone is null then return new; end if;
  select s.name into v_store_name from public.stores s where s.id = new.store_id;
  v_vars := jsonb_build_object(
    'nome', coalesce(nullif(split_part(trim(coalesce(new.customer_name, '')), ' ', 1), ''), 'cliente'),
    'pedido', new.order_number,
    'loja', coalesce(v_store_name, ''),
    'order_id', new.id
  );

  if new.status::text in ('approved', 'paid') then
    perform public.whatsapp_enqueue(new.store_id, 'order', new.id::text, 'order.paid', v_phone, v_vars,
      'utility', null, now() + interval '3 hours');
    -- Pedido agendado (1116): lembrete 30 min antes, só se ainda faltar tempo para isso.
    if new.scheduled_for is not null and new.scheduled_for > now() + interval '45 minutes' then
      perform public.whatsapp_enqueue(new.store_id, 'order', new.id::text, 'order.scheduled_reminder', v_phone,
        v_vars || jsonb_build_object('hora', to_char(new.scheduled_for at time zone 'Africa/Maputo', 'HH24:MI')),
        'utility', new.scheduled_for - interval '30 minutes', new.scheduled_for);
    end if;
  elsif new.status::text = 'ready' and new.fulfillment_type = 'pickup' then
    perform public.whatsapp_enqueue(new.store_id, 'order', new.id::text, 'order.ready', v_phone, v_vars,
      'utility', null, now() + interval '3 hours');
  elsif new.status::text = 'delivered' then
    perform public.whatsapp_enqueue(new.store_id, 'order', new.id::text, 'order.delivered', v_phone, v_vars,
      'utility', null, now() + interval '6 hours');
  elsif new.status::text = 'payment_failed' then
    perform public.whatsapp_enqueue(new.store_id, 'order', new.id::text, 'order.payment_failed', v_phone, v_vars,
      'utility', null, now() + interval '1 hour');
  elsif new.status::text = 'cancelled' and TG_OP = 'UPDATE'
        and old.status::text in ('approved', 'paid', 'in_preparation', 'ready') then
    -- Só avisa quem já tinha pago: um checkout abandonado que caduca não é notícia para ninguém.
    perform public.whatsapp_enqueue(new.store_id, 'order', new.id::text, 'order.cancelled', v_phone, v_vars,
      'utility', null, now() + interval '3 hours');
  end if;
  return new;
exception when others then
  raise warning 'whatsapp_queue_failed';
  return new;
end $$;
drop trigger if exists whatsapp_order_event on public.orders;
create trigger whatsapp_order_event after insert or update of status on public.orders
  for each row execute function private.whatsapp_order_event();

-- Estafeta carregou em "Levantei" (1115) → "a caminho".
create or replace function private.whatsapp_delivery_event()
returns trigger language plpgsql security definer set search_path = '' as $$
declare o public.orders;
begin
  if new.status <> 'picked_up' or old.status = 'picked_up' then return new; end if;
  select * into o from public.orders where id = new.order_id;
  if o.id is null or private.whatsapp_phone_mz(o.customer_phone) is null then return new; end if;
  perform public.whatsapp_enqueue(o.store_id, 'order', o.id::text, 'order.on_the_way',
    private.whatsapp_phone_mz(o.customer_phone),
    jsonb_build_object(
      'nome', coalesce(nullif(split_part(trim(coalesce(o.customer_name, '')), ' ', 1), ''), 'cliente'),
      'pedido', o.order_number,
      'loja', coalesce((select s.name from public.stores s where s.id = o.store_id), ''),
      'order_id', o.id),
    'utility', null, now() + interval '2 hours');
  return new;
exception when others then
  raise warning 'whatsapp_queue_failed';
  return new;
end $$;
drop trigger if exists whatsapp_delivery_event on public.deliveries;
create trigger whatsapp_delivery_event after update of status on public.deliveries
  for each row execute function private.whatsapp_delivery_event();

-- Número da loja de Maputo (Glória). Só o número de exibição: o id no fornecedor (whatsapp_sender_id)
-- e o interruptor ficam por preencher até a Tyxter ligar o número — BLOQUEIO: B-121.
update public.stores set whatsapp_phone = '+258870301006'
 where slug = 'maputo' and whatsapp_phone is null;
