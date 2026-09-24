import { execSync } from 'node:child_process';

/**
 * A versão do build: o commit. Tem de ser IGUAL em todos os processos que
 * lêem este ficheiro (workers do build e `next start`) — com `Date.now()` o
 * browser e o servidor ficavam com números diferentes e o POS recarregava-se
 * sem parar (apanhado no CI, 24 Set). Sem commit conhecido fica um valor fixo:
 * o POS deixa de se auto-actualizar, mas nunca entra em ciclo.
 */
function buildVersion() {
  if (process.env.RAILWAY_GIT_COMMIT_SHA) return process.env.RAILWAY_GIT_COMMIT_SHA;
  try {
    return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || 'dev';
  } catch {
    return 'dev';
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  // O POS compara esta versão com a de `/api/version` e recarrega-se quando há
  // deploy novo (lib/pos/app-update.ts).
  env: {
    NEXT_PUBLIC_APP_BUILD: buildVersion(),
  },
  transpilePackages: ["@delivery/core", "@delivery/payments", "@delivery/receipt"],
  images: {
    // Fotos de produto vêm do Storage do Supabase do cliente (whitelabel);
    // o demo usa também assets locais (/assets/*) e, no protótipo, Unsplash.
    remotePatterns: [
      { protocol: "https", hostname: "**.supabase.co" },
      { protocol: "https", hostname: "images.unsplash.com" },
    ],
  },
};

export default nextConfig;
