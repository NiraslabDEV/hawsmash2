import { notFound } from 'next/navigation';

import { createClient } from '@/utils/supabase/server';
import { InvalidStoreSlugError, resolveStoreSlug } from '@/lib/store-context';
import { publicStoreListSchema } from '@/lib/public-stores';

import { MenuBoard } from './menu-board';

export const dynamic = 'force-dynamic';

export default async function MenuBoardPage({ params }: { params: Promise<{ store: string }> }) {
  const { store: rawSlug } = await params;

  let slug: string;
  try {
    slug = resolveStoreSlug(rawSlug);
  } catch (error) {
    if (error instanceof InvalidStoreSlugError) notFound();
    throw error;
  }

  const supabase = await createClient();
  const { data } = await supabase.rpc('list_public_stores');
  const store = publicStoreListSchema.parse(data ?? []).find((entry) => entry.slug === slug);
  if (!store) notFound();

  return <MenuBoard storeSlug={store.slug} storeName={store.short_name} />;
}
