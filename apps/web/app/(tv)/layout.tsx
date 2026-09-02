import type { CSSProperties, ReactNode } from 'react';
import type { Metadata } from 'next';

import { getBrand } from '@/lib/brand/server';

export async function generateMetadata(): Promise<Metadata> {
  const brand = await getBrand();
  return {
    title: `${brand.name} · Ecrã`,
    robots: { index: false, follow: false },
  };
}

/**
 * Ecrãs de parede: sem interacção, sem navegação, legíveis a 4 metros.
 * Nunca mostram dados de clientes — só o que o balcão precisa de anunciar.
 */
export default async function TvLayout({ children }: { children: ReactNode }) {
  const s = (await getBrand()).storefront;
  const cssVars = {
    '--tv-bg': s.bg,
    '--tv-card': s.card,
    '--tv-line': s.line,
    '--tv-primary': s.primary,
    '--tv-text': s.text,
    '--tv-muted': s.muted,
    '--tv-muted-2': s.muted2,
  } as CSSProperties;

  return (
    <div
      style={{
        ...cssVars,
        minHeight: '100vh',
        background: 'var(--tv-bg)',
        color: 'var(--tv-text)',
      }}
    >
      {children}
    </div>
  );
}
