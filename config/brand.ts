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
    // Estado, não identidade: o verde de "está bem" do funil (loja aberta,
    // campo válido, comprovativo aceite). Vive aqui para nenhum componente
    // hardcodar um hex — mesma regra do resto da paleta.
    ok: '#3fbf6a',
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
    // ── Landing HAWSMASH (pele portada do 1.0) ────────────────────────────
    // Conteúdo editorial da loja pública: o que NÃO vem da base de dados.
    // Cardápio, preços, horários e estado da loja vêm sempre do servidor;
    // aqui vive só a marca — copy, imagens de marca e listas fixas.
    landing: {
      logoCircle: '/assets/hawsmash/logo-hawsmash.jpg',
      // Foto de produto, não o flyer do 1.0: o flyer traz horário, morada e
      // números gravados na imagem, que hoje já estão errados. O que muda vive
      // na base de dados, nunca dentro de um JPG.
      storyImage: '/assets/hawsmash/smoked-brisket.webp',
      wordmark: 'HAWSMASH',
      wordmarkTag: 'Smash Burgers · Pastéis de Nata',
      hero: {
        // O fim do título é a loja escolhida — {loja} é substituído em runtime.
        titleLead: 'Encomenda agora.',
        titleAccent: 'Recebes',
        titleTail: 'em {loja}.',
        subtitle: 'Pagamento por M-Pesa ou e-Mola · Entrega ou levantamento no balcão',
        ctaMenu: 'Ver Menu',
        ctaCart: 'Ver Carrinho',
      },
      marquee: [
        'Classic Smash',
        'Double Smash',
        'Smoked Brisket',
        'Hawsmash Signature',
        'Pastéis de Nata',
        'Made in Maputo',
        'Serious Smash',
      ],
      menu: {
        eyebrow: 'O cardápio',
        title: 'Da nossa chapa',
        lead: 'Pão tostado, carne prensada na chapa e queijo a derreter na hora. Escolhe, monta o pedido e paga por M-Pesa ou e-Mola.',
      },
      story: {
        eyebrow: 'Quem somos',
        titleLead: 'Smash',
        titleAccent: 'Sério',
        titleTail: 'Sabor que marca Maputo e Matola.',
        paragraphs: [
          'Nascemos em Maputo com uma ideia simples: um smash burger feito a sério — pão tostado, carne 100% bovina prensada na chapa, queijo a derreter na hora. Sem atalhos. Sem corte de tempo. Sem corte de qualidade.',
          'Levámos esse sabor às maiores feiras e eventos da cidade. Agora somos duas casas — Maputo e Matola — com a mesma chapa e o mesmo molho.',
        ],
        stats: [
          { n: '2', l: 'Lojas · Maputo e Matola' },
          { n: '100%', l: 'Carne fresca' },
          { n: '10+', l: 'Eventos · 2026' },
          { n: '2K26', l: 'Ano de fundação' },
        ],
        tagKey: 'Hawsmash · Made in Maputo',
        tagValue: 'Serious Smash',
      },
      footer: {
        ctaLead: 'Pronto para',
        ctaAccent: 'Smash?',
        blurb: 'Smash burgers a sério em Maputo e Matola. Encomenda no site, levanta no balcão ou recebe em casa.',
        rights: '© 2026 HAWSMASH · Todos os direitos reservados',
        madeIn: 'Made in Maputo',
      },
    },

    // ── Espaços comerciais do funil (A–D) ─────────────────────────
    // São DADOS, não código (§18.2): título, texto e link saem daqui, para o
    // dono trocar a campanha sem deploy. Lista vazia = nenhum bloco aparece,
    // e a página fecha-se sem buracos.
    //
    // Regra do inventario: no máximo DOIS blocos no pós-compra. O terceiro faz
    // a página virar jornal e empurra a avaliação para fora do ecrã.
    //
    // Um cupão entra aqui com `code` — mas só depois de o código existir mesmo
    // em `referral_codes`. Código inventado no ecrã e recusado no checkout
    // é pior do que não ter promoção nenhuma.
    funnel: {
      promos: [
        {
          kicker: 'Da casa',
          title: 'Passa a quem ainda não provou.',
          body: 'Menos 10% na primeira encomenda. Cada telefone usa uma vez.',
          cta: '',
          href: '',
          // Existe mesmo em referral_codes (migration 1033). Código que
          // aparece no ecrã e é recusado no checkout não volta a acontecer.
          code: 'PRIMEIRACOMPRA',
          note: 'Válido no site e ao balcão, nas duas lojas.',
        },
        {
          kicker: 'Loja nova',
          title: 'Matola já abriu.',
          body: 'Mesma chapa, mesmo molho. Entrega em Matola a partir das 12h.',
          cta: 'Ver a loja Matola',
          href: '/l/matola',
          code: '',
          note: '',
        },
      ],
      // Faixa do ecrã de espera. Sem link para fora de propósito: abrir outra
      // app a meio da confirmação do M-Pesa mata a verificação.
      waiting: '',
    },
    // ── Assinatura de quem fez o sistema (espaco E do funil) ──────────────
    // Aparece no fim do ecrã de pedido recebido, depois de o cliente já ter
    // tudo o que precisa. É identidade — logo vive aqui, nunca num componente
    // (CLAUDE.md §18.2). Outra instalação troca isto ou põe enabled: false.
    poweredBy: {
      enabled: true,
      name: 'NIRASLAB',
      kicker: 'Software para restaurantes',
      title: 'Este ecrã é o nosso trabalho.',
      body: 'Construímos o sistema que acabou de receber o seu pedido. Está a correr nas duas lojas da HAWSMASH neste momento.',
      proof: ['Duas lojas, um painel', 'M-Pesa confirmado sozinho', 'Do site à cozinha em segundos'],
      cta: 'Falar no WhatsApp',
      // Vazio = o botão de WhatsApp não aparece e fica só o email. Nunca
      // publicar um número por preencher no ecrã de um cliente.
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
