-- 1067: definições do POS, por loja.
--
-- Porquê (CLAUDE.md §18.2/§18.3): os meios de pagamento, as notas rápidas, as
-- frases do upsell e o comportamento do ecrã do balcão estavam escritos no
-- código do POS. Mudar uma frase era um deploy; levar o POS para outro
-- restaurante era reescrever um ficheiro com o cardápio de outra casa.
--
-- A partir daqui cada loja tem uma linha em `store_pos_settings`, editada na
-- aba **POS** do painel. O `config` é jsonb de propósito: a aplicação lê-o
-- campo a campo por cima do valor de fábrica (`apps/web/lib/pos/settings.ts`),
-- por isso uma loja pode gravar só o que muda e uma chave estragada nunca
-- deixa o balcão sem vender.
--
-- O que isto NÃO é: regra de dinheiro. Esconder o cartão no POS é escolha de
-- ecrã; `create_counter_sale` não a impõe, para que uma venda offline feita
-- antes da mudança continue a sincronizar (§7.5).
--
-- Portável: não depende de nada do HAWSMASH. Ver docs/POS-DEFINICOES.md.
-- Idempotente e forward-only (§11.7).

create table if not exists public.store_pos_settings (
  store_id   uuid primary key references public.stores(id) on delete cascade,
  config     jsonb not null default '{}'::jsonb
             check (jsonb_typeof(config) = 'object'),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

comment on table public.store_pos_settings is
  'Definições do ecrã do POS por loja (pagamentos, upsell, notas rápidas). Escrita só por save_pos_settings().';

alter table public.store_pos_settings enable row level security;

-- Leitura directa: só quem pode ver a loja (Regra 3). Nunca `using (true)`.
drop policy if exists store_pos_settings_select on public.store_pos_settings;
create policy store_pos_settings_select on public.store_pos_settings
for select to authenticated
using ((select private.auth_can_store(store_id)));

-- Escrita: só por RPC. Sem policy de insert/update/delete — a auditoria não
-- tem porta lateral. Esta base não dá privilégios por omissão a tabelas
-- novas: sem os grants explícitos, até a leitura com policy falha.
revoke all on public.store_pos_settings from anon;
revoke insert, update, delete on public.store_pos_settings from authenticated;
grant select on public.store_pos_settings to authenticated;
grant select, insert, update, delete on public.store_pos_settings to service_role;

-- ---------------------------------------------------------------------------
-- get_pos_settings — o POS e o painel lêem por aqui
-- ---------------------------------------------------------------------------
-- Devolve `{}` quando a loja ainda não gravou nada: a aplicação usa então o
-- valor de fábrica. Qualquer perfil da loja lê (o operador do balcão precisa).
create or replace function public.get_pos_settings(p_store_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_row public.store_pos_settings;
begin
  if (select auth.uid()) is null or not private.auth_can_store(p_store_id) then
    raise exception 'pos_settings_denied' using errcode = 'P0403';
  end if;

  select * into v_row from public.store_pos_settings where store_id = p_store_id;

  return jsonb_build_object(
    'store_id', p_store_id,
    'config', coalesce(v_row.config, '{}'::jsonb),
    'updated_at', v_row.updated_at
  );
end;
$$;

revoke all on function public.get_pos_settings(uuid) from public, anon;
grant execute on function public.get_pos_settings(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- save_pos_settings — dono e gerente da loja, sempre logado
-- ---------------------------------------------------------------------------
-- Substitui o `config` inteiro: o painel envia sempre o objecto completo, já
-- limpo pelo mesmo `resolvePosSettings` que o POS usa para o ler.
-- Operação da loja (§6: o gerente tem "operação completa da loja").
create or replace function public.save_pos_settings(p_store_id uuid, p_config jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_role text;
  v_before jsonb;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0020';
  end if;

  v_role := private.auth_role();
  if v_role is null or v_role not in ('owner', 'manager') or not private.auth_can_store(p_store_id) then
    raise exception 'pos_settings_denied' using errcode = 'P0403';
  end if;

  if p_config is null or jsonb_typeof(p_config) <> 'object' then
    raise exception 'invalid_payload' using errcode = 'P0400';
  end if;
  -- Tecto de tamanho: são definições de ecrã, não um sítio para guardar coisas.
  if length(p_config::text) > 32768 then
    raise exception 'pos_settings_too_large' using errcode = 'P0400';
  end if;

  if not exists (select 1 from public.stores where id = p_store_id) then
    raise exception 'store_not_found' using errcode = 'P0404';
  end if;

  select config into v_before from public.store_pos_settings where store_id = p_store_id;

  insert into public.store_pos_settings as s (store_id, config, updated_at, updated_by)
  values (p_store_id, p_config, now(), v_uid)
  on conflict (store_id) do update set
    config = excluded.config,
    updated_at = now(),
    updated_by = v_uid;

  insert into public.event_log (store_id, actor_user_id, type, payload)
  values (
    p_store_id,
    v_uid,
    'store.pos_settings_changed',
    jsonb_build_object(
      -- Só as secções que mudaram: é o que responde a "quem tirou o cartão?".
      'changed', (
        select coalesce(jsonb_agg(k order by k), '[]'::jsonb)
        from (
          select key as k from jsonb_each(p_config)
          union
          select key from jsonb_each(coalesce(v_before, '{}'::jsonb))
        ) chaves
        where (p_config -> k) is distinct from (coalesce(v_before, '{}'::jsonb) -> k)
      )
    )
  );

  return public.get_pos_settings(p_store_id);
end;
$$;

revoke all on function public.save_pos_settings(uuid, jsonb) from public, anon;
grant execute on function public.save_pos_settings(uuid, jsonb) to authenticated;
