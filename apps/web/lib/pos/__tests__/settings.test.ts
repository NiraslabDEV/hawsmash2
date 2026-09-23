import { describe, expect, it } from 'vitest';
import {
  enabledPaymentMethods,
  FACTORY_POS_SETTINGS,
  fetchPosSettings,
  readCachedPosSettings,
  resolvePosSettings,
  writeCachedPosSettings,
} from '../settings';

describe('definições do POS — leitura tolerante', () => {
  it('sem nada gravado, usa o valor de fábrica', () => {
    expect(resolvePosSettings(null)).toEqual(FACTORY_POS_SETTINGS);
    expect(resolvePosSettings({})).toEqual(FACTORY_POS_SETTINGS);
    expect(resolvePosSettings('lixo')).toEqual(FACTORY_POS_SETTINGS);
  });

  it('um campo estragado cai no de fábrica sem levar os outros', () => {
    const s = resolvePosSettings({
      quickNotes: ['SEM SAL'],
      cart: { defaultFulfillment: 'mesa-voadora', askCustomerOnCounter: false },
      sale: { confirmationSeconds: 'três' },
    });
    expect(s.quickNotes).toEqual(['SEM SAL']);
    expect(s.cart.defaultFulfillment).toBe('counter');
    expect(s.cart.askCustomerOnCounter).toBe(false);
    expect(s.sale.confirmationSeconds).toBe(3);
  });

  it('respeita a ordem e os nomes dos meios de pagamento da loja', () => {
    const s = resolvePosSettings({
      payments: {
        methods: [
          { id: 'mpesa', enabled: true, label: 'M-Pesa' },
          { id: 'cash', enabled: true, label: 'Cash' },
          { id: 'credit_card', enabled: false, label: 'POS bancário' },
          { id: 'bitcoin', enabled: true, label: 'Bitcoin' },
        ],
      },
    });
    expect(s.payments.methods.map((m) => m.id)).toEqual(['mpesa', 'cash', 'credit_card', 'emola']);
    expect(s.payments.methods[1].label).toBe('Cash');
    // O que a loja não escolheu entra desligado.
    expect(s.payments.methods[3].enabled).toBe(false);
    expect(enabledPaymentMethods(s).map((m) => m.id)).toEqual(['mpesa', 'cash']);
  });

  it('a venda nunca pára: sem nenhum meio ligado, o dinheiro volta', () => {
    const s = resolvePosSettings({
      payments: { methods: [{ id: 'cash', enabled: false }, { id: 'mpesa', enabled: false }] },
    });
    expect(enabledPaymentMethods(s).map((m) => m.id)).toEqual(['cash']);
  });

  it('limpa as notas rápidas: sem vazios nem repetidos', () => {
    const s = resolvePosSettings({ quickNotes: ['  sem sal ', '', 'SEM SAL', 42, 'PARA LEVAR'] });
    expect(s.quickNotes).toEqual(['sem sal', 'PARA LEVAR']);
  });

  it('limita o tempo de confirmação a um intervalo usável', () => {
    expect(resolvePosSettings({ sale: { confirmationSeconds: 0 } }).sale.confirmationSeconds).toBe(1);
    expect(resolvePosSettings({ sale: { confirmationSeconds: 999 } }).sale.confirmationSeconds).toBe(15);
  });

  it('lê os passos do upsell e desliga só o que se pediu', () => {
    const s = resolvePosSettings({
      upsell: { enabled: true, steps: { dessert: { enabled: false, title: 'Doce?', scripts: ['Um doce?'] } } },
    });
    expect(s.upsell.steps.dessert).toEqual({ enabled: false, title: 'Doce?', scripts: ['Um doce?'] });
    expect(s.upsell.steps.companion).toEqual(FACTORY_POS_SETTINGS.upsell.steps.companion);
  });
});

describe('definições do POS — leitura da BD', () => {
  const cliente = (resposta: () => PromiseLike<{ data: unknown; error: unknown }>) => ({
    rpc: () => resposta(),
  });

  it('resolve o config que a RPC devolve', async () => {
    const lidas = await fetchPosSettings(
      cliente(() => Promise.resolve({ data: { config: { quickNotes: ['SEM SAL'] } }, error: null })),
      'loja',
    );
    expect(lidas?.quickNotes).toEqual(['SEM SAL']);
  });

  it('erro ou excepção devolvem null — o POS fica com o que já tinha', async () => {
    expect(
      await fetchPosSettings(cliente(() => Promise.resolve({ data: null, error: { message: 'x' } })), 'loja'),
    ).toBeNull();
    expect(await fetchPosSettings(cliente(() => Promise.reject(new Error('sem rede'))), 'loja')).toBeNull();
  });
});

describe('definições do POS — cache offline', () => {
  it('guarda e devolve por loja', () => {
    const mem = new Map<string, string>();
    const storage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
    };
    const s = resolvePosSettings({ quickNotes: ['SEM SAL'] });
    writeCachedPosSettings(storage, 'loja-a', s);
    expect(readCachedPosSettings(storage, 'loja-a')).toEqual(s);
    expect(readCachedPosSettings(storage, 'loja-b')).toBeNull();
  });

  it('cache estragada não rebenta', () => {
    const storage = { getItem: () => '{nao é json', setItem: () => undefined };
    expect(readCachedPosSettings(storage, 'x')).toBeNull();
  });
});
