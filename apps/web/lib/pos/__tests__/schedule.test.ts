import { describe, expect, it } from 'vitest';
import {
  buildPickupSlots,
  formatSlot,
  parseTimeOfDay,
  MAPUTO_OFFSET,
} from '../schedule';

// 14:07 em Maputo (UTC+2) = 12:07 UTC.
const meioDia = new Date('2026-08-24T12:07:00.000Z');

describe('janelas de 30 minutos no balcão', () => {
  it('arranca na meia hora redonda seguinte, com tempo para a cozinha', () => {
    // 14:07 + 20 min de preparo = 14:27 → primeira janela às 14:30.
    const slots = buildPickupSlots({ now: meioDia, closesAt: '21:30' });
    expect(slots[0].label).toBe('14:30');
    expect(slots[1].label).toBe('15:00');
  });

  it('vai de 30 em 30 e pára quando a loja fecha', () => {
    const slots = buildPickupSlots({ now: meioDia, closesAt: '21:30' });
    expect(slots.at(-1)?.label).toBe('21:30');
    expect(slots.map((s) => s.label)).not.toContain('22:00');
  });

  // Prometer uma hora a que já não está lá ninguém é pior do que não agendar.
  it('não oferece nada depois do fecho, mesmo perto dele', () => {
    const quaseFecho = new Date('2026-08-24T19:20:00.000Z'); // 21:20 em Maputo
    const slots = buildPickupSlots({ now: quaseFecho, closesAt: '21:30' });
    expect(slots).toHaveLength(0);
  });

  // O erro que faz um pedido das 20h aparecer às 18h no relatório.
  it('grava com o fuso de Maputo explícito, e não em hora local do PC', () => {
    const slots = buildPickupSlots({ now: meioDia, closesAt: '21:30' });
    expect(slots[0].value).toBe(`2026-08-24T14:30:00${MAPUTO_OFFSET}`);
    // E o instante que isso representa é mesmo 12:30 UTC.
    expect(new Date(slots[0].value).toISOString()).toBe('2026-08-24T12:30:00.000Z');
  });

  it('sem horário conhecido continua a agendar, dentro de um horizonte', () => {
    const slots = buildPickupSlots({ now: meioDia, closesAt: null, horizonMinutes: 120 });
    expect(slots[0].label).toBe('14:30');
    expect(slots.at(-1)?.label).toBe('16:00');
  });

  // O número do dia reinicia à meia-noite: agendar para amanhã a partir do
  // balcão faria o pedido nascer com o número de hoje e ser chamado amanhã.
  it('nunca passa para o dia seguinte', () => {
    const tarde = new Date('2026-08-24T21:10:00.000Z'); // 23:10 em Maputo
    const slots = buildPickupSlots({ now: tarde, closesAt: null, horizonMinutes: 240 });
    expect(slots.every((s) => s.value.startsWith('2026-08-24'))).toBe(true);
    expect(slots.map((s) => s.label)).not.toContain('00:00');
  });

  it('lê a hora do store_hours com e sem segundos', () => {
    expect(parseTimeOfDay('21:30')).toBe(21 * 60 + 30);
    expect(parseTimeOfDay('21:30:00')).toBe(21 * 60 + 30);
    expect(parseTimeOfDay(null)).toBeNull();
    expect(parseTimeOfDay('sempre')).toBeNull();
  });

  it('mostra a hora marcada em Maputo, e "Agora" quando não há', () => {
    expect(formatSlot('2026-08-24T12:30:00.000Z')).toBe('14:30');
    expect(formatSlot(null)).toBe('Agora');
  });
});
