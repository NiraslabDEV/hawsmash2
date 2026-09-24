-- 1082: as mesas desta instalação — 6 em cada loja.
--
-- ⚠ NÃO COPIAR para outra instalação. É a migração de DADOS desta casa; a de
-- estrutura, portável, é a 1081.
--
-- Pedido do dono (24 Set): 6 mesas por agora, em Maputo e na Matola, cada uma
-- com o seu QR (token próprio, gerado pela tabela). As mesas 1 e 2 que o dono
-- abriu para ver o link ficam como estão — são as primeiras de Maputo, e o QR
-- delas não muda. Mais mesas, ou tirar uma: pelo painel.
--
-- Só corre onde a marca é esta, e nunca pisa uma mesa que já exista.

insert into public.tables (store_id, number)
select s.id, n
from public.stores s
cross join generate_series(1, 6) as n
where s.active
  and exists (select 1 from public.brand_settings b where b.name ilike 'hawsmash%')
on conflict (store_id, number) do nothing;
