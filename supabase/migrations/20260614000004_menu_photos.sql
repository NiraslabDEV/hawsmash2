-- ============================================================================
-- DELIVERY OS — Storage: bucket público de fotos do cardápio
-- F1.1: bucket público `menu-photos` (CLAUDE.md secção 8)
-- ============================================================================
-- Bucket público para fotos dos itens do menu
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'menu-photos',
  'menu-photos',
  true,                                                      -- público (cliente precisa ver)
  5242880,                                                   -- 5 MB
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- Staff (authenticated) tem acesso total ao bucket
create policy "menu_photos_authenticated_all" on storage.objects for all
  to authenticated
  using (bucket_id = 'menu-photos')
  with check (bucket_id = 'menu-photos');

-- Anon pode ler as fotos (para mostrar no storefront)
create policy "menu_photos_anon_select" on storage.objects for select
  to anon
  using (bucket_id = 'menu-photos');

-- Anon NÃO pode fazer upload de fotos (só staff)