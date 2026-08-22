import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  outputDir: './output/playwright/test-results',
  fullyParallel: false,
  // Um worker só: estes testes correm contra a MESMA base de staging e mexem em
  // estado partilhado (fechar uma loja, stock de um item). Em paralelo, um teste
  // fecha a loja que o outro está a usar e a falha não é do código.
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:3100',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command:
      'pnpm --filter web build && pnpm --filter web start --hostname 127.0.0.1 --port 3100',
    url: 'http://127.0.0.1:3100/api/health',
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
