import { describe, expect, it } from 'vitest';

import { posItemAvailability, type PosMenuItem } from '../offline-store';

const item = (overrides: Partial<PosMenuItem> = {}): PosMenuItem => ({
  id: 'classic',
  name: 'Classic Smash',
  description: null,
  price_cents: 30000,
  station: 'kitchen',
  ...overrides,
});

describe('disponibilidade do item no POS', () => {
  it('deixa vender o item sem controlo de stock', () => {
    expect(posItemAvailability(item({ available: true }))).toEqual({
      sellable: true,
      badge: null,
    });
  });

  it('bloqueia o item marcado como indisponível pela loja', () => {
    expect(posItemAvailability(item({ available: false }))).toEqual({
      sellable: false,
      badge: 'ESGOTADO',
    });
  });

  it('bloqueia o item com stock a zero mesmo que a loja o mantenha activo', () => {
    expect(
      posItemAvailability(item({ available: true, track_stock: true, stock_qty: 0 })),
    ).toEqual({ sellable: false, badge: 'ESGOTADO' });
  });

  it('mostra quantas unidades restam quando a loja controla o stock', () => {
    expect(
      posItemAvailability(item({ available: true, track_stock: true, stock_qty: 3 })),
    ).toEqual({ sellable: true, badge: 'Restam 3' });
  });
});
