import { readFileSync, readdirSync, statSync } from 'node:fs';
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

/**
 * Tira comentários antes de procurar.
 *
 * Um comentário que diga "isto foi lição do HAWSMASH 1.0" é história e fica —
 * o que não pode ficar é o nome a chegar ao ecrã ou ao email de alguém.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const CODE_EXTENSIONS = ['.ts', '.tsx', '.css'];

describe('nomes de cliente no produto', () => {
  it('não aparecem em caminhos de ficheiros ou pastas', () => {
    const offenders = SCANNED.flatMap((dir) => walk(path.join(ROOT, dir))).filter((file) => {
      const lower = file.toLowerCase();
      return CLIENT_NAMES.some((name) => lower.includes(name));
    });

    expect(offenders, `nome de cliente no caminho: ${offenders.join(', ')}`).toEqual([]);
  });

  it('não aparecem em código que chega ao ecrã, ao papel ou ao email', () => {
    const files = SCANNED.flatMap((dir) => walk(path.join(ROOT, dir))).filter(
      (file) =>
        CODE_EXTENSIONS.some((extension) => file.endsWith(extension)) &&
        // Fixtures de teste ficam de fora: um domínio de cliente num teste
        // nunca chega a um ecrã, e este próprio ficheiro tem de os nomear.
        !/(^|\/)(__tests__|tests)\//.test(file),
    );

    const offenders: string[] = [];
    for (const file of files) {
      const source = stripComments(readFileSync(path.join(ROOT, file), 'utf8')).toLowerCase();
      const hit = CLIENT_NAMES.find((name) => source.includes(name));
      if (hit) offenders.push(`${file} (${hit})`);
    }

    expect(offenders, `nome de cliente no código:\n  ${offenders.join('\n  ')}`).toEqual([]);
  });
});
