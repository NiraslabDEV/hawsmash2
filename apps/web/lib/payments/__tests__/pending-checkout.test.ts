import { describe, expect, it } from 'vitest';
import { clearPendingCheckout, getPendingCheckout, rememberPendingCheckout } from '../pending-checkout';
import { getCheckoutAttempt } from '../checkout-attempt';

const orderId = '10000000-0000-4000-8000-000000000010';
const otherOrderId = '10000000-0000-4000-8000-000000000011';
const items = [{ menuItemId: 'PLACEHOLDER_ITEM', qty: 1, notes: 'PLACEHOLDER_NOTA' }];
function storage() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
}

describe('referência de checkout pendente', () => {
  it('reutiliza a referência quando loja e carrinho são os mesmos', () => {
    const store = storage();
    rememberPendingCheckout(store, orderId, 'loja-a', items);
    expect(getPendingCheckout(store, 'loja-a', [...items])).toBe(orderId);
  });
  it('permite uma compra nova com outra loja ou outros itens', () => {
    const store = storage();
    rememberPendingCheckout(store, orderId, 'loja-a', items);
    expect(getPendingCheckout(store, 'loja-b', items)).toBeNull();
    expect(getPendingCheckout(store, 'loja-a', [{ ...items[0], qty: 2 }])).toBeNull();
  });
  it('não guarda notas nem usa uma mudança de notas para abrir nova tentativa', () => {
    const store = storage();
    rememberPendingCheckout(store, orderId, 'loja-a', items);
    expect(store.getItem('pending_checkout')).not.toContain('PLACEHOLDER_NOTA');
    expect(getPendingCheckout(store, 'loja-a', [{ ...items[0], notes: 'outra nota' }])).toBe(orderId);
  });
  it('limpar uma referência antiga não apaga a encomenda mais recente', () => {
    const store = storage();
    rememberPendingCheckout(store, otherOrderId, 'loja-a', items);
    clearPendingCheckout(store, orderId);
    expect(getPendingCheckout(store, 'loja-a', items)).toBe(otherOrderId);
    clearPendingCheckout(store, otherOrderId);
    expect(getPendingCheckout(store, 'loja-a', items)).toBeNull();
  });
  it('dados de armazenamento incompletos ou inválidos não quebram o checkout', () => {
    const store = storage();
    store.setItem('pending_checkout', '{');
    expect(getPendingCheckout(store, 'loja-a', items)).toBeNull();
    expect(() => clearPendingCheckout(store, orderId)).not.toThrow();
    rememberPendingCheckout(store, 'invalid-id', 'loja-a', items);
    expect(getPendingCheckout(store, 'loja-a', items)).toBeNull();
  });
  it('resolver o pedido limpa apenas a chave de tentativa associada', async () => {
    const store = storage();
    const payload = { items, paymentMethod: 'emola' };
    const key = await getCheckoutAttempt(store, payload);
    rememberPendingCheckout(store, orderId, 'loja-a', items, key);
    clearPendingCheckout(store, orderId);
    expect(await getCheckoutAttempt(store, payload)).not.toBe(key);
  });
});
