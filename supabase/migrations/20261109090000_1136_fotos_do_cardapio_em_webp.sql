-- 1136 — as fotos do cardápio que ainda eram PNG passam a WebP.
--
-- ⚠ NÃO COPIAR para outra instalação. Dados desta casa.
--
-- 25 fotos postas pelo painel (15 artigos e 10 variantes, quase todas bebidas)
-- eram PNG de 1 a 2,6 MB — 49 MB no total, descarregados por inteiro pelo POS e
-- pelo telemóvel do garçom. Convertidas sem perder o fundo transparente, no
-- máximo 900 px, WebP q80: 2,3 MB no total. Ficam em
-- `/assets/storefront/cardapio/` e chegam no deploy, ANTES desta migration.
--
-- Só troca a foto quando ela ainda é a original do Storage; uma foto mudada
-- depois pelo painel fica. Os objectos do Storage não são apagados. Idempotente.

update public.menu_items i
   set photo_url = f.nova
  from (values
    ('ed388522-0994-49a0-b331-8511426ed4da.png', '/assets/storefront/cardapio/agua-das-pedras.webp'),  -- Água das Pedras
    ('ce955dc1-81df-4436-bf7c-a109ee59b7bb.png', '/assets/storefront/cardapio/agua-vengo-1-5-l.webp'),  -- Agua Vengo 1,5 L
    ('d3cbd745-deb7-4aa0-8b5e-7efe937a16c2.png', '/assets/storefront/cardapio/chicken-smash.webp'),  -- Chicken Smash
    ('1f9e2d55-3df6-49d2-a18f-18f035ac4665.png', '/assets/storefront/cardapio/cafe.webp'),  -- Café
    ('a70ed833-b4ba-46fb-adbc-8e7254f8f6fa.png', '/assets/storefront/cardapio/brigadeiros.webp'),  -- Brigadeiros
    ('ebd94d68-d415-4367-915b-af0799064536.png', '/assets/storefront/cardapio/schweppes.webp'),  -- Schweppes
    ('0e2e6479-b4e7-4851-a522-109e5e8586af.png', '/assets/storefront/cardapio/cappy-maracuja.webp'),  -- Cappy Maracuja
    ('fbd0b2dd-1d6f-4d5f-af04-99e8dcedc4c7.png', '/assets/storefront/cardapio/agua-vimeiro.webp'),  -- Agua Vimeiro
    ('1dd0843a-60c9-41d3-b700-1a6440af1977.png', '/assets/storefront/cardapio/batata-frita.webp'),  -- Batata Frita
    ('3bf0a79d-3692-459c-9bc8-12ea9918dfb9.png', '/assets/storefront/cardapio/agua-vengo-500ml.webp'),  -- Agua Vengo 500ml
    ('d7c8fdb3-0786-4e23-870d-efbced62c498.png', '/assets/storefront/cardapio/cappy-laranja.webp'),  -- Cappy Laranja
    ('10423407-5d8e-4b79-8e6b-edc8809bf825.png', '/assets/storefront/cardapio/compal-laranja.webp'),  -- Compal Laranja
    ('3fea1f84-62f4-4a37-bebd-814fdba88d67.png', '/assets/storefront/cardapio/cappy-manga.webp'),  -- Cappy Manga
    ('c3cc004b-50da-49b1-b537-87b5fcf54b3c.png', '/assets/storefront/cardapio/sprite-garrafinha.webp'),  -- Sprite Garrafinha
    ('86ad37d3-fa71-4c08-897f-eb1eaf205c57.png', '/assets/storefront/cardapio/agua-vengo-330-ml.webp')   -- Água Vengo 330 ML
  ) as f(objecto, nova)
 where i.photo_url like '%/menu-photos/' || f.objecto;

update public.menu_item_variants i
   set photo_url = f.nova
  from (values
    ('bcbb0cdd-41e9-40ed-b10b-fd17ecba75ab.png', '/assets/storefront/cardapio/agua-das-pedras-acai.webp'),  -- Água das Pedras Açaí
    ('4797815c-6ccc-4255-a37e-e52eb32ca7fc.png', '/assets/storefront/cardapio/agua-das-pedras-tangerina.webp'),  -- Água das Pedras Tangerina
    ('076acd5d-14be-4446-b64e-416d7544ad61.png', '/assets/storefront/cardapio/sparletta-morango.webp'),  -- Sparletta Morango
    ('c4f196c2-bc2b-42a5-b58d-99eacc930792.png', '/assets/storefront/cardapio/sparletta-creme-soda.webp'),  -- Sparletta Creme Soda
    ('a0fe46eb-0ede-4d94-909e-7543a4d167d8.png', '/assets/storefront/cardapio/coca-cola-normal.webp'),  -- Coca-Cola Normal
    ('024a7422-52e2-4f6c-aff8-d2be2d6e5b17.png', '/assets/storefront/cardapio/fanta-laranja.webp'),  -- Fanta Laranja
    ('e1a1f22d-a0d6-4274-a6df-406241692f21.png', '/assets/storefront/cardapio/coca-cola-zero.webp'),  -- Coca-Cola Zero
    ('7985016b-fc91-49b7-94b6-dc8867eb8686.png', '/assets/storefront/cardapio/agua-das-pedras-limao.webp'),  -- Água das Pedras Limão
    ('26baf68e-c243-4aec-85b6-d4e1e2154fa7.png', '/assets/storefront/cardapio/agua-das-pedras-morango.webp'),  -- Água das Pedras Morango
    ('95caa141-ca8a-4f25-84fc-6a3d2fd003b4.png', '/assets/storefront/cardapio/agua-das-pedras-maracuja.webp')   -- Água das Pedras Maracujá
  ) as f(objecto, nova)
 where i.photo_url like '%/menu-photos/' || f.objecto;
