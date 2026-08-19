import { describe, expect, it } from 'vitest';

import {
  maputoDow,
  publicStoreListSchema,
  storeStatusLabel,
  todaysHours,
  type PublicStoreOption,
} from '../public-stores';

const store: PublicStoreOption = {
  slug: 'maputo',
  name: 'HAWSMASH Maputo',
  short_name: 'Maputo',
  address: 'Av. Julius Nyerere',
  phone: '860760009',
  maps_url: null,
  accepting_orders: true,
  delivery_enabled: true,
  pickup_enabled: true,
  open_now: false,
  hours: [
    { dow: 4, opens: '11:00:00', closes: '21:30:00', active: true },
    { dow: 5, opens: '11:00:00', closes: '21:30:00', active: true },
  ],
};

describe('lojas públicas', () => {
  it('valida a lista devolvida pelo servidor', () => {
    expect(publicStoreListSchema.parse([store])).toHaveLength(1);
    expect(() => publicStoreListSchema.parse([{ ...store, hours: 'sempre' }])).toThrow();
  });

  it('mostra o horário do dia sem segundos e assinala o dia fechado', () => {
    expect(todaysHours(store, 4)).toBe('Quinta: 11:00–21:30');
    expect(todaysHours(store, 1)).toBe('Fechado hoje');
  });

  it('descreve o estado da loja para quem vai encomendar', () => {
    expect(storeStatusLabel(store)).toBe('Fechada agora · aceita agendamento');
    expect(storeStatusLabel({ ...store, open_now: true })).toBe('Aberta agora');
    expect(storeStatusLabel({ ...store, accepting_orders: false })).toBe(
      'Não está a aceitar pedidos',
    );
  });

  it('usa o dia da semana de Maputo, não o do servidor', () => {
    // 22:30 UTC de sexta já é sábado em Maputo (UTC+2).
    expect(maputoDow(new Date('2026-08-21T22:30:00Z'))).toBe(6);
    expect(maputoDow(new Date('2026-08-21T09:00:00Z'))).toBe(5);
  });
});
