import { defineConfig } from '@playwright/test';

// Fluxos visuais com marca, menu e pagamentos simulados: nenhum gateway real.
export default defineConfig({
  testDir: './e2e', testMatch: 'payment-methods.spec.ts', workers: 1,
  timeout: 60_000, expect: { timeout: 12_000 }, reporter: 'list',
  outputDir: './output/playwright/payments',
  use: { baseURL: 'http://127.0.0.1:3031', screenshot: 'only-on-failure' },
  webServer: [
    { command: 'pnpm exec tsx scripts/payment-rpc-simulator.ts', url: 'http://127.0.0.1:3032/health', timeout: 30_000 },
    {
      command: 'pnpm --filter web dev --hostname 127.0.0.1 --port 3031',
      url: 'http://127.0.0.1:3031', timeout: 120_000,
      env: {
        AGENT_TOOLS_ENABLED: 'false', APP_BASE_URL: 'http://127.0.0.1:3031',
        NEXT_PUBLIC_APP_BASE_URL: 'http://127.0.0.1:3031',
        NEXT_PUBLIC_DEFAULT_STORE_SLUG: 'loja-teste',
        NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:3032',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_PLACEHOLDER_LOCAL_SIMULATOR',
        SUPABASE_SERVICE_ROLE_KEY: 'sb_publishable_PLACEHOLDER_LOCAL_SIMULATOR',
      },
    },
  ],
});
