-- Instalação por ambiente, depois do deploy e da configuração do Vault.
-- DECISÃO: usar o Supabase já existente; não contratar outro scheduler.
-- Os segredos app_cron_base_url e app_cron_secret são configurados fora do Git.
-- Sem ambos, os jobs não fazem pedidos. Não há retry automático de email.
begin;
create extension if not exists pg_cron;
-- DECISÃO: HTTP síncrono só no processo do cron. pg_net nesta instalação concede
-- acesso à fila a PUBLIC; não guardar nela o cabeçalho com o segredo.
create extension if not exists http with schema extensions;

do $install$
declare
  task record;
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'app_cron_base_url'
    and decrypted_secret ~ '^https://[^/]+$')
    or not exists (select 1 from vault.decrypted_secrets where name = 'app_cron_secret'
      and length(decrypted_secret) >= 32) then
    raise exception 'Configurar app_cron_base_url e app_cron_secret no Vault primeiro';
  end if;
  for task in select * from (values
    ('app-digest', '0 6 * * *', 'digest'),
    ('app-monthly', '0 6 1 * *', 'monthly')
  ) as tasks(name, schedule, endpoint)
  loop
    perform cron.schedule(task.name, task.schedule, format($job$
      do $run$
      declare
        base text;
        secret text;
        response extensions.http_response;
        result jsonb;
      begin
        select decrypted_secret into strict base from vault.decrypted_secrets where name='app_cron_base_url';
        select decrypted_secret into strict secret from vault.decrypted_secrets where name='app_cron_secret';
        perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '120000');
        select * into response from extensions.http((
          'GET', base || '/api/cron/%s' ||
            case when '%s' = 'digest' then
              '?day=' || ((now() at time zone 'Africa/Maputo')::date - 1)::text
            else '' end,
          array[extensions.http_header('Authorization', 'Bearer ' || secret)],
          null, null
        )::extensions.http_request);
        if response.status <> 200 then
          raise exception using message = 'Falha no cron: HTTP ' || response.status;
        end if;
        result := response.content::jsonb;
        if result->>'delivery' is distinct from 'sent'
          and result->>'skipped' is distinct from 'already_sent' then
          -- Não confundir HTTP 200 com email entregue. Fica visível no histórico do cron.
          raise exception 'Resumo não enviado; consultar event_log e configuração SMTP';
        end if;
      end;
      $run$;
    $job$, task.endpoint, task.endpoint));
  end loop;
end;
$install$;
commit;
