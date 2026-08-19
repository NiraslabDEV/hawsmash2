import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'POS · HAWSMASH',
  robots: { index: false, follow: false },
};

export default function PosLayout({ children }: { children: ReactNode }) {
  return children;
}
