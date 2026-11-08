-- 1135 — a Hawsteak Ciabatta e o Haw Dog perdem o fundo.
--
-- ⚠ NÃO COPIAR para outra instalação. Dados desta casa.
--
-- Pedido do dono (8 Nov), igual à 1134 das pizzas: as fotos reais, postas
-- pelo painel, mostravam o papel da casa, o jardim e (no Haw Dog) um segundo
-- hot dog cortado no canto. Recortadas no Higgsfield em fundo transparente,
-- 720×720, em `/assets/storefront/sandes/` — chegam no deploy, ANTES desta
-- migration.
--
-- Só troca a foto quando ela ainda é a original (o objecto do Storage que lá
-- está a 8 Nov); uma foto mudada depois pelo painel fica. Idempotente.

update public.menu_items i
   set photo_url = f.nova
  from (values
    ('4c4dd7e6-d26c-413d-a587-66f9d36b2a83', '/assets/storefront/sandes/hawsteak-ciabatta.webp'),
    ('9b780127-5432-4862-b42b-395e2fba4064', '/assets/storefront/sandes/haw-dog.webp')
  ) as f(objecto, nova)
 where i.photo_url like '%/menu-photos/' || f.objecto || '.jpeg';
