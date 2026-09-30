-- 1107 — o Macon Smash volta a ter foto.
--
-- Era a pendência deixada pela 1052: no 1.0 a foto vivia no Storage do
-- Supabase antigo (`product-images/1783961763377-5mpzzscv9ir.jpeg`), uma foto
-- de telemóvel em cima do papel da casa. No LIVE o item ficou sem foto.
--
-- Foto (30 Set): refeita no Higgsfield a partir dessa foto real — o mesmo
-- burger, pão marcado HAWSMASH, macon e molho — em estúdio, recortada em fundo
-- transparente e sem logo no canto, como os outros burgers de
-- `/assets/storefront/`.
--
-- Só preenche quando não há foto ou quando ainda aponta para o 1.0: uma foto
-- que a loja tenha posto pelo painel não é tocada. Idempotente; numa
-- instalação sem este produto não faz nada.

update public.menu_items
set photo_url = '/assets/storefront/macon-smash.webp'
where lower(name) = 'macon smash'
  and (photo_url is null
       or photo_url = ''
       or photo_url like '%tsrgileifpiaiicwjfar%');
