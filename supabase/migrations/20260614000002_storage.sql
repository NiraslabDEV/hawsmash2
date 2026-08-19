-- ============================================================================
-- DELIVERY OS — Storage: bucket privado de comprovativos
-- F0.3: bucket privado `payment-proofs` (CLAUDE.md secções 6.1, 14.2)
-- Buckets são linhas em storage.buckets; políticas vão em storage.objects.
-- ============================================================================

-- ── Bucket privado ──────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'payment-proofs',
  'payment-proofs',
  false,                                                    -- privado
  10485760,                                                 -- 10 MB
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do nothing;

-- ── Staff (authenticated) tem acesso total ao bucket ─────────────────────────
create policy "payment_proofs_authenticated_all" on storage.objects for all
  to authenticated
  using (bucket_id = 'payment-proofs')
  with check (bucket_id = 'payment-proofs');

-- ── Anon só pode FAZER UPLOAD do comprovativo (checkout manual) ──────────────
-- A leitura é feita pelo backend/admin via createSignedUrl (assinatura ignora RLS),
-- por isso anon NÃO recebe SELECT — o caminho do comprovativo nunca é público.
create policy "payment_proofs_anon_insert" on storage.objects for insert
  to anon
  with check (bucket_id = 'payment-proofs');
