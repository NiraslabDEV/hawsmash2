-- HAWSMASH 2.0 — 1049: entrada no POS por cartão da pessoa + PIN.
--
-- O balcão deixa de pedir email e palavra-passe. Quem chega vê os cards da
-- equipa DAQUELA loja, toca no seu e marca o PIN nos números do ecrã. É o
-- gesto de quem tem as mãos ocupadas (§7.6: touch, alvos grandes, sem
-- teclado), e mantém intacto o que importa: cada venda continua a ficar com o
-- `actor_user_id` de quem a fez (§6), porque o PIN certo devolve uma sessão
-- Supabase REAL dessa pessoa — não uma sessão partilhada do terminal.
--
-- Duas funções, com portas diferentes de propósito:
--   · `pos_login_cards`    — pública (anon). Só nomes, perfil e se têm PIN.
--   · `pos_login_with_pin` — só `service_role`. Compara o hash e devolve o
--     email para o servidor criar a sessão. Nunca chega ao browser.

alter table public.staff_profiles
  add column if not exists pin_failed_attempts int not null default 0,
  add column if not exists pin_locked_until timestamptz;

comment on column public.staff_profiles.pin_failed_attempts is
  'Tentativas falhadas seguidas de PIN no POS. Zera na primeira entrada certa.';
comment on column public.staff_profiles.pin_locked_until is
  'Enquanto for futuro, o card recusa PIN. Um PIN de 4 dígitos sem travão adivinha-se em minutos.';

-- ---------------------------------------------------------------------------
-- Os cards do ecrã de entrada
-- ---------------------------------------------------------------------------
-- Chamada SEM sessão (é o ecrã de login), logo `anon`. O que devolve é o que
-- já está escrito no crachá de quem está ao balcão: nome e função. Sem email,
-- sem telefone, sem hash. E só de um terminal já vinculado — o id do
-- dispositivo é um uuid que só existe no localStorage daquele PC.
create or replace function public.pos_login_cards(p_device_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_device record;
begin
  select d.id, d.label, d.store_id, d.locked_at, s.short_name
  into v_device
  from public.devices d
  join public.stores s on s.id = d.store_id
  where d.id = p_device_id
    and d.kind = 'pos'
    and d.active;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'invalid_device');
  end if;

  return jsonb_build_object(
    'ok', true,
    'device', jsonb_build_object(
      'id', v_device.id,
      'label', v_device.label,
      'store_id', v_device.store_id,
      'store_name', v_device.short_name,
      'locked', v_device.locked_at is not null
    ),
    'staff', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'user_id', card.user_id,
            'full_name', card.full_name,
            'role', card.role,
            'has_pin', card.has_pin,
            'locked_until', card.locked_until
          )
          order by card.rank, card.full_name
        )
        from (
          select
            sp.user_id,
            sp.full_name,
            sp.role,
            sp.pin_hash is not null as has_pin,
            case when sp.pin_locked_until > now() then sp.pin_locked_until end as locked_until,
            case sp.role
              when 'cashier' then 1
              when 'manager' then 2
              when 'kitchen' then 3
              else 4
            end as rank
          from public.staff_profiles sp
          where sp.active
            and (
              sp.role = 'owner'
              or exists (
                select 1
                from public.staff_stores ss
                where ss.user_id = sp.user_id
                  and ss.store_id = v_device.store_id
              )
            )
        ) card
      ),
      '[]'::jsonb
    )
  );
end;
$fn$;

revoke all on function public.pos_login_cards(uuid) from public;
grant execute on function public.pos_login_cards(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- A verificação do PIN
-- ---------------------------------------------------------------------------
-- Devolve resultado em vez de rebentar com `raise`: uma excepção aborta a
-- transacção e levaria consigo o contador de tentativas falhadas — o travão
-- nunca contaria nada. Quem falha o PIN tem de deixar rasto na mesma chamada.
create or replace function public.pos_login_with_pin(
  p_device_id uuid,
  p_user_id uuid,
  p_pin text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_store_id uuid;
  v_staff record;
  v_email text;
  v_attempts int;
  v_lock_until timestamptz;
begin
  if coalesce(p_pin, '') !~ '^[0-9]{4,6}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_pin_format');
  end if;

  select d.store_id into v_store_id
  from public.devices d
  where d.id = p_device_id
    and d.kind = 'pos'
    and d.active;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'invalid_device');
  end if;

  select sp.user_id, sp.full_name, sp.role, sp.pin_hash,
         sp.pin_failed_attempts, sp.pin_locked_until
  into v_staff
  from public.staff_profiles sp
  where sp.user_id = p_user_id
    and sp.active
    and (
      sp.role = 'owner'
      or exists (
        select 1
        from public.staff_stores ss
        where ss.user_id = sp.user_id
          and ss.store_id = v_store_id
      )
    );

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'staff_not_in_store');
  end if;
  if v_staff.pin_hash is null then
    return jsonb_build_object('ok', false, 'reason', 'pin_not_configured');
  end if;
  if v_staff.pin_locked_until is not null and v_staff.pin_locked_until > now() then
    return jsonb_build_object(
      'ok', false,
      'reason', 'pin_locked',
      'locked_until', v_staff.pin_locked_until
    );
  end if;

  if extensions.crypt(p_pin, v_staff.pin_hash) <> v_staff.pin_hash then
    v_attempts := v_staff.pin_failed_attempts + 1;
    -- 5 erros seguidos abrem um minuto de espera, e cada erro a seguir duplica
    -- até 15 min. Um engano ao teclar custa nada; adivinhar 10.000 hipóteses
    -- passa a demorar mais do que um turno.
    if v_attempts >= 5 then
      v_lock_until := now()
        + make_interval(secs => least(900, 60 * (2 ^ least(v_attempts - 5, 4)))::int);
    end if;

    update public.staff_profiles sp
    set pin_failed_attempts = v_attempts,
        pin_locked_until = coalesce(v_lock_until, sp.pin_locked_until)
    where sp.user_id = p_user_id;

    insert into public.event_log (store_id, actor_user_id, type, payload)
    values (
      v_store_id,
      p_user_id,
      'pos.login_failed',
      jsonb_build_object('device_id', p_device_id, 'attempts', v_attempts)
    );

    return jsonb_build_object(
      'ok', false,
      'reason', case when v_lock_until is null then 'invalid_pin' else 'pin_locked' end,
      'locked_until', v_lock_until
    );
  end if;

  select u.email into v_email from auth.users u where u.id = p_user_id;
  if v_email is null then
    return jsonb_build_object('ok', false, 'reason', 'staff_without_email');
  end if;

  update public.staff_profiles sp
  set pin_failed_attempts = 0,
      pin_locked_until = null
  where sp.user_id = p_user_id;

  -- Entrar é desbloquear: o PIN que abre o turno é o mesmo que tira o cadeado
  -- do terminal. Sem isto o operador acertava o PIN e continuava trancado.
  update public.devices
  set locked_at = null,
      last_seen_at = now()
  where id = p_device_id;

  insert into public.event_log (store_id, actor_user_id, type, payload)
  values (
    v_store_id,
    p_user_id,
    'pos.login',
    jsonb_build_object('device_id', p_device_id, 'method', 'card_pin')
  );

  return jsonb_build_object(
    'ok', true,
    'user_id', v_staff.user_id,
    'email', v_email,
    'full_name', v_staff.full_name,
    'role', v_staff.role,
    'store_id', v_store_id
  );
end;
$fn$;

-- O email e a decisão de "este PIN está certo" nunca passam pelo browser:
-- só o servidor, com a chave de serviço, chama esta função (§17 segredos).
revoke all on function public.pos_login_with_pin(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.pos_login_with_pin(uuid, uuid, text) to service_role;
