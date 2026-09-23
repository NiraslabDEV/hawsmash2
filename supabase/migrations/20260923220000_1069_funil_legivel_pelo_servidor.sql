-- 1069: o servidor (service_role) consegue ler o funil.
--
-- A 1066 criou `analytics_sessions`, que chama as funções `private.attr_*`, e
-- deu-lhes execute a `service_role` — mas o schema `private` só tinha USAGE
-- para `authenticated` (1004). Resultado no staging: o painel funcionava (a
-- RPC corre como o dono/gerente) e qualquer leitura com a chave de serviço
-- — relatórios, digest diário, scripts de validação do RASTREIO.md — morria
-- em "permission denied for schema private".
--
-- service_role já passa por cima da RLS; o USAGE só o deixa chamar as funções
-- a que a 1066 já lhe deu execute. As outras funções do schema continuam com
-- os seus próprios grants.

grant usage on schema private to service_role;
