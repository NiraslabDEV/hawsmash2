import { describe, expect, it } from 'vitest';
import { isForLaterDay, scheduledDayLabel } from '../scheduled-day';

// Sexta, 23 Out 2026, 21:00 em Maputo.
const sexta = new Date('2026-10-23T19:00:00Z');

describe('dia do pedido agendado', () => {
  it('hoje e sem hora marcada não levam etiqueta', () => {
    expect(scheduledDayLabel(null, sexta)).toBeNull();
    expect(scheduledDayLabel('2026-10-23T20:30:00Z', sexta)).toBeNull();
  });

  it('o pedido de sábado feito na sexta diz "Amanhã"', () => {
    expect(scheduledDayLabel('2026-10-24T10:00:00Z', sexta)).toBe('Amanhã');
    expect(isForLaterDay('2026-10-24T10:00:00Z', sexta)).toBe(true);
  });

  it('conta o dia em Maputo, não em UTC', () => {
    // 22:30 UTC de sexta já é 00:30 de sábado em Maputo.
    expect(scheduledDayLabel('2026-10-23T22:30:00Z', sexta)).toBe('Amanhã');
    // 21:59 UTC de sexta ainda é sexta.
    expect(scheduledDayLabel('2026-10-23T21:59:00Z', sexta)).toBeNull();
  });

  it('mais à frente mostra o dia da semana e a data', () => {
    expect(scheduledDayLabel('2026-10-25T10:00:00Z', sexta)).toBe('Dom 25/10');
    expect(scheduledDayLabel('2026-10-26T10:00:00Z', sexta)).toBe('Seg 26/10');
  });

  it('um dia que já passou também se nota, mas não é "mais tarde"', () => {
    expect(scheduledDayLabel('2026-10-22T10:00:00Z', sexta)).toBe('Qui 22/10');
    expect(isForLaterDay('2026-10-22T10:00:00Z', sexta)).toBe(false);
    expect(isForLaterDay('2026-10-23T20:30:00Z', sexta)).toBe(false);
  });
});
