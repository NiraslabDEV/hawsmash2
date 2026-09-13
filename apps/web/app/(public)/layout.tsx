import type { CSSProperties, ReactNode } from 'react';
import type { Metadata } from 'next';
import { Plus_Jakarta_Sans, Anton, Bebas_Neue, DM_Sans } from 'next/font/google';

import { getBrand } from '@/lib/brand/server';
import { AgentTools } from './agent-tools';

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

// SEO/OG por empresa — tudo de `brand_settings`, com fallback de fábrica.
export async function generateMetadata(): Promise<Metadata> {
  const brand = await getBrand();
  const title = brand.tagline ? `${brand.name} — ${brand.tagline}` : brand.name;

  return {
    metadataBase: resolveMetadataBase(),
    title: { default: title, template: `%s · ${brand.name}` },
    description: brand.tagline,
    openGraph: {
      title: brand.name,
      description: brand.tagline,
      images: [brand.storefront.ogImage || brand.storefront.hero.image],
      type: 'website',
      locale: brand.locale.replace('-', '_'),
    },
  };
}

// Fontes da montra. Continuam a ser escolhidas no build (o `next/font` exige
// nomes estáticos); o que a marca controla é a paleta e o texto.
const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  display: 'swap',
});
const anton = Anton({ subsets: ['latin'], weight: ['400'], display: 'swap' });
const dmSans = DM_Sans({ subsets: ['latin'], weight: ['400', '500', '700'], display: 'swap' });
const bebas = Bebas_Neue({ subsets: ['latin'], weight: ['400'], display: 'swap' });

export default async function PublicLayout({ children }: { children: ReactNode }) {
  const brand = await getBrand();
  const s = brand.storefront;
  const t = brand.theme;

  // Único ponto que traduz a marca para CSS. Os componentes lêem var(--st-*)
  // e var(--hs-*) e nunca escrevem um hex ((public)/CLAUDE.md §6).
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
    // Paleta completa da marca (bg escalonado, primária, ember) — a montra
    // precisa de mais tons do que os do storefront genérico.
    '--hs-bg-0': t.bg0,
    '--hs-bg-1': t.bg1,
    '--hs-bg-2': t.bg2,
    '--hs-bg-3': t.bg3,
    '--hs-ink': t.ink,
    '--hs-ink-dim': t.inkDim,
    '--hs-ink-mute': t.inkMute,
    '--hs-gold': t.gold,
    '--hs-gold-deep': t.goldDeep,
    '--hs-gold-glow': hexToGlow(t.gold),
    '--hs-ember': t.ember,
    '--hs-ok': t.ok,
    // Tons intermédios que o funil (checkout → pagamento → pedido recebido)
    // usa para hierarquia de texto.
    '--hs-ink-soft': s.muted3,
    '--hs-ink-faint': s.faint,
    '--hs-line': 'rgba(255,255,255,.08)',
    '--hs-line-strong': 'rgba(255,255,255,.16)',
    '--hs-radius-lg': t.radiusLg,
  } as CSSProperties;

  return (
    <div
      className={jakarta.className}
      style={{ ...cssVars, minHeight: '100vh', background: 'var(--st-bg)', color: 'var(--st-text)' }}
    >
      {children}
      {process.env.AGENT_TOOLS_ENABLED === 'true' && <AgentTools />}
    </div>
  );
}

/**
 * O brilho da cor primária era um `rgba()` fixo com o dourado do HAWSMASH lá
 * dentro: mudar a cor no painel deixava o halo da cor antiga. Passa a derivar
 * da própria cor; o que não for hex reconhecível fica sem halo, que é melhor
 * do que ficar com o halo de outra marca.
 */
function hexToGlow(hex: string, alpha = 0.35): string {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return 'transparent';
  const value = parseInt(match[1], 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}
