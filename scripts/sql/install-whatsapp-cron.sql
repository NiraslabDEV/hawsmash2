-- Instalar DEPOIS de: deploy com /api/cron/whatsapp, WHATSAPP_PROVIDER configurado no Railway e o
-- GET manual à rota a responder 200 (antes disso responde 503 e o job falhava a cada minuto).
-- Vault partilhado com install-report-crons.sql e install-email-cron.sql. ADR 0011/0012, plano §7.
--
-- A cada minuto: retoma conversas que ficaram a meio e despacha a fila (avisos e respostas).
-- Desinstalar: select cron.unschedule('app-whatsapp');
begin;
create extension if not exists pg_cron;
create extension if not exists http with schema extensions;
do $install$
begin
  if not exists(select 1 from vault.decrypted_secrets where name='app_cron_base_url' and decrypted_secret ~ '^https://[^/]+$')
    or not exists(select 1 from vault.decrypted_secrets where name='app_cron_secret' and length(decrypted_secret)>=32) then
    raise exception 'Configurar Vault antes do cron do WhatsApp';
  end if;
  perform cron.schedule('app-whatsapp','* * * * *',$job$
    do $run$
    declare base text; secret text; response extensions.http_response;
    begin
      select decrypted_secret into strict base from vault.decrypted_secrets where name='app_cron_base_url';
      select decrypted_secret into strict secret from vault.decrypted_secrets where name='app_cron_secret';
      perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS','55000');
      select * into response from extensions.http(('GET',base||'/api/cron/whatsapp',array[extensions.http_header('Authorization','Bearer '||secret)],null,null)::extensions.http_request);
      -- 502 = alguma mensagem falhou e voltou à fila (o retry é da própria fila); só 503/401 indicam avaria.
      if response.status not in (200, 502) then raise exception 'WhatsApp: HTTP %',response.status; end if;
    end $run$;
  $job$);
end $install$;
commit;
