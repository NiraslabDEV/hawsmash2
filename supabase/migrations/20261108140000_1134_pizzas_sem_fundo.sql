-- 1134 — as pizzas perdem o fundo branco.
--
-- ⚠ NÃO COPIAR para outra instalação. Dados desta casa.
--
-- Pedido do dono (8 Nov): as fotos reais das pizzas, postas pelo painel, foram
-- tiradas em fundo branco (ou creme) e destoam do site escuro e do POS. As
-- mesmas fotos foram recortadas (Higgsfield) em fundo transparente, 720×720,
-- e vivem em `/assets/storefront/pizzas/` — chegam no deploy, que vai ANTES
-- desta migration.
--
-- Só troca a foto quando ela ainda é a do fundo branco (o objecto do Storage
-- que lá está a 8 Nov). Uma foto que a loja tenha mudado pelo painel depois
-- disso fica como está. Idempotente; noutra instalação não encontra nada.

update public.menu_items i
   set photo_url = f.nova
  from (values
    ('0c8043c4-f8af-46a5-95de-3ca3d023286c', '/assets/storefront/pizzas/atum.webp'),
    ('a9e75f5e-3f94-4937-999e-2dfe0b6dee8e', '/assets/storefront/pizzas/cheese-macon-v2.webp'),
    ('7ae017c7-4021-436a-93ba-2d9794f07e62', '/assets/storefront/pizzas/cheese-macon-v2.webp'),
    ('7314142b-b208-4cbc-820e-16fa2f758967', '/assets/storefront/pizzas/margherita-v2.webp'),
    ('923c0f56-3cb5-4973-9b4c-1a3f0aa8da91', '/assets/storefront/pizzas/margherita-v2.webp'),
    ('b590fa36-8074-48e9-a253-d802c19f1875', '/assets/storefront/pizzas/smoked-brisket-v2.webp')
  ) as f(objecto, nova)
 where i.photo_url like '%/menu-photos/' || f.objecto || '.jpeg';
