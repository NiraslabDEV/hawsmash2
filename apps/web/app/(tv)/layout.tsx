import type { CSSProperties, ReactNode } from 'react';
import type { Metadata } from 'next';
import { brand } from '@brand';

export const metadata: Metadata = {
  title: `${brand.name} · Ecrã`,
  robots: { index: false, follow: false },
};

const s = brand.storefront;
const cssVars = {
  '--tv-bg': s.bg,
  '--tv-card': s.card,
  '--tv-line': s.line,
  '--tv-primary': s.primary,
  '--tv-text': s.text,
  '--tv-muted': s.muted,
  '--tv-muted-2': s.muted2,
} as CSSProperties;

/**
 * Ecrãs de parede: sem interacção, sem navegação, legíveis a 4 metros.
 * Nunca mostram dados de clientes — só o que o balcão precisa de anunciar.
 */
export default function TvLayout({ children }: { children: ReactNode }) {
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
