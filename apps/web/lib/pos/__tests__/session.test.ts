import { describe, expect, it } from 'vitest';
import { isPosPin, shouldLockPos } from '../session';

describe('sessão do POS', () => {
  it('aceita apenas PIN numérico entre 4 e 6 dígitos', () => {
    expect(isPosPin('4826')).toBe(true);
    expect(isPosPin('482615')).toBe(true);
    expect(isPosPin('482')).toBe(false);
    expect(isPosPin('4826157')).toBe(false);
    expect(isPosPin('48a6')).toBe(false);
  });

  it('bloqueia ao atingir cinco minutos sem actividade', () => {
    const lastActivity = Date.UTC(2026, 7, 19, 12, 0, 0);

    expect(shouldLockPos(lastActivity, lastActivity + 299_999)).toBe(false);
    expect(shouldLockPos(lastActivity, lastActivity + 300_000)).toBe(true);
  });
});
