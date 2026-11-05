import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { getBrand } from '@/lib/brand/server';

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
};

/** Telemóvel do garçom (1122): uma coluna, alvos grandes, uma mão livre. */
export default function GarcomLayout({ children }: { children: ReactNode }) {
  return <div className="min-h-[100dvh] bg-[var(--bg-0)] text-[var(--ink)]">{children}</div>;
}
