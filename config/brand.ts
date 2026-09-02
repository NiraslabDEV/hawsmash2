/**
 * FALLBACK DE FÁBRICA da identidade — **não** é a marca de nenhum cliente.
 *
 * A identidade real vive em `brand_settings` na base de dados e edita-se na
 * aba **Aparência** do painel, pelo dono (CLAUDE.md §18.2). O que está aqui é
 * só o que a loja mostra quando a base de dados não responde: cores neutras,
 * textos genéricos, nenhum nome próprio.
 *
 * Isto é uma regra de arquitectura, não de gosto. Enquanto a identidade de um
 * cliente viver neste ficheiro, cada instalação é um ramo do repositório e as
 * melhorias do produto colidem sempre na mesma linha — é o que impede o motor
 * de escalar para além do segundo cliente (ROADMAP-PRODUTO §1).
 *
 * `config/__tests__/brand-factory.test.ts` trava o merge se algum nome, cor ou
 * caminho de cliente voltar a entrar aqui.
 *
 * Para instalar um cliente novo: `pnpm setup:client` e depois a aba Aparência.
 * Nunca editar este ficheiro por causa de um cliente.
 */

export const brand = {
  name: 'Restaurante',
  tagline: 'Encomendas online',
  locale: 'pt-MZ' as const,
  currency: 'MZN' as const,

  // Identificação legal — sai no talão e nos documentos. Vazio = não aparece.
  legalName: '',
  nuit: '',
  receiptFooter: '',

  // Redes sociais (vazio esconde o ícone).
  social: {
    instagram: '',
    facebook: '',
    whatsapp: '',
  },

  // Tema — tokens CSS mapeados para Tailwind via apps/web/app/globals.css.
  // Escuro e sóbrio de propósito: é o que fica bem enquanto o dono não escolhe.
  theme: {
    gold: '#c8a24a',
    goldDeep: '#a8853a',
    ember: '#c96a3c',
    ok: '#3fbf6a',
    bg0: '#0a0a0a',
    bg1: '#111111',
    bg2: '#1a1a1a',
    bg3: '#222222',
    ink: '#f2f0ec',
    inkDim: '#c4c0b8',
    inkMute: '#807c75',
    fontDisplay: "'Bebas Neue', 'Anton', Impact, sans-serif",
    fontBody: "'DM Sans', 'Inter', system-ui, sans-serif",
    fontMono: "'JetBrains Mono', ui-monospace, monospace",
    radiusSm: '6px',
    radiusMd: '10px',
    radiusLg: '18px',
  },

  // Storefront — a montra pública. Tudo aqui é substituível pela BD.
  storefront: {
    bg: '#121212',
    card: '#1c1c1c',
    line: 'rgba(255,255,255,0.08)',
    primary: '#c8a24a',
    primary2: '#a8853a',
    grad: 'linear-gradient(135deg, #c8a24a 0%, #c96a3c 100%)',
    star: '#c8a24a',
    text: '#f2f0ec',
    muted: '#c4c0b8',
    muted2: '#807c75',
    textSoft: '#e6e2da',
    muted3: '#a5a099',
    faint: '#6d6963',
    surface2: '#232323',
    photoBg: '#222222',
    onDark: '#f2f0ec',
    onDarkSoft: '#d6d2ca',
    onDarkMuted: '#98938c',
    logoText: 'RESTAURANTE',
    logoImage: '/assets/storefront/logo.svg',
    faviconImage: '',
    ogImage: '/assets/storefront/logo.svg',
    fallbackImages: ['/assets/storefront/logo.svg'],
    hero: {
      image: '/assets/storefront/logo.svg',
      title: 'Restaurante',
      subtitle: 'Encomenda online e recebe em casa.',
      cta: 'Ver Cardápio',
    },

    // ── Landing ───────────────────────────────────────────────────────────
    // Conteúdo editorial da montra: o que NÃO vem da base de dados operacional.
    // Cardápio, preços, horários e estado da loja vêm sempre do servidor.
    landing: {
      logoCircle: '/assets/storefront/logo.svg',
      storyImage: '/assets/storefront/logo.svg',
      wordmark: 'RESTAURANTE',
      wordmarkTag: 'Cozinha local',
      hero: {
        // O fim do título é a loja escolhida — {loja} é substituído em runtime.
        titleLead: 'Encomenda agora.',
        titleAccent: 'Recebes',
        titleTail: 'em {loja}.',
        subtitle: 'Pagamento móvel · Entrega ou levantamento',
        ctaMenu: 'Ver Menu',
        ctaCart: 'Ver Carrinho',
      },
      marquee: ['Feito na hora', 'Entrega rápida', 'Pagamento móvel'],
      menu: {
        eyebrow: 'O cardápio',
        title: 'Da nossa cozinha',
        lead: 'Escolhe, monta o pedido e paga por telemóvel.',
      },
      story: {
        eyebrow: 'Quem somos',
        titleLead: 'Feito',
        titleAccent: 'a sério',
        titleTail: '',
        paragraphs: [] as string[],
        stats: [] as { n: string; l: string }[],
        tagKey: '',
        tagValue: '',
      },
      footer: {
        ctaLead: 'Pronto para',
        ctaAccent: 'encomendar?',
        blurb: 'Encomenda no site, levanta no balcão ou recebe em casa.',
        rights: '',
        madeIn: '',
        madeInAccent: '',
      },
    },

    // ── Espaços comerciais do funil ───────────────────────────────────────
    // Vazio de fábrica de propósito: uma promoção só existe depois de o dono a
    // criar. Um cupão que aparece no ecrã e é recusado no checkout é pior do
    // que não haver promoção nenhuma.
    funnel: {
      promos: [] as {
        kicker: string;
        title: string;
        body: string;
        cta: string;
        href: string;
        code: string;
        note: string;
      }[],
      waiting: '',
    },

    // ── Assinatura de quem fez o sistema ──────────────────────────────────
    // Isto é identidade do fabricante, não do cliente: fica de fábrica e
    // desliga-se por instalação com `enabled: false` na aba Aparência.
    poweredBy: {
      enabled: true,
      name: 'NIRASLAB',
      kicker: 'Software para restaurantes',
      title: 'Este ecrã é o nosso trabalho.',
      body: 'Construímos o sistema que acabou de receber o seu pedido.',
      proof: ['Do site à cozinha em segundos', 'Pagamento móvel confirmado sozinho'],
      cta: 'Falar no WhatsApp',
      whatsapp: 'https://wa.me/258853860621',
      email: 'niraslab.dev@gmail.com',
      // Paleta fria própria: lê-se como outra marca, não como mais um banner
      // do restaurante. Não sai da paleta do cliente porque não é dele.
      accent: '#7ea8ff',
      bg: '#101319',
      bg2: '#090b0f',
      ink: '#e8ecf2',
      inkDim: '#7a8494',
      inkMute: '#5c6675',
    },

    contact: {
      phone: '',
      instagram: '',
      addressLine1: '',
      addressLine2: '',
    },
  },
} as const;

export type Brand = typeof brand;
