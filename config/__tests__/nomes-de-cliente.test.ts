import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Guarda de arquitectura (CLAUDE.md §18.3): **o produto não sabe como se chama
 * o cliente que o está a usar.**
 *
 * Um `_hawsmash/` no caminho de um módulo não é feio — é o que transforma cada
 * instalação num ramo do repositório. Quando o segundo cliente usar a mesma
 * montra, ou o módulo muda de nome, ou passa a haver `_hawsmash/` a servir
 * outra marca. Este teste trava isso antes de acontecer outra vez.
 *
 * Fora do âmbito, de propósito: `docs/` (arquivo do 1.0 e do motor herdado,
 * onde o nome do cliente é o assunto) e `supabase/migrations/` já aplicadas —
 * essas não se reescrevem (§11.7), corrigem-se para a frente.
 */

const ROOT = path.resolve(__dirname, '..', '..');

// Clientes reais que já passaram por este motor. A lista cresce; a regra não.
const CLIENT_NAMES = ['hawsmash', 'babalaza', 'casa-do-bom-pasteleiro', 'thebox'];

const SCANNED = [
  'apps/web/app',
  'apps/web/lib',
  'apps/web/utils',
  'apps/web/windows',
  'packages',
  'services',
  'config',
];

// `build`/`dist` sao artefactos: o nome do executavel sai do .env de cada
// instalacao, nao do codigo, e nada disto vai para o repositorio.
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', 'build', '.turbo', 'legacy']);

function walk(dir: string, found: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return found;
  }

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, found);
    else found.push(path.relative(ROOT, full).split(path.sep).join('/'));
  }
  return found;
}

describe('nomes de cliente no produto', () => {
  it('não aparecem em caminhos de ficheiros ou pastas', () => {
    const offenders = SCANNED.flatMap((dir) => walk(path.join(ROOT, dir))).filter((file) => {
      const lower = file.toLowerCase();
      return CLIENT_NAMES.some((name) => lower.includes(name));
    });

    expect(offenders, `nome de cliente no caminho: ${offenders.join(', ')}`).toEqual([]);
  });
});
