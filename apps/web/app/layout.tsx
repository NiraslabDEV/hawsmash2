import type { CSSProperties } from 'react';
import type { Metadata } from 'next';
import { DM_Sans, Bebas_Neue } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';
import { BrandProvider } from '@/lib/brand/context';
import { getBrand } from '@/lib/brand/server';

const dmSans = DM_Sans({ subsets: ['latin'], variable: '--font-body' });
const bebasNeue = Bebas_Neue({
  weight: '400',
  subsets: ['latin'],
  variable: '--font-display',
});

export async function generateMetadata(): Promise<Metadata> {
  const brand = await getBrand();
  return {
    title: brand.name,
    description: brand.tagline,
    icons: brand.storefront.faviconImage ? { icon: brand.storefront.faviconImage } : undefined,
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const brand = await getBrand();
  const t = brand.theme;

  // A paleta entra por variáveis CSS em runtime, por cima dos valores de
  // fábrica que o globals.css define. É isto que faz mudar a cor no painel
  // mudar a loja **sem novo deploy** — com classes compiladas não mudava
  // (CLAUDE.md §18.2 · ROADMAP-PRODUTO P1).
  const themeVars = {
    '--bg-0': t.bg0,
    '--bg-1': t.bg1,
    '--bg-2': t.bg2,
    '--bg-3': t.bg3,
    '--ink': t.ink,
    '--ink-dim': t.inkDim,
    '--ink-mute': t.inkMute,
    '--gold': t.gold,
    '--gold-deep': t.goldDeep,
    '--ember': t.ember,
    '--r-sm': t.radiusSm,
    '--r-md': t.radiusMd,
    '--r-lg': t.radiusLg,
  } as CSSProperties;

  return (
    <html
      lang={brand.locale.startsWith('pt') ? 'pt-MZ' : brand.locale}
      className={`${dmSans.variable} ${bebasNeue.variable}`}
      style={themeVars}
    >
      <body>
        <BrandProvider brand={brand}>
          <Providers>{children}</Providers>
        </BrandProvider>
      </body>
    </html>
  );
}
