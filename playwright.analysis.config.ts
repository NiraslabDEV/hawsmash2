import { defineConfig } from '@playwright/test';
import base from './playwright.orders.config';

const servers = Array.isArray(base.webServer) ? base.webServer : [];
export default defineConfig({
  ...base,
  webServer: servers.map((server, index) => index === 0
    ? { ...server, command: 'pnpm exec tsx scripts/analysis-rpc-simulator.ts' }
    : server),
  testMatch: 'analysis.spec.ts',
  outputDir: './output/playwright/analysis-results',
  use: { ...base.use, viewport: { width: 1440, height: 1000 } },
});
