-- 1093: Maputo passa a 20 mesas.
--
-- ⚠ NÃO COPIAR para outra instalação. É a migração de DADOS desta casa.
--
-- Pedido do dono (25 Set): em Maputo as mesas a mais servem de conta por
-- pessoa — a equipa escreve o nome do cliente (1092) e a mesa passa a ser a
-- conta dele. Chega às 20; cada mesa nova com o seu QR (token próprio). A
-- Matola fica com as 6 da 1082. Mais, ou menos: pelo painel.
--
-- Só corre onde a marca é esta, e nunca pisa uma mesa que já exista.

insert into public.tables (store_id, number)
select s.id, n
from public.stores s
cross join generate_series(1, 20) as n
where s.slug = 'maputo'
  and s.active
  and exists (select 1 from public.brand_settings b where b.name ilike 'hawsmash%')
on conflict (store_id, number) do nothing;
