import type { CSSProperties, ReactNode } from 'react';
import type { Metadata } from 'next';
import { Plus_Jakarta_Sans, Anton, DM_Sans } from 'next/font/google';
import { brand } from '@brand';

// Base URL robusta: a env pode vir SEM esquema (ex.: Railway dá "host.up.railway.app").
// new URL() exige protocolo — prefixamos https:// e caímos em localhost se for inválida.
function resolveMetadataBase(): URL {
  const raw = (process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_BASE_URL || '').trim();
  const candidate = raw ? (/^https?:\/\//i.test(raw) ? raw : `https://${raw}`) : 'http://localhost:3000';
  try {
    return new URL(candidate);
  } catch {
    return new URL('http://localhost:3000');
  }
}

// SEO/OG por empresa — tudo de config/brand.ts (whitelabel).
export const metadata: Metadata = {
  metadataBase: resolveMetadataBase(),
  title: { default: `${brand.name} — ${brand.tagline}`, template: `%s · ${brand.name}` },
  description: brand.tagline,
  openGraph: {
    title: brand.name,
    description: brand.tagline,
    images: [brand.storefront.hero.image],
    type: 'website',
    locale: 'pt_MZ',
  },
};

// Fonte da loja (whitelabel: trocar em config/brand.ts se a marca usar outra).
const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  display: 'swap',
});

// Casa do Bom Pasteleiro: tipografia do protótipo aprovado (Anton para
// títulos/display em caixa alta, DM Sans para corpo). Expostas como
// CSS vars --font-display/--font-body para os componentes usarem.
const anton = Anton({ subsets: ['latin'], weight: ['400'], display: 'swap' });
const dmSans = DM_Sans({ subsets: ['latin'], weight: ['400', '500', '700'], display: 'swap' });

// Tokens da marca → CSS vars. Único ponto que importa o brand; os componentes
// da loja leem var(--st-*). Trocar de empresa = editar config/brand.ts (+ assets).
const s = brand.storefront;
const cssVars = {
  '--st-bg': s.bg,
  '--st-card': s.card,
  '--st-line': s.line,
  '--st-primary': s.primary,
  '--st-primary-2': s.primary2,
  '--st-grad': s.grad,
  '--st-star': s.star,
  '--st-text': s.text,
  '--st-muted': s.muted,
  '--st-muted-2': s.muted2,
  '--font-store': jakarta.style.fontFamily,
  '--font-display': anton.style.fontFamily,
  '--font-body': dmSans.style.fontFamily,
} as CSSProperties;

export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div
      className={jakarta.className}
      style={{ ...cssVars, minHeight: '100vh', background: 'var(--st-bg)', color: 'var(--st-text)' }}
    >
      {children}
    </div>
  );
}
