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
  // ⚠️ TROCAR pelo nome real do cliente (o setup:client avisa se ficar "Restaurante Demo").
  name: 'Restaurante Demo',
  tagline: 'Encomendas online em Maputo',
  locale: 'pt-MZ' as const,
  currency: 'MZN' as const,

  // Redes sociais (opcional — deixar '' esconde o ícone).
  social: {
    instagram: '',
    facebook: '',
    whatsapp: '',
  },

  // Tema — tokens CSS mapeados para Tailwind via apps/web/app/globals.css.
  // Defaults = tema escuro + dourado HawSmash. Editar para a marca do cliente.
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

  // Storefront (loja pública /menu) — tokens CSS próprios + hero + imagens de
  // fallback quando um item não tem foto. Obrigatório: apps/web usa brand.storefront.*
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
    logoText: 'DEMO',
    fallbackImages: ['/assets/placeholder.jpg'],
    hero: {
      image: '/assets/placeholder.jpg',
      title: 'Restaurante Demo',
      subtitle: 'Peça já o seu prato favorito',
      cta: 'Ver Cardápio',
    },
  },
} as const;

export type Brand = typeof brand;
