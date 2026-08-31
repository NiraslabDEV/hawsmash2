import type { CSSProperties, ReactNode } from 'react';
import type { Metadata } from 'next';
import { Plus_Jakarta_Sans, Anton, Bebas_Neue, DM_Sans } from 'next/font/google';
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
// HAWSMASH: condensada da marca (nav, botões, tabs, preços) — o 1.0 usa-a em
// todo o lado onde o texto é curto e em caixa alta.
const bebas = Bebas_Neue({ subsets: ['latin'], weight: ['400'], display: 'swap' });

// Tokens da marca → CSS vars. Único ponto que importa o brand; os componentes
// da loja leem var(--st-*). Trocar de empresa = editar config/brand.ts (+ assets).
const s = brand.storefront;
const t = brand.theme;
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
  '--font-condensed': bebas.style.fontFamily,
  // Paleta completa da marca (bg escalonado, dourado, ember) — a pele HAWSMASH
  // precisa de mais tons do que os do storefront genérico. Continua tudo a sair
  // de config/brand.ts: nenhum componente escreve um hex.
  '--hs-bg-0': t.bg0,
  '--hs-bg-1': t.bg1,
  '--hs-bg-2': t.bg2,
  '--hs-bg-3': t.bg3,
  '--hs-ink': t.ink,
  '--hs-ink-dim': t.inkDim,
  '--hs-ink-mute': t.inkMute,
  '--hs-gold': t.gold,
  '--hs-gold-deep': t.goldDeep,
  '--hs-gold-glow': 'rgba(229,169,60,.35)',
  '--hs-ember': t.ember,
  '--hs-ok': t.ok,
  // Tons intermedios que o funil (checkout -> pagamento -> pedido recebido) usa
  // para hierarquia de texto. Sem eles os componentes teriam de hardcodar hex.
  '--hs-ink-soft': s.muted3,
  '--hs-ink-faint': s.faint,
  '--hs-line': 'rgba(255,255,255,.08)',
  '--hs-line-strong': 'rgba(255,255,255,.16)',
  '--hs-radius-lg': t.radiusLg,
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
