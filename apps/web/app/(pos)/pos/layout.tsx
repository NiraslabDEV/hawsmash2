import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { RegisterPosPwa } from './register-pwa';

export const metadata: Metadata = {
  title: 'POS · HAWSMASH',
  manifest: '/manifest.webmanifest',
  robots: { index: false, follow: false },
};

export default function PosLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <RegisterPosPwa />
      {children}
    </>
  );
}
