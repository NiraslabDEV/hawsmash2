import { describe, expect, it } from 'vitest';

import { DRAWER_PULSE } from '../drawer';

describe('gaveta', () => {
  it('usa o pulso ESC/POS validado para a gaveta do balcão', () => {
    expect([...DRAWER_PULSE]).toEqual([0x1b, 0x70, 0x00, 0x19, 0xfa]);
  });
});
