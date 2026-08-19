import { describe, expect, it } from 'vitest';

import { describePlaceholders, findPlaceholders } from '../lib/release-guard.mjs';

const rows = [
  { table: 'delivery_zones', column: 'name', id: 'z1', value: 'PLACEHOLDER_ZONA' },
  { table: 'stores', column: 'receipt_footer', id: 'maputo', value: 'Obrigado! Bom apetite!' },
  { table: 'stores', column: 'mpesa_number', id: 'matola', value: '847955382' },
];

describe('guarda de go-live', () => {
  it('apanha o dado inventado e ignora o dado real', () => {
    const found = findPlaceholders(rows);
    expect(found).toHaveLength(1);
    expect(found[0].table).toBe('delivery_zones');
  });

  it('descreve o que falta em linguagem de checklist', () => {
    expect(describePlaceholders([])).toContain('pronto para abrir');
    expect(describePlaceholders(findPlaceholders(rows))).toContain('PLACEHOLDER_ZONA');
  });
});
