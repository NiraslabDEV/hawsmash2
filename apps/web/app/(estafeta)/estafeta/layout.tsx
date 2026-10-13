import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { getBrand } from '@/lib/brand/server';

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: `Estafeta · ${(await getBrand()).name}`,
    manifest: '/estafeta.webmanifest',
    robots: { index: false, follow: false },
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

/** Telemóvel do estafeta (1115): uma coluna, botões grandes, legível ao sol. */
export default function EstafetaLayout({ children }: { children: ReactNode }) {
  return <div className="min-h-[100dvh] bg-[var(--bg-0)] text-[var(--ink)]">{children}</div>;
}
