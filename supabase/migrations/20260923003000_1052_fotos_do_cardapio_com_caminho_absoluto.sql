-- HAWSMASH 2.0 — 1052: as fotos do cardápio passam a ter caminho absoluto.
--
-- Encontrado ao aplicar as migrations no LIVE: 15 dos 16 `menu_items` tinham
-- o `photo_url` com o caminho **relativo** do HAWSMASH 1.0 — `assets/burger.webp`,
-- `assets/bebidas/sprite.webp` — que lá para entrou com a importação do menu
-- antigo, por cima do que a 1014/1015 tinham gravado.
--
-- Porque é que isto é grave e não estético: o `photo_url` vai directo para o
-- `src` do componente de imagem, sem normalização. Um `src` relativo resolve a
-- partir da rota, e por isso `/l/maputo` pedia `/l/assets/burger.webp` — que
-- não existe. Na abertura, o cardápio abria sem uma única foto. Foi a 1042 que
-- tornou isto visível: procurava `/assets/hawsmash/` e não encontrou nada para
-- reescrever, porque o problema aqui era outro.
--
-- Os ficheiros existem todos em `apps/web/public/assets/storefront/`; o que
-- faltava era o endereço. As bebidas mudam por prefixo, porque o nome do
-- ficheiro já coincide. Os hambúrgueres mudam por produto: cada um passa a
-- apontar para o ficheiro que tem o nome dele, e não para o nome que o 1.0
-- lhe dava.
--
-- Forward-only e idempotente (§11.7): só toca em linhas que ainda começam por
-- `assets/`. Depois de correr, nenhuma começa — correr outra vez não faz nada.
-- Numa instalação que nunca teve o 1.0 (o staging, por exemplo) não faz nada
-- da primeira vez.
--
-- FICA POR RESOLVER, de propósito: o item "Macon smash" aponta para uma imagem
-- alojada no Supabase do HAWSMASH 1.0. Funciona enquanto o 1.0 existir, e o §15
-- dá-lhe 90 dias depois do cutover. Não se inventa aqui um ficheiro que não há
-- — a foto tem de ser carregada pelo painel, e está registada como pendente.

update public.menu_items
set photo_url = case
  when photo_url like 'assets/bebidas/%'
    then replace(photo_url, 'assets/bebidas/', '/assets/storefront/bebidas/')
  when photo_url = 'assets/burger.webp'       then '/assets/storefront/classic-smash.webp'
  when photo_url = 'assets/DOUBLE-SMASH.webp' then '/assets/storefront/double-smash.webp'
  when photo_url = 'assets/SIGNATURE.webp'    then '/assets/storefront/hawsmash-signature.webp'
  when photo_url = 'assets/CHIPS.webp'        then '/assets/storefront/joes-chips.webp'
  when photo_url = 'assets/Brisket.webp'      then '/assets/storefront/smoked-brisket.webp'
  when photo_url = 'assets/Natas.webp'        then '/assets/storefront/pasteis-de-nata.webp'
  else photo_url
end
where photo_url like 'assets/%';

-- O mesmo para as variantes, se alguma instalação as tiver herdado assim.
update public.menu_item_variants
set photo_url = case
  when photo_url like 'assets/bebidas/%'
    then replace(photo_url, 'assets/bebidas/', '/assets/storefront/bebidas/')
  else '/' || photo_url
end
where photo_url like 'assets/%';
