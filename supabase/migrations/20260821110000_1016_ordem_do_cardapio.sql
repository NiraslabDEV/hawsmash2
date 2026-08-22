-- HAWSMASH 2.0 — 1016: ordem do cardápio como o dono a quer ver.
--
-- Lanches primeiro (é o que traz a pessoa ao site), bebidas a seguir (é o que
-- mais se junta a um lanche), depois os acompanhamentos e, no fim, a sobremesa.
-- A categoria "Extras" passa a chamar-se "Acompanhamentos" — é o nome que a
-- casa usa e o que o cliente lê na aba.
--
-- A ordem vive na BD (`menu_categories.sort`), não no código: o dono muda-a
-- pelo painel sem esperar por um deploy.

update public.menu_categories set name = 'Acompanhamentos'
where name = 'Extras'
  and not exists (
    select 1 from public.menu_categories where name = 'Acompanhamentos'
  );

update public.menu_categories set sort = 1 where name = 'Burgers';
update public.menu_categories set sort = 2 where name = 'Bebidas';
update public.menu_categories set sort = 3 where name = 'Acompanhamentos';
update public.menu_categories set sort = 4 where name = 'Sobremesas';
