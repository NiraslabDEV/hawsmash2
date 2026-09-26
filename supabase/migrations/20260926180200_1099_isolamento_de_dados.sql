-- HAWSMASH 2.0 — 1099: dados de uma loja, e de um cliente, só para quem deve.
--
-- Auditoria de 26/09 (docs/AUDITORIA-DOCUMENTACAO.md §5), provada numa BD local
-- antes de corrigir.
--
-- V-01. `identify_customer` e `get_customer_orders` estavam abertas a `anon`:
--       com um número de telefone, qualquer pessoa lia o nome, o histórico e os
--       ids dos pedidos de um cliente — e o id de um pedido abre a conta dele
--       (`account_bind_device`), com as moradas guardadas. ADR 0003: o
--       telefone sozinho não chega. O balcão (POS) e o painel continuam a
--       usá-las com sessão; a loja pública já não as chama (a MenuExperience
--       que o fazia não está ligada a nenhuma página).
--
-- V-02. O bucket privado `payment-proofs` tinha uma policy `for all` para
--       qualquer `authenticated`, filtrada só pelo bucket: um caixa da Matola
--       lia e apagava comprovativos de Maputo (regra 3). Agora:
--         - ler: equipa da loja do pedido (sem a cozinha — não vê dinheiro);
--           o comprovativo vive em `<order_id>/…`;
--         - enviar: como o checkout anónimo (a equipa com sessão aberta no
--           mesmo browser também pode fazer um pedido);
--         - mudar/apagar: ninguém pela API — é a prova de um pagamento.
--
-- V-04. `store_items` aceitava UPDATE/INSERT directo de owner/manager em
--       qualquer coluna: `stock_qty` e `price_cents_override` mudavam sem
--       `stock_movements` nem `event_log` (CLAUDE §6/§10). As RPCs auditadas
--       (`adjust_store_stock`, `set_stock_tracking`, `set_item_availability`,
--       campanhas) são SECURITY DEFINER e não dependem destes privilégios. O
--       painel só escreve `available` directamente — é o único que fica.
--
-- V-05. `order_attribution` e `conversion_jobs` deixavam ler a qualquer
--       `authenticated` as linhas sem loja. A excepção da regra 3 é para o
--       tráfego antes da escolha de loja; fica só para o dono.

-- ---------------------------------------------------------------------------
-- V-01
-- ---------------------------------------------------------------------------
revoke execute on function public.identify_customer(text, text) from public, anon;
revoke execute on function public.get_customer_orders(text) from public, anon;
grant execute on function public.identify_customer(text, text) to authenticated, service_role;
grant execute on function public.get_customer_orders(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- V-02
-- ---------------------------------------------------------------------------
create or replace function private.can_read_payment_proof(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_folder text := split_part(coalesce(p_name, ''), '/', 1);
begin
  if coalesce(private.auth_role(), '') not in ('owner', 'manager', 'cashier') then
    return false;
  end if;
  if v_folder !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return exists (
    select 1
    from public.orders o
    where o.id = v_folder::uuid
      and private.auth_can_store(o.store_id)
  );
end;
$$;

revoke execute on function private.can_read_payment_proof(text) from public, anon, authenticated;
grant execute on function private.can_read_payment_proof(text) to authenticated;

drop policy if exists "payment_proofs_authenticated_all" on storage.objects;
drop policy if exists "payment_proofs_store_select" on storage.objects;
drop policy if exists "payment_proofs_authenticated_insert" on storage.objects;

create policy "payment_proofs_store_select" on storage.objects for select
  to authenticated
  using (bucket_id = 'payment-proofs' and private.can_read_payment_proof(name));

create policy "payment_proofs_authenticated_insert" on storage.objects for insert
  to authenticated
  with check (bucket_id = 'payment-proofs');

-- ---------------------------------------------------------------------------
-- V-04
-- ---------------------------------------------------------------------------
revoke insert, update on public.store_items from authenticated;
grant update (available) on public.store_items to authenticated;

-- ---------------------------------------------------------------------------
-- V-05
-- ---------------------------------------------------------------------------
drop policy if exists order_attribution_staff_select on public.order_attribution;
create policy order_attribution_staff_select on public.order_attribution
  for select to authenticated
  using (
    case when store_id is null then private.auth_is_owner()
         else private.auth_can_store(store_id) end
  );

drop policy if exists conversion_jobs_staff_select on public.conversion_jobs;
create policy conversion_jobs_staff_select on public.conversion_jobs
  for select to authenticated
  using (
    case when store_id is null then private.auth_is_owner()
         else private.auth_can_store(store_id) end
  );
