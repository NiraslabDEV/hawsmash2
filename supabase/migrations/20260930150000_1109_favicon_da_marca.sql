-- 1109 — o site passa a ter favicon.
--
-- Até aqui `brand_settings.favicon_path` estava vazio e o separador do browser
-- mostrava o ícone genérico. O ícone (30 Set) nasce do logo: o hambúrguer
-- creme sobre preto com aro dourado, gerado no Higgsfield (GPT Image 2) para
-- os tamanhos grandes e redesenhado píxel a píxel a 16, 24 e 32 px, onde as
-- camadas do logo ficavam mais finas do que um píxel. Um só `.ico` com
-- 16–256 px; o browser escolhe o tamanho.
--
-- Só preenche quando o favicon está vazio e a marca é esta: um favicon que o
-- dono ponha pela Aparência não é tocado, e numa instalação nova (sem linha em
-- `brand_settings`) ou de outra marca não faz nada. Idempotente. A montra lê a
-- marca com cache de 60 s, por isso o ícone aparece até um minuto depois.

update public.brand_settings
set favicon_path = '/assets/storefront/favicon.ico',
    updated_at = now()
where id = 1
  and coalesce(favicon_path, '') = ''
  and upper(name) = 'HAWSMASH';
