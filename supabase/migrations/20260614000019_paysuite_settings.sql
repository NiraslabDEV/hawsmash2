-- ============================================================================
-- DELIVERY OS — Paysuite configurável no admin (mesmo padrão dos tokens de Marketing)
-- Ref: CLAUDE.md 6.2 + 16.2 (a nota prevê paysuite_api_key/webhook_secret aqui).
--
-- Colunas SEGREDO (B) em settings — só servidor. NUNCA no get_menu() nem em RPC anon.
-- Precedência (lida no server): settings tem prioridade; se vazio, cai no .env.
-- ============================================================================

alter table settings add column if not exists paysuite_api_key        text;
alter table settings add column if not exists paysuite_webhook_secret text;

-- get_secret_settings(): inclui agora também as chaves Paysuite (server-side only).
create or replace function public.get_secret_settings()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_s record;
begin
  select * into v_s from settings where id = 1;
  return jsonb_build_object(
    'meta_capi_token',         v_s.meta_capi_token,
    'gads_developer_token',    v_s.gads_developer_token,
    'paysuite_api_key',        v_s.paysuite_api_key,
    'paysuite_webhook_secret', v_s.paysuite_webhook_secret
  );
end;
$$;

revoke all on function public.get_secret_settings() from public, anon;
grant execute on function public.get_secret_settings() to authenticated, service_role;
