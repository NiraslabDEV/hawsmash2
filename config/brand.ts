/**
 * TEMPLATE da identidade whitelabel.
 *
 * Para um cliente novo:
 *   cp config/brand.example.ts config/brand.ts
 * e depois edita config/brand.ts (nome, cores, logo, redes) + assets em /public/assets.
 *
 * NUNCA espalhar identidade de marca pelo código — tudo vive aqui.
 * (config/brand.ts está no .gitignore por cliente? Não — é versionado por deploy.
 *  Este .example serve de ponto de partida limpo.)
 */

export const brand = {
  name: 'HAWSMASH',
  tagline: 'Smash burgers artesanais em Maputo e Matola',
  locale: 'pt-MZ' as const,
  currency: 'MZN' as const,

  // Redes sociais (opcional — deixar '' esconde o ícone).
  social: {
    instagram: 'https://instagram.com/hawsmash',
    facebook: '',
    whatsapp: 'https://wa.me/258860760009',
  },

  // Tema — tokens CSS mapeados para Tailwind via apps/web/app/globals.css.
  // Identidade HAWSMASH: fundo escuro, dourado e tipografia condensada.
  theme: {
    gold: '#e5a93c',
    goldDeep: '#c48a1e',
    ember: '#e85a2a',
    bg0: '#0a0807',
    bg1: '#111110',
    bg2: '#1a1816',
    bg3: '#221f1c',
    ink: '#f6f1e6',
    inkDim: '#c8bfb0',
    inkMute: '#847e72',
    fontDisplay: "'Bebas Neue', 'Anton', Impact, sans-serif",
    fontBody: "'DM Sans', 'Inter', system-ui, sans-serif",
    fontMono: "'JetBrains Mono', ui-monospace, monospace",
    radiusSm: '6px',
    radiusMd: '10px',
    radiusLg: '18px',
  },

  // Storefront (loja pública /menu, /m/[token], home) — escuro + dourado HAWSMASH.
  storefront: {
    bg: '#141110',
    card: '#1d1917',
    line: 'rgba(255,255,255,0.08)',
    primary: '#e5a93c',
    primary2: '#c48a1e',
    grad: 'linear-gradient(135deg, #e5a93c 0%, #e85a2a 100%)',
    star: '#e5a93c',
    text: '#f6f1e6',
    muted: '#c8bfb0',
    muted2: '#847e72',
    // Tons secundários do protótipo. Sem estes, os componentes teriam de
    // hardcodar hex de marca — proibido por (public)/CLAUDE.md §6.
    textSoft: '#e8dfd2',
    muted3: '#a79f92',
    faint: '#6f6961',
    surface2: '#241f1c',
    photoBg: '#221f1c',
    onDark: '#f6f1e6',
    onDarkSoft: '#d8d0c3',
    onDarkMuted: '#9b958a',
    logoText: 'HAWSMASH',
    logoImage: '/assets/hawsmash/logo.svg',
    fallbackImages: ['/assets/hawsmash/logo.svg'],
    hero: {
      image: '/assets/hawsmash/logo.svg',
      title: 'HAWSMASH',
      subtitle: 'Smash burgers artesanais em Maputo e Matola.',
      cta: 'Ver Cardápio',
    },
    // Contactos confirmados no HAWSMASH 1.0.
    contact: {
      phone: '+258 86 076 0009',
      instagram: '@hawsmash',
      addressLine1: 'Maputo e Matola',
      addressLine2: '',
    },
  },
} as const;

export type Brand = typeof brand;
