import { describe, expect, it, vi } from 'vitest';
import {
  AGENT_CHECKOUT_KEY,
  callPublicAgentTool,
  consumeAgentCheckout,
  isAgentOrderingPath,
  readAgentCart,
  registerBrowserTools,
  saveReviewedAgentCart,
  safeAgentReviewUrl,
  type BrowserTool,
} from '../webmcp';

const ITEM = '11111111-1111-4111-8111-111111111111';
const ZONE = '22222222-2222-4222-8222-222222222222';
const selection = { storeSlug: 'loja-centro', fulfillmentType: 'delivery' as const, deliveryZoneId: ZONE, items: [{ menuItemId: ITEM, qty: 2 }] };

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

describe('ciclo de ferramentas WebMCP', () => {
  const tool: BrowserTool = { name: 'get_cart', description: 'Carrinho', inputSchema: { type: 'object' }, execute: async () => ({ items: [] }) };

  it('não precisa de suporte do browser nem interrompe a página', () => {
    expect(() => registerBrowserTools({}, [tool])()).not.toThrow();
  });

  it('regista no document.modelContext e remove por AbortSignal', async () => {
    const registerTool = vi.fn(async (_tool: BrowserTool, _options: { signal: AbortSignal }) => {});
    const cleanup = registerBrowserTools({ modelContext: { registerTool } }, [tool]);
    await Promise.resolve();
    expect(registerTool).toHaveBeenCalledOnce();
    expect(registerTool.mock.calls[0]?.[0]).toMatchObject({ name: 'get_cart' });
    const signal = (registerTool.mock.calls as unknown as [BrowserTool, { signal: AbortSignal }][])?.[0]?.[1].signal;
    expect(signal.aborted).toBe(false);
    cleanup();
    expect(signal.aborted).toBe(true);
  });

  it('absorve falhas síncronas e assíncronas de registo', async () => {
    const sync = vi.fn(() => { throw new Error('unsupported'); });
    const asyncFailure = vi.fn(async () => { throw new Error('disabled'); });
    expect(() => registerBrowserTools({ modelContext: { registerTool: sync } }, [tool])()).not.toThrow();
    registerBrowserTools({ modelContext: { registerTool: asyncFailure } }, [tool])();
    await Promise.resolve();
    await Promise.resolve();
  });

  it('só disponibiliza ferramentas no percurso público de compra', () => {
    for (const route of ['/', '/menu', '/menu/item', '/l/loja-centro', '/upsell', '/checkout', '/pedido-assistido']) expect(isAgentOrderingPath(route)).toBe(true);
    for (const route of ['/perfil', '/pedidos', '/order-status/secret', '/m/token', '/admin', '/pos', '/checkout/secret']) expect(isAgentOrderingPath(route)).toBe(false);
  });
});

describe('chamadas públicas e navegação', () => {
  it('chama exclusivamente o endpoint local com nome autorizado e sem cookies', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ result: { totalCents: 100 } }), { status: 200 }));
    await expect(callPublicAgentTool('quote_order', selection, undefined, fetcher)).resolves.toEqual({ totalCents: 100 });
    expect(fetcher).toHaveBeenCalledWith('/api/agents/tools', expect.objectContaining({ method: 'POST', credentials: 'omit', body: JSON.stringify({ name: 'quote_order', arguments: selection }) }));
    await expect(callPublicAgentTool('create_order', {}, undefined, fetcher)).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('devolve erros claros quando o servidor recusa', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: 'Loja indisponível.' }), { status: 503 }));
    await expect(callPublicAgentTool('list_stores', {}, undefined, fetcher)).rejects.toThrow('Loja indisponível.');
  });

  it('recusa destinos externos, outras páginas e fragmentos vazios', () => {
    expect(safeAgentReviewUrl('/pedido-assistido#abc', 'https://loja.example')).toBe('/pedido-assistido#abc');
    expect(safeAgentReviewUrl('https://loja.example/pedido-assistido#abc', 'https://loja.example')).toBe('/pedido-assistido#abc');
    for (const url of ['https://evil.example/pedido-assistido#abc', '//evil.example/pedido-assistido#abc', 'javascript:alert(1)', '/checkout#abc', '/pedido-assistido', '/pedido-assistido?token=secret#abc']) expect(() => safeAgentReviewUrl(url, 'https://loja.example')).toThrow();
  });
});

describe('carrinho assistido e pertença à loja', () => {
  it('só expõe ids e quantidades, sem notas privadas nem dados extras', () => {
    const storage = memoryStorage({ cart_store: 'loja-centro', cart: JSON.stringify([{ menuItemId: ITEM, qty: 2, notes: 'Telefone privado', customerPhone: 'segredo', price: 1 }]), account: 'segredo' });
    expect(readAgentCart(storage)).toEqual({ storeSlug: 'loja-centro', items: [{ menuItemId: ITEM, qty: 2 }], notice: expect.any(String) });
  });

  it('não atribui um carrinho sem dono à loja por omissão', () => {
    const result = readAgentCart(memoryStorage({ cart: JSON.stringify(selection.items) }));
    expect(result.storeSlug).toBe(null);
    expect(result.items).toEqual(selection.items);
  });

  it('substitui exactamente e repetir não acumula quantidades', () => {
    const storage = memoryStorage({ cart_store: 'loja-norte', cart: '[{"menuItemId":"antigo","qty":1}]' });
    const session = memoryStorage();
    const setCookie = vi.fn();
    const first = saveReviewedAgentCart(selection, storage, session, setCookie);
    const second = saveReviewedAgentCart(selection, storage, session, setCookie);
    expect(first).toBe('/checkout?store=loja-centro');
    expect(second).toBe(first);
    expect(JSON.parse(storage.getItem('cart')!)).toEqual(selection.items);
    expect(storage.getItem('cart_store')).toBe('loja-centro');
    expect(setCookie).toHaveBeenCalledWith(expect.stringContaining('hs_store=loja-centro;'));
    expect(JSON.parse(session.getItem(AGENT_CHECKOUT_KEY)!)).toEqual({ storeSlug: 'loja-centro', fulfillmentType: 'delivery', deliveryZoneId: ZONE });
  });

  it('se a escrita falhar, conserva o carrinho anterior e não muda o cookie', () => {
    const storage = memoryStorage({ cart_store: 'loja-norte', cart: '[]' });
    const session = memoryStorage();
    session.setItem = () => { throw new Error('quota'); };
    const setCookie = vi.fn();
    expect(() => saveReviewedAgentCart(selection, storage, session, setCookie)).toThrow();
    expect(storage.getItem('cart_store')).toBe('loja-norte');
    expect(storage.getItem('cart')).toBe('[]');
    expect(setCookie).not.toHaveBeenCalled();
  });

  it('reverte a loja e preferências se a escrita do carrinho falhar a meio', () => {
    const storage = memoryStorage({ cart_store: 'loja-norte', cart: '[]' });
    const write = storage.setItem;
    storage.setItem = (key, value) => {
      if (key === 'cart' && value !== '[]') throw new Error('quota');
      write(key, value);
    };
    const session = memoryStorage();
    const setCookie = vi.fn();
    expect(() => saveReviewedAgentCart(selection, storage, session, setCookie)).toThrow();
    expect(storage.getItem('cart_store')).toBe('loja-norte');
    expect(storage.getItem('cart')).toBe('[]');
    expect(session.getItem(AGENT_CHECKOUT_KEY)).toBeNull();
    expect(setCookie).not.toHaveBeenCalled();
  });

  it('aplica entrega apenas na loja e zona correctas, consumindo a chave', () => {
    const session = memoryStorage({ [AGENT_CHECKOUT_KEY]: JSON.stringify(selection) });
    // O formato persistido só admite canal/loja/zona, nunca itens ou preços.
    expect(consumeAgentCheckout(session, 'loja-centro', [ZONE])).toBeNull();
    session.setItem(AGENT_CHECKOUT_KEY, JSON.stringify({ storeSlug: 'loja-centro', fulfillmentType: 'delivery', deliveryZoneId: ZONE }));
    expect(consumeAgentCheckout(session, 'loja-centro', [ZONE])).toEqual({ fulfillmentType: 'delivery', deliveryZoneId: ZONE });
    expect(session.getItem(AGENT_CHECKOUT_KEY)).toBeNull();
    expect(consumeAgentCheckout(session, 'loja-centro', [ZONE])).toBeNull();
  });

  it('descarta uma preferência de outra loja ou uma zona retirada', () => {
    const value = JSON.stringify({ storeSlug: 'loja-centro', fulfillmentType: 'delivery', deliveryZoneId: ZONE });
    expect(consumeAgentCheckout(memoryStorage({ [AGENT_CHECKOUT_KEY]: value }), 'loja-norte', [ZONE])).toBeNull();
    expect(consumeAgentCheckout(memoryStorage({ [AGENT_CHECKOUT_KEY]: value }), 'loja-centro', [])).toEqual({ fulfillmentType: 'delivery', deliveryZoneId: '' });
  });
});
