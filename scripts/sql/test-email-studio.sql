-- Ensaio numa transacção: não cria pedidos, não envia, não deixa dados.
begin;
do $$
declare s uuid; f uuid; n integer; j uuid; owner_id uuid; other_store uuid;
begin
  select id into strict s from public.stores order by id limit 1;
  select id into strict other_store from public.stores where id<>s order by id limit 1;
  select user_id into strict owner_id from public.staff_profiles where role='owner' and active limit 1;
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  begin
    perform public.email_save(s,'flow','{"name":"PLACEHOLDER_BAD","kind":"transactional","trigger":"paid","status":"draft","steps":[{"subject":"X","delay_minutes":-1,"blocks":[]}]}');
    raise exception 'Aceitou intervalo negativo';
  exception when raise_exception then
    if SQLERRM <> 'invalid_steps' then raise; end if;
  end;
  insert into public.email_flows(store_id,name,kind,trigger,status,steps)
  values(s,'PLACEHOLDER_ENSAIO','marketing','manual','active',
    '[{"subject":"Ensaio","preheader":"","delay_minutes":0,"blocks":[{"type":"text","text":"Ensaio"}]},{"subject":"Segundo","preheader":"","delay_minutes":15,"blocks":[{"type":"text","text":"Ensaio"}]}]') returning id into f;
  if public.email_enrol(f,'PLACEHOLDER@example.test','Ensaio','manual') <> 0 then raise exception 'Sem consentimento não pode entrar'; end if;
  insert into public.email_contacts(store_id,email,name,consent_source) values(s,'placeholder@example.test','Ensaio','Ensaio SQL');
  n := public.email_enrol(f,'PLACEHOLDER@example.test','Ensaio','manual');
  if n <> 2 then raise exception 'Esperava duas etapas, recebeu %',n; end if;
  if public.email_enrol(f,'placeholder@example.test','Ensaio','manual') <> 0 then raise exception 'Inscrição duplicada'; end if;
  if public.email_enrol(f,'other@example.test','Outra loja','manual') <> 0 then raise exception 'Consentimento de outra pessoa'; end if;
  insert into public.email_contacts(store_id,email,name,consent_source) values(other_store,'other@example.test','Outra loja','Ensaio SQL');
  if public.email_enrol(f,'other@example.test','Outra loja','manual') <> 0 then raise exception 'Consentimento de outra loja'; end if;
  if (select count(*) from public.email_jobs where flow_id=f and due_at is not null) <> 1 then raise exception 'Segunda etapa tem de esperar'; end if;
  select id into j from public.email_jobs where flow_id=f and step_index=0;
  insert into public.email_settings(store_id,enabled,password_configured) values(s,true,true)
    on conflict(store_id) do update set enabled=true,password_configured=true;
  update public.email_flows set status='paused' where id=f;
  if exists(select 1 from public.email_claim() where id=j) then raise exception 'Funil pausado foi reclamado'; end if;
  update public.email_flows set status='active' where id=f;
  if not exists(select 1 from public.email_claim() where id=j) then raise exception 'Mensagem vencida não foi reclamada'; end if;
  if exists(select 1 from public.email_claim() where id=j) then raise exception 'Claim duplicado'; end if;
  perform public.email_finish(j,true,null);
  if not exists(select 1 from public.email_jobs where flow_id=f and step_index=1 and due_at >= now()+interval '14 minutes') then raise exception 'Espera a contar do envio real'; end if;
  perform public.email_finish(j,true,null);
  if (select count(*) from public.email_jobs where flow_id=f) <> 2 then raise exception 'Finish repetido duplicou fila'; end if;
  perform public.email_unsubscribe((select unsubscribe_token from public.email_contacts where store_id=s and email='placeholder@example.test'));
  if exists(select 1 from public.email_jobs where flow_id=f and status='queued') then raise exception 'Cancelar subscrição deve cancelar fila'; end if;
  if has_function_privilege('anon','public.email_claim()','execute') then raise exception 'Anon pode reclamar fila'; end if;
  if has_function_privilege('authenticated','public.email_smtp(uuid)','execute') then raise exception 'Staff pode ler senha'; end if;
  if has_table_privilege('authenticated','private.email_passwords','select') then raise exception 'Staff lê segredo'; end if;
  -- O gerente não lê nem escreve a configuração de emails, mesmo tendo loja.
  select user_id into owner_id from public.staff_profiles where role='manager' and active limit 1;
  if owner_id is not null then
    perform set_config('request.jwt.claim.sub',owner_id::text,true);
    begin perform public.email_save(s,'contact','{"email":"bad@example.test","name":"X","consent_source":"SQL"}'); raise exception 'Gerente escreveu';
    exception when sqlstate 'P0403' then null; end;
  end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000099',true);
do $$ begin
  if exists(select 1 from public.email_flows) then raise exception 'Sessão desconhecida lê funis'; end if;
  begin insert into public.email_settings(store_id) values('00000000-0000-4000-8000-000000000101'); raise exception 'Escrita directa permitida'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role anon;
do $$ begin
  begin perform 1 from public.email_contacts; raise exception 'Anon lê contactos'; exception when insufficient_privilege then null; end;
end $$;
rollback;
