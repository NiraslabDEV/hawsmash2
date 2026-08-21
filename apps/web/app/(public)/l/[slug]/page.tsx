import { notFound } from 'next/navigation';

import { Storefront } from '../../_hawsmash/storefront';
import { RememberStore } from './remember-store';
import { createClient } from '@/utils/supabase/server';
import { InvalidStoreSlugError, resolveStoreSlug } from '@/lib/store-context';
import { publicStoreListSchema } from '@/lib/public-stores';

export const dynamic = 'force-dynamic';

export default async function StorePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug: rawSlug } = await params;

  let slug: string;
  try {
    slug = resolveStoreSlug(rawSlug);
  } catch (error) {
    if (error instanceof InvalidStoreSlugError) notFound();
    throw error;
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('list_public_stores');
  if (error) throw new Error('Não foi possível carregar as lojas.');

  const stores = publicStoreListSchema.parse(data ?? []);
  const store = stores.find((entry) => entry.slug === slug);
  if (!store) notFound();

  return (
    <>
      <RememberStore slug={store.slug} />
      {/* A lista completa vai com a página: trocar de loja é um clique, sem
          esperar por outro pedido ao servidor. */}
      <Storefront store={store} stores={stores} />
    </>
  );
}
