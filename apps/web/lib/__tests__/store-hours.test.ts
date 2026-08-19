import { describe, expect, it } from 'vitest';

import { buildScheduleSlots, type StoreHour } from '../store-hours';

// Quinta a sábado, como as duas lojas do HAWSMASH.
const hours: StoreHour[] = [
  { dow: 4, opens: '11:00:00', closes: '21:30:00', active: true },
  { dow: 5, opens: '11:00:00', closes: '21:30:00', active: true },
  { dow: 6, opens: '12:00:00', closes: '21:30:00', active: true },
];

describe('agendamento pelos horários da loja', () => {
  it('não oferece horários fora do que a loja abre', () => {
    // Quinta, 20/08/2026, 08:00 em Maputo (06:00 UTC).
    const slots = buildScheduleSlots(hours, new Date('2026-08-20T06:00:00Z'));

    expect(slots.length).toBeGreaterThan(0);
    expect(slots[0].label).toBe('Quinta · 11:00');
    expect(slots.every((slot) => slot.label !== 'Quinta · 10:30')).toBe(true);
    expect(slots.some((slot) => slot.label === 'Quinta · 21:00')).toBe(true);
    expect(slots.some((slot) => slot.label === 'Quinta · 21:30')).toBe(false);
  });

  it('respeita o tempo mínimo de preparação a partir de agora', () => {
    // Quinta, 20/08/2026, 15:05 em Maputo.
    const slots = buildScheduleSlots(hours, new Date('2026-08-20T13:05:00Z'));

    expect(slots[0].label).toBe('Quinta · 16:00');
    expect(new Date(slots[0].iso).toISOString()).toBe('2026-08-20T14:00:00.000Z');
  });

  it('salta o dia fechado e continua no dia seguinte em que a loja abre', () => {
    // Segunda, 17/08/2026, 10:00 em Maputo: a loja só reabre na quinta.
    const slots = buildScheduleSlots(hours, new Date('2026-08-17T08:00:00Z'), { horizonDays: 4 });

    expect(slots.every((slot) => !slot.label.startsWith('Segunda'))).toBe(true);
    expect(slots[0].label).toBe('Quinta · 11:00');
  });

  it('não devolve horários quando a loja não tem horário activo', () => {
    expect(buildScheduleSlots([], new Date('2026-08-20T06:00:00Z'))).toEqual([]);
  });
});
