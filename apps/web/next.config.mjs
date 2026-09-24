import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * A versão do build. Tem de ser IGUAL em todos os processos que lêem este
 * ficheiro (workers do build e `next start`) — com `Date.now()` directo o
 * browser e o servidor ficavam com números diferentes e o POS recarregava-se
 * sem parar (apanhado no CI, 24 Set). E no Railway (Railpack) o build não tem
 * git nem RAILWAY_GIT_COMMIT_SHA.
 *
 * Por isso: o primeiro processo de cada build decide a versão (commit, se
 * houver; senão a hora) e grava-a em `.app-build-version`; todos os outros —
 * incluindo o `next start` no mesmo deploy — lêem-na daí. O script `build`
 * apaga o ficheiro antes de começar: cada build, versão nova.
 */
const VERSION_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '.app-build-version');

function lerVersao() {
  try {
    return readFileSync(VERSION_FILE, 'utf8').trim();
  } catch {
    return '';
  }
}

function buildVersion() {
  const gravada = lerVersao();
  if (gravada) return gravada;
  let versao = process.env.RAILWAY_GIT_COMMIT_SHA || '';
  if (!versao) {
    try {
      versao = execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch {
      versao = '';
    }
  }
  if (!versao) versao = `build-${Date.now()}`;
  try {
    // 'wx': só o primeiro a chegar escreve; os outros usam o que ficou gravado.
    writeFileSync(VERSION_FILE, versao, { flag: 'wx' });
    return versao;
  } catch {
    return lerVersao() || versao;
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
