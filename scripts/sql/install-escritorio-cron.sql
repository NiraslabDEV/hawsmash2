-- Instalar DEPOIS de: migrations 1140/1141 aplicadas, deploy com /api/cron/escritorio e o GET manual à rota a
-- responder 200. Vault partilhado com os outros crons (app_cron_base_url, app_cron_secret). ADR 0014.
--
-- A cada 15 minutos: emite as facturas que ficaram pendentes e avisa o dono (prazos, validades, facturação).
-- O email de cada assunto sai uma vez por dia; correr mais vezes só serve para os pendentes saírem cedo.
-- Desinstalar: select cron.unschedule('app-escritorio');
begin;
create extension if not exists pg_cron;
create extension if not exists http with schema extensions;
do $install$
begin
  if not exists(select 1 from vault.decrypted_secrets where name='app_cron_base_url' and decrypted_secret ~ '^https://[^/]+$')
    or not exists(select 1 from vault.decrypted_secrets where name='app_cron_secret' and length(decrypted_secret)>=32) then
    raise exception 'Configurar Vault antes do cron do Escritório';
  end if;
  perform cron.schedule('app-escritorio','*/15 * * * *',$job$
    do $run$
    declare base text; secret text; response extensions.http_response;
    begin
      select decrypted_secret into strict base from vault.decrypted_secrets where name='app_cron_base_url';
      select decrypted_secret into strict secret from vault.decrypted_secrets where name='app_cron_secret';
      perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS','55000');
      select * into response from extensions.http(('GET',base||'/api/cron/escritorio',array[extensions.http_header('Authorization','Bearer '||secret)],null,null)::extensions.http_request);
      if response.status <> 200 then raise exception 'Escritório: HTTP %',response.status; end if;
    end $run$;
  $job$);
end $install$;
commit;
