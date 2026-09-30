import { describe, expect, it } from 'vitest';
import { isPosPin, posIdleTimeoutMs, shouldLockPos } from '../session';

describe('sessão do POS', () => {
  it('aceita apenas PIN numérico entre 4 e 6 dígitos', () => {
    expect(isPosPin('4826')).toBe(true);
    expect(isPosPin('482615')).toBe(true);
    expect(isPosPin('482')).toBe(false);
    expect(isPosPin('4826157')).toBe(false);
    expect(isPosPin('48a6')).toBe(false);
  });

  it('com bloqueio aos cinco minutos, bloqueia ao atingi-los', () => {
    const lastActivity = Date.UTC(2026, 7, 19, 12, 0, 0);
    const timeout = posIdleTimeoutMs(5);

    expect(timeout).toBe(300_000);
    expect(shouldLockPos(lastActivity, lastActivity + 299_999, timeout)).toBe(false);
    expect(shouldLockPos(lastActivity, lastActivity + 300_000, timeout)).toBe(true);
  });

  it('com "nunca", não há temporizador: fica aberto o turno inteiro', () => {
    const lastActivity = Date.UTC(2026, 8, 30, 8, 0, 0);
    const timeout = posIdleTimeoutMs(0);

    expect(timeout).toBeNull();
    expect(shouldLockPos(lastActivity, lastActivity + 12 * 3_600_000, timeout)).toBe(false);
  });

  it('valores estragados valem "nunca", não um bloqueio instantâneo', () => {
    expect(posIdleTimeoutMs(Number.NaN)).toBeNull();
    expect(posIdleTimeoutMs(-5)).toBeNull();
  });
});
