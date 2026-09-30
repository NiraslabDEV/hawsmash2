import type { MetadataRoute } from 'next';

import type { ResolvedBrand } from '@/lib/brand/resolve';

/**
 * As duas apps instaláveis da instância: o POS do balcão e o painel.
 *
 * Até aqui havia um só manifesto, o do POS, em `app/manifest.ts` — e o Next
 * liga esse ficheiro a **todas** as páginas. Quem punha o painel (/pedidos)
 * no ecrã inicial do telemóvel recebia a app do POS: abria em /pos, em ecrã
 * inteiro e deitada. Por isso nenhum dos dois vive na convenção
 * `app/manifest.*`: cada layout liga o seu, e o site público não liga nenhum.
 *
 * O `id` separa as duas apps no sistema. O do POS é o `start_url` de sempre,
 * para quem já o tem instalado não ficar com uma app nova.
 */

const ICONS: MetadataRoute.Manifest['icons'] = [
  { src: '/pos-icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
  { src: '/pos-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
];

export function posManifest(brand: ResolvedBrand): MetadataRoute.Manifest {
  return {
    id: '/pos',
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
    icons: ICONS,
  };
}

/**
 * O painel vive na raiz (/pedidos, /caixa, /login…), sem prefixo comum: o
 * scope tem de ser `/` para mudar de aba sem aparecer a barra do browser.
 */
export function painelManifest(brand: ResolvedBrand): MetadataRoute.Manifest {
  return {
    id: '/pedidos',
    name: `${brand.name} Painel`,
    short_name: 'Painel',
    description: `Painel de gestão ${brand.name}`,
    start_url: '/pedidos',
    scope: '/',
    display: 'standalone',
    background_color: brand.theme.bg0,
    theme_color: brand.theme.bg0,
    lang: 'pt-PT',
    icons: ICONS,
  };
}

export function manifestResponse(manifest: MetadataRoute.Manifest): Response {
  return new Response(JSON.stringify(manifest), {
    headers: { 'Content-Type': 'application/manifest+json; charset=utf-8' },
  });
}
