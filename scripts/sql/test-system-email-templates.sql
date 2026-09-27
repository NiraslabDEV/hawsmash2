begin;
do $$ declare s uuid; owner_id uuid; begin
  select id into strict s from public.stores order by sort,id limit 1;
  select user_id into strict owner_id from public.staff_profiles where role='owner' and active limit 1;
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  perform public.email_save_system(s,'{"key":"paid","mode":"custom","enabled":true,"template_id":"gold","step":{"subject":"Obrigado","preheader":"","delay_minutes":0,"blocks":[{"type":"system"}]}}');
  if not exists(select 1 from public.email_system_templates where store_id=s and key='paid' and mode='custom') then raise exception 'Não guardou'; end if;
  begin
    perform public.email_save_system(s,'{"key":"account_code","mode":"custom","enabled":false,"template_id":"gold","step":{"subject":"X","preheader":"","delay_minutes":0,"blocks":[{"type":"system"}]}}');
    raise exception 'Aceitou desligar OTP';
  exception when raise_exception then if SQLERRM<>'invalid_system_template' then raise; end if; end;
  begin
    perform public.email_save_system(s,'{"key":"paid","mode":"custom","enabled":true,"template_id":"gold","step":{"subject":"X","preheader":"","delay_minutes":0,"blocks":[{"type":"text","text":"Sem dados"}]}}');
    raise exception 'Aceitou retirar dados';
  exception when raise_exception then if SQLERRM<>'invalid_system_template' then raise; end if; end;
  if has_table_privilege('anon','public.email_system_templates','select') then raise exception 'Anon lê modelos'; end if;
  if has_table_privilege('authenticated','public.email_system_templates','update') then raise exception 'Escrita sem auditoria'; end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000099',true);
do $$ begin if exists(select 1 from public.email_system_templates) then raise exception 'Sessão sem perfil lê modelos'; end if; end $$;
reset role;
rollback;
