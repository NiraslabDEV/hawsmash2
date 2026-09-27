-- Instalar APÓS publicar /api/cron/emails. Vault partilhado com install-report-crons.sql.
begin;
create extension if not exists pg_cron;
create extension if not exists http with schema extensions;
do $install$
begin
  if not exists(select 1 from vault.decrypted_secrets where name='app_cron_base_url' and decrypted_secret ~ '^https://[^/]+$')
    or not exists(select 1 from vault.decrypted_secrets where name='app_cron_secret' and length(decrypted_secret)>=32) then
    raise exception 'Configurar Vault antes do cron de emails';
  end if;
  perform cron.schedule('app-emails','* * * * *',$job$
    do $run$
    declare base text; secret text; response extensions.http_response;
    begin
      select decrypted_secret into strict base from vault.decrypted_secrets where name='app_cron_base_url';
      select decrypted_secret into strict secret from vault.decrypted_secrets where name='app_cron_secret';
      perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS','55000');
      select * into response from extensions.http(('GET',base||'/api/cron/emails',array[extensions.http_header('Authorization','Bearer '||secret)],null,null)::extensions.http_request);
      if response.status<>200 then raise exception 'Fila de emails: HTTP %',response.status; end if;
    end $run$;
  $job$);
  perform cron.schedule('app-alerts','*/5 * * * *',$job$
    do $run$
    declare base text; secret text; response extensions.http_response;
    begin
      select decrypted_secret into strict base from vault.decrypted_secrets where name='app_cron_base_url';
      select decrypted_secret into strict secret from vault.decrypted_secrets where name='app_cron_secret';
      perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS','55000');
      select * into response from extensions.http(('GET',base||'/api/cron/alerts',array[extensions.http_header('Authorization','Bearer '||secret)],null,null)::extensions.http_request);
      if response.status<>200 then raise exception 'Alertas: HTTP %',response.status; end if;
    end $run$;
  $job$);
end $install$;
commit;
