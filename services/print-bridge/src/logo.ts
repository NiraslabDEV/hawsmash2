import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * O logo que sai no topo do talao, em raster ESC/POS (GS v 0).
 *
 * Era uma constante compilada dentro do bridge — o logo de um cliente dentro
 * do produto (CLAUDE.md 18.2/18.3). Numa segunda instalacao isso imprimia a
 * marca do cliente anterior em cada talao, e ninguem repara ate um cliente
 * perguntar porque e que o talao tem outro nome.
 *
 * Agora e **dado da instalacao**: um ficheiro base64 ao lado do .env, que cada
 * instalacao poe (ou nao poe). Sem ficheiro, o talao sai sem logo — nunca com
 * o logo de outra pessoa.
 *
 * Continua a ser um ficheiro e nao uma leitura da base de dados por uma razao
 * de operacao: o bridge tem de imprimir com a internet em baixo (regra 1).
 */

const DEFAULT_FILE = 'brand-logo.b64';

/** Pastas onde o ficheiro e procurado, por ordem. */
function candidatePaths(env: NodeJS.ProcessEnv): string[] {
  const configured = env.BRAND_LOGO_FILE?.trim();
  if (configured) return [configured];

  // Mesma regra do `.env` (ver index.ts): ao duplo-clique no .exe o cwd e o
  // ambiente de trabalho, por isso a pasta do executavel vem primeiro.
  return [
    path.join(path.dirname(process.execPath), DEFAULT_FILE),
    path.join(process.cwd(), DEFAULT_FILE),
    path.join(process.cwd(), 'instance', DEFAULT_FILE),
  ];
}

export function loadBrandLogo(env: NodeJS.ProcessEnv = process.env): Buffer {
  for (const candidate of candidatePaths(env)) {
    if (!existsSync(candidate)) continue;
    try {
      const base64 = readFileSync(candidate, 'utf8').replace(/\s+/g, '');
      if (base64.length > 0) return Buffer.from(base64, 'base64');
    } catch {
      // Ficheiro ilegivel nao pode parar a impressao: sai sem logo.
      break;
    }
  }
  return Buffer.alloc(0);
}

/**
 * Lido uma vez ao arrancar. Trocar o logo implica reiniciar o bridge — o que e
 * o que ja acontece hoje quando se mexe no `.env`.
 */
export const LOGO_RASTER = loadBrandLogo();
