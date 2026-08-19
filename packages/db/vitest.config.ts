import { defineConfig } from "vitest/config";

// Config dedicado aos testes de integracao do banco (tests/), que exigem
// Supabase local activo. Separado do vitest.config.ts da raiz (que exclui
// **/tests/** do `pnpm test` unitario).
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
