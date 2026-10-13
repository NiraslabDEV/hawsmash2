import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearPendingProof, readPendingProof, rememberPendingProof } from '../pending-proof';

const orderId = '10000000-0000-4000-8000-000000000010';
const otherOrderId = '10000000-0000-4000-8000-000000000011';
const pending = { orderId, storeSlug: 'loja-a', method: 'mpesa' as const, totalCents: 85_000, orderNumber: 'ENC-0123' };

function storage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  };
}

afterEach(() => { vi.useRealTimers(); });

describe('pedido à espera de comprovativo', () => {
  it('devolve o mesmo pedido a quem volta do M-Pesa', () => {
    const store = storage();
    rememberPendingProof(store, pending);
    expect(readPendingProof(store, 'loja-a')).toEqual(pending);
  });

  it('não devolve o pedido de outra loja', () => {
    const store = storage();
    rememberPendingProof(store, pending);
    expect(readPendingProof(store, 'loja-b')).toBeNull();
  });

  it('esquece o pedido passadas doze horas, para não cair em cima do dia seguinte', () => {
    vi.useFakeTimers();
    const store = storage();
    rememberPendingProof(store, pending);
    vi.advanceTimersByTime(11 * 60 * 60 * 1000);
    expect(readPendingProof(store, 'loja-a')).toEqual(pending);
    vi.advanceTimersByTime(2 * 60 * 60 * 1000);
    expect(readPendingProof(store, 'loja-a')).toBeNull();
    expect(store.getItem('pending_proof')).toBeNull();
  });

  it('limpar um pedido antigo não apaga o que está à espera agora', () => {
    const store = storage();
    rememberPendingProof(store, { ...pending, orderId: otherOrderId });
    clearPendingProof(store, orderId);
    expect(readPendingProof(store, 'loja-a')?.orderId).toBe(otherOrderId);
    clearPendingProof(store, otherOrderId);
    expect(readPendingProof(store, 'loja-a')).toBeNull();
  });

  it('sem id, esquece seja qual for — é a desistência explícita da pessoa', () => {
    const store = storage();
    rememberPendingProof(store, pending);
    clearPendingProof(store);
    expect(readPendingProof(store, 'loja-a')).toBeNull();
  });

  it('armazenamento inválido não quebra o checkout', () => {
    const store = storage();
    store.setItem('pending_proof', '{');
    expect(readPendingProof(store, 'loja-a')).toBeNull();
    store.setItem('pending_proof', JSON.stringify({ version: 1, orderId: 'nao-e-uuid', storeSlug: 'loja-a', method: 'mpesa', totalCents: 1, createdAt: Date.now() }));
    expect(readPendingProof(store, 'loja-a')).toBeNull();
    rememberPendingProof(store, { ...pending, orderId: 'nao-e-uuid' });
    expect(readPendingProof(store, 'loja-a')).toBeNull();
    expect(() => clearPendingProof(store, orderId)).not.toThrow();
  });

  it('um browser que recusa armazenamento não impede o pedido', () => {
    const blocked = {
      getItem: () => { throw new Error('bloqueado'); },
      setItem: () => { throw new Error('bloqueado'); },
      removeItem: () => { throw new Error('bloqueado'); },
    };
    expect(() => rememberPendingProof(blocked, pending)).not.toThrow();
    expect(readPendingProof(blocked, 'loja-a')).toBeNull();
    expect(() => clearPendingProof(blocked)).not.toThrow();
  });
});
