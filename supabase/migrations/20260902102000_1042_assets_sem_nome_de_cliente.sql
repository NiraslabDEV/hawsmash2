-- HAWSMASH 2.0 — 1042: as fotos do cardápio seguem os assets que mudaram de sítio.
--
-- A pasta `apps/web/public/assets/hawsmash/` passou a `assets/storefront/`: o
-- produto não sabe como se chama o cliente que o está a usar (CLAUDE.md §18.3).
-- Os ficheiros mudaram de caminho, mas os endereços gravados em `menu_items`
-- pelas migrations 1014 e 1015 continuam a apontar para o caminho antigo — e
-- essas migrations **não** se editam: já correram em produção, e reescrevê-las
-- não muda nenhuma base de dados, só a história (§11.7).
--
-- Por isso a correcção é para a frente e é esta. Sem ela, a montra em produção
-- ficava com o cardápio todo sem fotos no primeiro deploy depois da mudança.

update public.menu_items
set photo_url = replace(photo_url, '/assets/hawsmash/', '/assets/storefront/')
where photo_url like '%/assets/hawsmash/%';

update public.menu_item_variants
set photo_url = replace(photo_url, '/assets/hawsmash/', '/assets/storefront/')
where photo_url like '%/assets/hawsmash/%';

-- A marca gravada na 1041 já nasce com o caminho novo; esta linha só existe
-- para a instalação que tenha corrido a 1041 antes desta mudança.
update public.brand_settings
set
  logo_path = replace(logo_path, '/assets/hawsmash/', '/assets/storefront/'),
  og_image_path = replace(og_image_path, '/assets/hawsmash/', '/assets/storefront/'),
  storefront = replace(storefront::text, '/assets/hawsmash/', '/assets/storefront/')::jsonb
where id = 1
  and (
    coalesce(logo_path, '') like '%/assets/hawsmash/%'
    or coalesce(og_image_path, '') like '%/assets/hawsmash/%'
    or storefront::text like '%/assets/hawsmash/%'
  );
