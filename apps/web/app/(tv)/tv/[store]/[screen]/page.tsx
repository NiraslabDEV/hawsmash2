import { notFound } from 'next/navigation';

import { createClient } from '@/utils/supabase/server';
import { InvalidStoreSlugError, resolveStoreSlug } from '@/lib/store-context';

import { TvScreen, type TvScreenData } from './tv-screen';

export const dynamic = 'force-dynamic';

/**
 * Uma TV configurada no painel (aba TVs, 1090): `/tv/maputo/tv1`.
 * `?preview=1` é a pré-visualização do painel — não conta como TV ligada.
 */
export default async function TvPage({
  params,
  searchParams,
}: {
  params: Promise<{ store: string; screen: string }>;
  searchParams: Promise<{ preview?: string }>;
}) {
  const { store: rawSlug, screen } = await params;
  const { preview } = await searchParams;

  let slug: string;
  try {
    slug = resolveStoreSlug(rawSlug);
  } catch (error) {
    if (error instanceof InvalidStoreSlugError) notFound();
    throw error;
  }

  const tvSlug = decodeURIComponent(screen).toLowerCase();
  const supabase = await createClient();
  // Primeira leitura no servidor, sem bater o coração: quem conta como
  // "ligada" é a TV a reler sozinha, não um pedido de página.
  const { data, error } = await supabase.rpc('get_tv_screen', {
    p_store_slug: slug,
    p_tv_slug: tvSlug,
    p_heartbeat: false,
  });
  if (error?.message.includes('store_not_found')) notFound();

  return (
    <TvScreen
      storeSlug={slug}
      screenSlug={tvSlug}
      preview={preview === '1'}
      initial={(data as TvScreenData | null) ?? null}
    />
  );
}
