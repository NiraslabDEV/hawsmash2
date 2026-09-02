import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadBrandLogo } from '../logo';

/**
 * O logo do talao e dado da instalacao, nao do produto.
 *
 * Estava compilado dentro do bridge: numa segunda instalacao, cada talao saia
 * com a marca do cliente anterior (CLAUDE.md 18.3). Estes testes fixam as duas
 * metades do contrato — le o ficheiro da instalacao quando existe, e sai sem
 * logo quando nao existe. Nunca com o logo de outra pessoa.
 */
describe('logo da instalacao', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('le o raster do ficheiro indicado por BRAND_LOGO_FILE', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'bridge-logo-'));
    const file = path.join(dir, 'brand-logo.b64');
    const raster = Buffer.from([0x1d, 0x76, 0x30, 0x00, 0x01, 0x00, 0x01, 0x00, 0xff]);
    writeFileSync(file, `${raster.toString('base64')}\n`);

    expect(loadBrandLogo({ BRAND_LOGO_FILE: file })).toEqual(raster);
  });

  it('sai vazio — nunca com o logo de outra instalacao — quando o ficheiro nao existe', () => {
    const ausente = path.join(tmpdir(), 'nao-existe-brand-logo.b64');
    expect(loadBrandLogo({ BRAND_LOGO_FILE: ausente })).toHaveLength(0);
  });

  it('ignora um ficheiro vazio em vez de imprimir lixo', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'bridge-logo-'));
    const file = path.join(dir, 'brand-logo.b64');
    writeFileSync(file, '   \n');

    expect(loadBrandLogo({ BRAND_LOGO_FILE: file })).toHaveLength(0);
  });
});
