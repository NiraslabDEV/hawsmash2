import { defineConfig } from '@playwright/test';

// Reutiliza apenas o servidor e simulador locais; autenticação/RPCs do painel
// são interceptadas no contexto de cada teste, sem sessões ou dados reais.
export default defineConfig({
  testDir: './e2e', testMatch: 'orders-pagination.spec.ts', workers: 1,
  timeout: 60_000, expect: { timeout: 15_000 }, reporter: 'list',
  outputDir: './output/orders/e2e',
  use: { baseURL: 'http://127.0.0.1:3019', screenshot: 'only-on-failure' },
  webServer: [
    { command: 'pnpm exec tsx scripts/orders-rpc-simulator.ts', url: 'http://127.0.0.1:3020/health', timeout: 30_000 },
    {
      command: 'pnpm --filter web dev --hostname 127.0.0.1 --port 3019',
      url: 'http://127.0.0.1:3019', timeout: 120_000,
      env: {
        AGENT_TOOLS_ENABLED: 'false', APP_BASE_URL: 'http://127.0.0.1:3019',
        NEXT_PUBLIC_APP_BASE_URL: 'http://127.0.0.1:3019',
        NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:3020',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_PLACEHOLDER_LOCAL_SIMULATOR',
        SUPABASE_SERVICE_ROLE_KEY: 'sb_publishable_PLACEHOLDER_LOCAL_SIMULATOR',
      },
    },
  ],
});
