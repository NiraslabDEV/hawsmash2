import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { getBrand } from '@/lib/brand/server';

import { RegisterPosPwa } from './register-pwa';

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: `POS · ${(await getBrand()).name}`,
    manifest: '/manifest.webmanifest',
    robots: { index: false, follow: false },
  };
}

export default function PosLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <RegisterPosPwa />
      {children}
    </>
  );
}
