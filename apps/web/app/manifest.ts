import type { MetadataRoute } from 'next';

import { getBrand } from '@/lib/brand/server';

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const brand = await getBrand();

  return {
    name: `${brand.name} POS`,
    short_name: `${brand.name} POS`,
    description: `Ponto de venda ${brand.name}`,
    start_url: '/pos',
    scope: '/pos',
    display: 'fullscreen',
    orientation: 'landscape',
    background_color: brand.theme.bg0,
    theme_color: brand.theme.bg0,
    lang: 'pt-PT',
    icons: [
      { src: '/pos-icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      {
        src: '/pos-icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
