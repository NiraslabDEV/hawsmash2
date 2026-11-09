import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { getBrand } from '@/lib/brand/server';

// O mesmo vocabulário do balcão (pos.css): botões, folhas, superfícies.
import '../../(pos)/pos/pos.css';

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: `Garçom · ${(await getBrand()).name}`,
    manifest: '/garcom.webmanifest',
    robots: { index: false, follow: false },
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
};

/** Telemóvel do garçom (1122): uma coluna, alvos grandes, uma mão livre. */
export default function GarcomLayout({ children }: { children: ReactNode }) {
  return <div className="pos-ui min-h-[100dvh]">{children}</div>;
}
