-- HAWSMASH 2.0 — 1044: configurar o pagamento da loja pelo painel.
--
-- Sem isto, as credenciais do M-Pesa (e as do Paysuite) só entravam com SQL à
-- mão na base de dados — que é precisamente o que o §17 proíbe. Uma instalação
-- nova não pode depender de alguém abrir o editor de SQL de produção.
--
-- Duas funções, e a divisão entre elas é o ponto:
--   · `get_store_payment_status` diz **o que está preenchido**, nunca o valor;
--   · `save_store_payment` escreve, e só o dono a pode chamar.
--
-- Um segredo que entra nunca mais sai: não há leitura, nem para o dono. Se se
-- perder a chave, pede-se outra ao fornecedor — que é mais seguro do que ter
-- um ecrã no painel capaz de a mostrar (§5.6 · §17).

create or replace function public.get_store_payment_status(p_store_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  if not coalesce((select private.auth_is_owner()), false) then
    raise exception 'forbidden' using errcode = 'P0403';
  end if;

  select jsonb_build_object(
    'store_id', s.id,
    'payment_provider', s.payment_provider,
    -- Booleanos, não valores. É tudo o que o painel precisa de saber para
    -- dizer "falta preencher" sem nunca pôr um segredo no browser.
    'paysuite', jsonb_build_object(
      'api_key', coalesce(btrim(s.paysuite_api_key), '') <> '',
      'webhook_secret', coalesce(btrim(s.paysuite_webhook_secret), '') <> ''
    ),
    'mpesa', jsonb_build_object(
      'api_key', coalesce(btrim(s.mpesa_api_key), '') <> '',
      'public_key', coalesce(btrim(s.mpesa_public_key), '') <> '',
      'service_provider_code', coalesce(btrim(s.mpesa_service_provider_code), '') <> '',
      'session_base_url', coalesce(btrim(s.mpesa_session_base_url), '') <> '',
      'charge_base_url', coalesce(btrim(s.mpesa_charge_base_url), '') <> '',
      'query_base_url', coalesce(btrim(s.mpesa_query_base_url), '') <> ''
    ),
    -- Número mostrado ao cliente no fluxo manual (não é credencial).
    'mpesa_number', s.mpesa_number,
    'emola_number', s.emola_number
  )
  into v
  from public.stores s
  where s.id = p_store_id;

  if v is null then
    raise exception 'store_not_found' using errcode = 'P0002';
  end if;

  return v;
end;
$$;

revoke all on function public.get_store_payment_status(uuid) from public;
grant execute on function public.get_store_payment_status(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- save_store_payment — escreve, e só o dono
-- ---------------------------------------------------------------------------
-- Campo ausente = não mexer. Campo com string vazia = **apagar**. A diferença
-- importa: sem ela, não haveria como tirar uma credencial errada sem ir à
-- base de dados — que é o que esta migration existe para evitar.
create or replace function public.save_store_payment(p_store_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_provider text;
  v_mudou text[] := '{}';
  v_chave text;
begin
  if not coalesce((select private.auth_is_owner()), false) then
    raise exception 'forbidden' using errcode = 'P0403';
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'invalid_payload' using errcode = 'P0400';
  end if;

  if jsonb_exists(p_payload, 'payment_provider') then
    v_provider := btrim(coalesce(p_payload ->> 'payment_provider', ''));
    if v_provider not in ('manual', 'mock', 'paysuite', 'mpesa', 'mpesa_sim') then
      raise exception 'invalid_payment_provider' using errcode = 'P0400';
    end if;
  end if;

  update public.stores s
  set
    payment_provider = coalesce(v_provider, s.payment_provider),
    paysuite_api_key = case when jsonb_exists(p_payload, 'paysuite_api_key')
      then nullif(btrim(p_payload ->> 'paysuite_api_key'), '') else s.paysuite_api_key end,
    paysuite_webhook_secret = case when jsonb_exists(p_payload, 'paysuite_webhook_secret')
      then nullif(btrim(p_payload ->> 'paysuite_webhook_secret'), '') else s.paysuite_webhook_secret end,
    mpesa_api_key = case when jsonb_exists(p_payload, 'mpesa_api_key')
      then nullif(btrim(p_payload ->> 'mpesa_api_key'), '') else s.mpesa_api_key end,
    mpesa_public_key = case when jsonb_exists(p_payload, 'mpesa_public_key')
      then nullif(btrim(p_payload ->> 'mpesa_public_key'), '') else s.mpesa_public_key end,
    mpesa_service_provider_code = case when jsonb_exists(p_payload, 'mpesa_service_provider_code')
      then nullif(btrim(p_payload ->> 'mpesa_service_provider_code'), '') else s.mpesa_service_provider_code end,
    mpesa_session_base_url = case when jsonb_exists(p_payload, 'mpesa_session_base_url')
      then nullif(btrim(p_payload ->> 'mpesa_session_base_url'), '') else s.mpesa_session_base_url end,
    mpesa_charge_base_url = case when jsonb_exists(p_payload, 'mpesa_charge_base_url')
      then nullif(btrim(p_payload ->> 'mpesa_charge_base_url'), '') else s.mpesa_charge_base_url end,
    mpesa_query_base_url = case when jsonb_exists(p_payload, 'mpesa_query_base_url')
      then nullif(btrim(p_payload ->> 'mpesa_query_base_url'), '') else s.mpesa_query_base_url end,
    mpesa_number = case when jsonb_exists(p_payload, 'mpesa_number')
      then nullif(btrim(p_payload ->> 'mpesa_number'), '') else s.mpesa_number end,
    emola_number = case when jsonb_exists(p_payload, 'emola_number')
      then nullif(btrim(p_payload ->> 'emola_number'), '') else s.emola_number end
  where s.id = p_store_id;

  if not found then
    raise exception 'store_not_found' using errcode = 'P0002';
  end if;

  -- O registo diz **que campos** mudaram. Nunca o que lá foi escrito: um
  -- event_log com uma chave de API dentro é a mesma fuga, noutro sítio.
  for v_chave in select jsonb_object_keys(p_payload) loop
    v_mudou := array_append(v_mudou, v_chave);
  end loop;

  insert into public.event_log (store_id, actor_user_id, type, payload)
  values (
    p_store_id,
    (select auth.uid()),
    'store.payment_changed',
    jsonb_build_object('campos', to_jsonb(v_mudou))
  );

  return public.get_store_payment_status(p_store_id);
end;
$$;

revoke all on function public.save_store_payment(uuid, jsonb) from public;
grant execute on function public.save_store_payment(uuid, jsonb) to authenticated, service_role;
