#!/usr/bin/env node
// Guarda de produção ligada ao build (AGENTS §1.5): com RELEASE_GUARD=1, o
// build falha se ainda houver dados PLACEHOLDER_ na BD que o deploy vai usar.
//
// Só corre quando pedido: o staging vive de placeholders (zonas da Matola,
// B-004) e um build local ou de CI não tem a service key. Ligar no ambiente
// LIVE do Railway: RELEASE_GUARD=1, com NEXT_PUBLIC_SUPABASE_URL e
// SUPABASE_SERVICE_ROLE_KEY disponíveis no build.

if (process.env.RELEASE_GUARD !== '1') {
  process.stdout.write('[guard] RELEASE_GUARD≠1 — a guarda de placeholders não corre neste build.\n');
  process.exit(0);
}

await import('./check-placeholders.mjs');
