import { defineConfig } from '@playwright/test';

// Ensaio isolado: só simulador local. Nunca usa a base de dados ou gateway de uma loja.
const reuse = process.env.AGENT_E2E_REUSE === 'true';
export default defineConfig({
  testDir: './e2e', testMatch: 'agents.spec.ts', workers: 1,
  timeout: 60_000, expect: { timeout: 10_000 }, reporter: 'list',
  outputDir: './output/mcp/e2e',
  use: { baseURL: 'http://127.0.0.1:3017', screenshot: 'only-on-failure' },
  webServer: [
    { command: 'pnpm exec tsx scripts/agent-rpc-simulator.ts', url: 'http://127.0.0.1:3018/counts', reuseExistingServer: reuse, timeout: 30_000 },
    {
      command: 'pnpm --filter web dev --hostname 127.0.0.1 --port 3017',
      url: 'http://127.0.0.1:3017', reuseExistingServer: reuse, timeout: 120_000,
      env: {
        AGENT_TOOLS_ENABLED: 'true', AGENT_PUBLIC_BASE_URL: 'http://127.0.0.1:3017',
        APP_BASE_URL: 'http://127.0.0.1:3017', NEXT_PUBLIC_APP_BASE_URL: 'http://127.0.0.1:3017',
        NEXT_PUBLIC_DEFAULT_STORE_SLUG: 'loja-teste', NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:3018',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_PLACEHOLDER_LOCAL_SIMULATOR',
        SUPABASE_SERVICE_ROLE_KEY: 'sb_publishable_PLACEHOLDER_LOCAL_SIMULATOR',
      },
    },
  ],
});
