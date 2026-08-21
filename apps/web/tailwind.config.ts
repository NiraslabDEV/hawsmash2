import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    // O aviso de cookies vive em lib/analytics: sem esta linha, o Tailwind
    // nunca gerava as classes dele e o aviso saía transparente por cima do
    // conteúdo (bug antigo, visível em todas as páginas da loja).
    './lib/**/*.{js,ts,jsx,tsx}',
    '../../config/brand.ts',
  ],
  theme: {
    extend: {
      colors: {
        // Tema HawSmash — mapeado via CSS vars para ser por-cliente (config/brand.ts)
        gold: 'var(--gold)',
        'gold-deep': 'var(--gold-deep)',
        ink: 'var(--ink)',
        'ink-dim': 'var(--ink-dim)',
        'ink-mute': 'var(--ink-mute)',
        ember: 'var(--ember)',
        bg0: 'var(--bg-0)',
        bg1: 'var(--bg-1)',
        bg2: 'var(--bg-2)',
        bg3: 'var(--bg-3)',
        line: 'var(--line)',
        'line-strong': 'var(--line-strong)',
      },
      fontFamily: {
        display: ['var(--font-display)', 'Bebas Neue', 'Impact', 'sans-serif'],
        body: ['var(--font-body)', 'DM Sans', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        sm: 'var(--r-sm)',
        md: 'var(--r-md)',
        lg: 'var(--r-lg)',
      },
    },
  },
  plugins: [],
};

export default config;
