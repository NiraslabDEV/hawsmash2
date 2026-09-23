import { describe, expect, it } from 'vitest';
import { availabilityState, canMarkAvailability, toggleTarget } from '../availability';

describe('esgotado no balcão', () => {
  it('um produto marcado como indisponível está esgotado', () => {
    expect(availabilityState({ available: false, track_stock: false, stock_qty: 0 })).toBe('esgotado');
  });

  it('esgotado ganha ao stock — foi alguém que disse que acabou', () => {
    expect(availabilityState({ available: false, track_stock: true, stock_qty: 20 })).toBe('esgotado');
  });

  it('stock controlado a zero é outra coisa: não se resolve com um toque', () => {
    const estado = availabilityState({ available: true, track_stock: true, stock_qty: 0 });
    expect(estado).toBe('sem_stock');
    expect(toggleTarget(estado)).toBeNull();
  });

  it('stock sem controlo não conta — o produto está à venda', () => {
    expect(availabilityState({ available: true, track_stock: false, stock_qty: 0 })).toBe('disponivel');
  });

  it('o toque alterna entre à venda e esgotado', () => {
    expect(toggleTarget('disponivel')).toBe(false);
    expect(toggleTarget('esgotado')).toBe(true);
  });

  it('dono, gerente e caixa marcam; a cozinha não', () => {
    expect(canMarkAvailability('owner')).toBe(true);
    expect(canMarkAvailability('manager')).toBe(true);
    expect(canMarkAvailability('cashier')).toBe(true);
    expect(canMarkAvailability('kitchen')).toBe(false);
    expect(canMarkAvailability(null)).toBe(false);
  });
});
