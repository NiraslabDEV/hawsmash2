-- HAWSMASH 2.0 — 1043: M-Pesa directo (Vodacom), sem gateway pelo meio.
--
-- Porquê: há instalações que recebem por M-Pesa directamente, sem Paysuite. O
-- motor passa a ter os dois — a escolha é do `payment_provider` de cada loja,
-- não do código.
--
-- O M-Pesa directo tem uma forma diferente do Paysuite e é isso que esta
-- migration acomoda:
--   · não há redirect nem webhook — cobra-se e pergunta-se o estado;
--   · a referência que vai para o M-Pesa tem de caber em 20 caracteres, e a
--     nossa idempotency key tem 35 (`ord` + uuid). Daí `payment_reference`.

-- ---------------------------------------------------------------------------
-- Credenciais por loja
-- ---------------------------------------------------------------------------
-- Ficam em `stores`, como as do Paysuite: são da unidade, não da empresa, e
-- **nunca** voltam numa RPC de leitura nem chegam ao browser (CLAUDE.md §5.6).
alter table public.stores
  add column if not exists mpesa_api_key text,
  add column if not exists mpesa_public_key text,
  add column if not exists mpesa_service_provider_code text,
  add column if not exists mpesa_session_base_url text,
  add column if not exists mpesa_charge_base_url text,
  add column if not exists mpesa_query_base_url text;

-- `mpesa` = Vodacom directo · `mpesa_sim` = simulador, para ensaiar sem
-- credenciais (e para o staging não tocar em dinheiro a sério).
alter table public.stores drop constraint if exists stores_payment_provider_check;
alter table public.stores
  add constraint stores_payment_provider_check
  check (payment_provider in ('manual', 'mock', 'paysuite', 'mpesa', 'mpesa_sim'));

alter table public.settings drop constraint if exists settings_payment_provider_check;
alter table public.settings
  add constraint settings_payment_provider_check
  check (payment_provider in ('manual', 'mock', 'paysuite', 'mpesa', 'mpesa_sim'));

-- ---------------------------------------------------------------------------
-- Referência de pagamento por pedido
-- ---------------------------------------------------------------------------
alter table public.orders
  add column if not exists payment_reference text,
  -- Quantas vezes a referência já rodou. Só roda depois de uma falha
  -- **definitiva** — ver a função abaixo.
  add column if not exists payment_ref_seq smallint not null default 1;

create unique index if not exists orders_payment_reference_idx
  on public.orders (payment_reference)
  where payment_reference is not null;

-- ---------------------------------------------------------------------------
-- ensure_payment_reference — a peça que impede a dupla cobrança
-- ---------------------------------------------------------------------------
-- A regra, e é a razão de isto viver na base de dados e não na aplicação:
--
--   **A referência só muda quando temos a certeza de que a tentativa anterior
--   não levou dinheiro.**
--
-- Chamar outra vez sem `p_rotate` devolve sempre a MESMA referência: um duplo
-- clique, um retry automático ou uma reconciliação repetem a tentativa e o
-- M-Pesa recusa-a como duplicada, em vez de cobrar segunda vez.
--
-- `p_rotate` só é verdade depois de uma falha definitiva (cancelou, saldo
-- insuficiente). Nunca depois de um tempo esgotado: aí não sabemos se o
-- dinheiro saiu, e uma referência nova seria exactamente a segunda cobrança
-- que este desenho existe para impedir.
create or replace function public.ensure_payment_reference(
  p_order_id uuid,
  p_rotate boolean default false
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_ref text;
  v_seq smallint;
  v_base text;
begin
  select o.payment_reference, o.payment_ref_seq
  into v_ref, v_seq
  from public.orders o
  where o.id = p_order_id
  for update;

  if not found then
    raise exception 'order_not_found' using errcode = 'P0002';
  end if;

  if v_ref is not null and not p_rotate then
    return v_ref;
  end if;

  if p_rotate then
    v_seq := coalesce(v_seq, 1) + 1;
    -- Tecto: alguém a insistir vinte vezes não é um cliente com dificuldades,
    -- é um problema que ninguém está a olhar.
    if v_seq > 10 then
      raise exception 'too_many_payment_attempts' using errcode = 'P0429';
    end if;
  else
    v_seq := coalesce(v_seq, 1);
  end if;

  -- Base curta e maiúscula: o M-Pesa aceita letras e números e a referência
  -- tem de caber em 20 caracteres. 8 do uuid + sequência chega e sobra.
  v_base := upper(replace(p_order_id::text, '-', ''));
  v_ref := substr(v_base, 1, 10) || 'X' || v_seq::text;

  update public.orders
  set payment_reference = v_ref,
      payment_ref_seq = v_seq,
      updated_at = now()
  where id = p_order_id;

  return v_ref;
end;
$$;

revoke all on function public.ensure_payment_reference(uuid, boolean) from public;
grant execute on function public.ensure_payment_reference(uuid, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- Segredos: fora do alcance de quem lê a loja
-- ---------------------------------------------------------------------------
-- Mesmo padrão das chaves Paysuite. Quem edita a loja no painel fá-lo por RPC;
-- ninguém lê estas colunas directamente.
revoke select (
  mpesa_api_key,
  mpesa_public_key,
  mpesa_service_provider_code,
  mpesa_session_base_url,
  mpesa_charge_base_url,
  mpesa_query_base_url
) on public.stores from anon, authenticated;
