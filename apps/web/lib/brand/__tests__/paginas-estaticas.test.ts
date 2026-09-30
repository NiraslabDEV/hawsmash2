import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { TTL_MS } from '../server';

/**
 * Páginas sem dados próprios (login, checkout, POS, painel) são geradas no
 * build. Sem `revalidate` no layout raiz ficavam com a marca desse momento até
 * ao deploy seguinte — foi assim que o favicon da 1109 faltou nelas (30 Set).
 */
describe('marca nas páginas estáticas', () => {
  it('o layout raiz regenera-as ao ritmo da cache da marca', () => {
    const layout = readFileSync(path.resolve(__dirname, '../../../app/layout.tsx'), 'utf8');
    const match = layout.match(/^export const revalidate = (\d+);/m);

    expect(match, 'app/layout.tsx sem `export const revalidate`').not.toBeNull();
    expect(Number(match![1])).toBe(TTL_MS / 1000);
  });
});
