import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'apps/web'),
      '@brand': path.resolve(__dirname, 'config/brand.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['**/__tests__/**/*.test.ts'],
    // Worktrees de ferramentas (.kilo, .git/worktrees) guardam cópias detached do
    // repositório. O gate mede a árvore de trabalho — nunca um commit antigo que
    // ainda tem os testes de ontem a apontar para o código de hoje.
    exclude: ['node_modules', '**/node_modules/**', 'dist', '**/tests/**', '**/.kilo/**'],
  },
});
