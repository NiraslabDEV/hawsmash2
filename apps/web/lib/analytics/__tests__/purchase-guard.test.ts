/**
 * F4.3 — testes da regra crítica do purchase (CLAUDE.md 16.1).
 * purchase só dispara em paid/approved e nunca re-dispara (guard localStorage).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  isPurchaseStatus,
  purchaseGuardKey,
  shouldFirePurchase,
  markPurchaseFired,
} from '../purchase-guard';

// localStorage falso (in-memory) para testar o guard persistente
function fakeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
  };
}

let storage: ReturnType<typeof fakeStorage>;
beforeEach(() => {
  storage = fakeStorage();
});

describe('isPurchaseStatus', () => {
  it('true só para paid/approved', () => {
    expect(isPurchaseStatus('paid')).toBe(true);
    expect(isPurchaseStatus('approved')).toBe(true);
  });

  it('false para qualquer outro estado (e nulos)', () => {
    for (const s of ['awaiting_approval', 'awaiting_payment', 'in_preparation', 'ready', 'delivered', 'cancelled', '', null, undefined]) {
      expect(isPurchaseStatus(s)).toBe(false);
    }
  });
});

describe('shouldFirePurchase — NÃO dispara fora de paid/approved', () => {
  it('não dispara em awaiting_approval / awaiting_payment', () => {
    expect(shouldFirePurchase('awaiting_approval', 'o1', storage)).toBe(false);
    expect(shouldFirePurchase('awaiting_payment', 'o1', storage)).toBe(false);
  });

  it('dispara em paid e approved (primeira vez)', () => {
    expect(shouldFirePurchase('paid', 'o1', storage)).toBe(true);
    expect(shouldFirePurchase('approved', 'o2', storage)).toBe(true);
  });
});

describe('shouldFirePurchase — NÃO re-dispara em reload (localStorage)', () => {
  it('depois de marcado, não volta a disparar para o mesmo pedido', () => {
    expect(shouldFirePurchase('paid', 'o1', storage)).toBe(true);
    markPurchaseFired('o1', storage);
    // simula reload/polling: o estado continua paid, mas o guard bloqueia
    expect(shouldFirePurchase('paid', 'o1', storage)).toBe(false);
    expect(shouldFirePurchase('approved', 'o1', storage)).toBe(false);
  });

  it('pedidos diferentes têm guards independentes', () => {
    markPurchaseFired('o1', storage);
    expect(shouldFirePurchase('paid', 'o2', storage)).toBe(true);
  });
});

describe('purchaseGuardKey', () => {
  it('usa o formato tracked_purchase_<orderId>', () => {
    expect(purchaseGuardKey('abc-123')).toBe('tracked_purchase_abc-123');
  });
});
