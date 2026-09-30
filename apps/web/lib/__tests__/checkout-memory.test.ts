import { describe, expect, it } from 'vitest';
import {
  forgetCheckout,
  forgetSavedAddress,
  isEmail,
  readSavedAddress,
  readSavedCustomer,
  rememberCheckout,
} from '../checkout-memory';

const customer = { name: 'PLACEHOLDER_CLIENTE', phone: '840000000', email: 'cliente@example.invalid' };
const address = { address: 'PLACEHOLDER_MORADA', zoneId: 'PLACEHOLDER_ZONA' };

function storage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  };
}

describe('memória do checkout', () => {
  it('devolve nome, telefone, email e morada da última encomenda', () => {
    const store = storage();
    rememberCheckout(store, customer, address);
    expect(readSavedCustomer(store)).toEqual(customer);
    expect(readSavedAddress(store)).toEqual(address);
  });

  it('um levantamento não apaga a morada da entrega anterior', () => {
    const store = storage();
    rememberCheckout(store, customer, address);
    rememberCheckout(store, { ...customer, name: 'PLACEHOLDER_OUTRO' }, null);
    expect(readSavedCustomer(store)?.name).toBe('PLACEHOLDER_OUTRO');
    expect(readSavedAddress(store)).toEqual(address);
  });

  it('entregar noutro sítio esquece só a morada; "não sou eu" esquece tudo', () => {
    const store = storage();
    rememberCheckout(store, customer, address);
    forgetSavedAddress(store);
    expect(readSavedAddress(store)).toBeNull();
    expect(readSavedCustomer(store)).toEqual(customer);
    rememberCheckout(store, customer, address);
    forgetCheckout(store);
    expect(readSavedCustomer(store)).toBeNull();
    expect(readSavedAddress(store)).toBeNull();
  });

  it('ignora dados estragados em vez de rebentar o checkout', () => {
    const store = storage();
    store.data.set('dl_customer', '{não é json');
    store.data.set('dl_address', JSON.stringify({ address: 42, zoneId: {} }));
    expect(readSavedCustomer(store)).toBeNull();
    expect(readSavedAddress(store)).toBeNull();
  });

  it('storage bloqueado não impede a venda', () => {
    const blocked = {
      getItem: () => { throw new Error('bloqueado'); },
      setItem: () => { throw new Error('bloqueado'); },
      removeItem: () => { throw new Error('bloqueado'); },
    };
    expect(() => rememberCheckout(blocked, customer, address)).not.toThrow();
    expect(readSavedCustomer(blocked)).toBeNull();
    expect(() => forgetCheckout(blocked)).not.toThrow();
  });

  it('aceita emails com forma válida e recusa os óbvios erros', () => {
    expect(isEmail(' cliente@example.invalid ')).toBe(true);
    expect(isEmail('cliente@example')).toBe(false);
    expect(isEmail('cliente example.com')).toBe(false);
    expect(isEmail('')).toBe(false);
  });
});
