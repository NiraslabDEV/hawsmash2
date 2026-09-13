import { describe, expect, it } from 'vitest';
import { clearCheckoutAttempt, getCheckoutAttempt } from '../checkout-attempt';

function storage() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
}
const payload = { storeSlug: 'PLACEHOLDER_LOJA', customerPhone: 'PLACEHOLDER_TELEFONE', customerName: 'PLACEHOLDER_CLIENTE', paymentMethod: 'emola', items: [{ menuItemId: 'PLACEHOLDER_ITEM', qty: 1, notes: 'PLACEHOLDER_NOTA' }] };

describe('chave estável antes de iniciar pagamento', () => {
  it('reutiliza a chave UUID no retry do mesmo JSON, mesmo com ordem diferente de campos', async () => {
    const store = storage();
    const first = await getCheckoutAttempt(store, payload);
    const second = await getCheckoutAttempt(store, { items: payload.items, paymentMethod: 'emola', customerName: payload.customerName, customerPhone: payload.customerPhone, storeSlug: payload.storeSlug });
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(second).toBe(first);
  });
  it('guarda apenas versão, UUID e digest; inclui notas e telefone no digest', async () => {
    const store = storage();
    const first = await getCheckoutAttempt(store, payload);
    const saved = JSON.parse(store.getItem('checkout_attempt')!);
    expect(Object.keys(saved).sort()).toEqual(['digest', 'key', 'version']);
    expect(saved.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(saved)).not.toContain('PLACEHOLDER');
    const changed = await getCheckoutAttempt(store, { ...payload, customerPhone: 'PLACEHOLDER_OUTRO_TELEFONE' });
    expect(changed).not.toBe(first);
    expect(await getCheckoutAttempt(store, { ...payload, items: [{ ...payload.items[0], notes: 'OUTRA_NOTA' }] })).not.toBe(changed);
  });
  it('representa o JSON efectivamente enviado: omite undefined e preserva arrays', async () => {
    const store = storage();
    const first = await getCheckoutAttempt(store, { ...payload, optional: undefined });
    expect(await getCheckoutAttempt(store, payload)).toBe(first);
    expect(await getCheckoutAttempt(store, { ...payload, items: [...payload.items, { ...payload.items[0], qty: 2 }] })).not.toBe(first);
  });
  it('recusa armazenamento bloqueado ou escrita que não ficou guardada', async () => {
    const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => {}, removeItem: () => {} };
    await expect(getCheckoutAttempt(blocked, payload)).rejects.toThrow('guardar');
    await expect(getCheckoutAttempt({ getItem: () => null, setItem: () => {}, removeItem: () => {} }, payload)).rejects.toThrow('guardar');
  });
  it('uma referência corrompida não é substituída silenciosamente', async () => {
    const store = storage();
    store.setItem('checkout_attempt', '{');
    await expect(getCheckoutAttempt(store, payload)).rejects.toThrow('guardar');
    expect(store.getItem('checkout_attempt')).toBe('{');
  });
  it('uma tentativa antiga só limpa a sua própria chave', async () => {
    const store = storage();
    const first = await getCheckoutAttempt(store, payload);
    const second = await getCheckoutAttempt(store, { ...payload, paymentMethod: 'mpesa' });
    clearCheckoutAttempt(store, first);
    expect(await getCheckoutAttempt(store, { ...payload, paymentMethod: 'mpesa' })).toBe(second);
    clearCheckoutAttempt(store, second);
    expect(await getCheckoutAttempt(store, { ...payload, paymentMethod: 'mpesa' })).not.toBe(second);
  });
});
