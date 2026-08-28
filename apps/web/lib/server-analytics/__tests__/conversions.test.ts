/**
 * F4.5 / 1030 — testes de fireConversions com fila (CLAUDE.md 16.8, §11.2).
 *
 * O que estes testes protegem:
 *   1. event_id = 'purchase_<orderId>' — igual ao do browser (track.ts)
 *   2. nada disto lança: a venda nunca pode cair por causa de marketing
 *   3. a conversão vai identificada (user_data em SHA-256) e com a hora da VENDA
 *   4. falhar não perde a conversão — devolve o trabalho à fila com o erro
 *   5. Google Ads sem gclid é recusado antes de sair pedido nenhum
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { fireConversions } from '../conversions';

// ── stub do SupabaseClient ───────────────────────────────────────────────────

const SALE_TIME = '2026-08-20T10:00:00.000Z';

interface StubOptions {
  meta_pixel_id?: string;
  secretSettings?: { meta_capi_token?: string; gads_developer_token?: string };
  /** trabalhos que a fila devolve ao worker */
  jobs?: Array<Record<string, unknown>>;
  context?: Record<string, unknown> | null;
  /** 0 = nada foi para a fila (venda de balcão, ou ainda sem dinheiro) */
  enqueued?: number;
}

function makeContext(over?: Record<string, unknown>) {
  return {
    order_id: 'ord-capi',
    order_number: 'MPT-0042',
    total_cents: 75000,
    created_at: SALE_TIME,
    customer_name: 'Ridwan Nissar',
    customer_phone: '84 123 4567',
    customer_email: 'RIDWAN@Example.com ',
    attribution: {
      channel: 'paid_social',
      source: 'instagram',
      campaign: 'abertura',
      click_ids: { fbclid: 'IwAR-abc' },
      fbp: 'fb.1.1700000000000.1234567890',
      client_ip: '197.218.1.1',
      user_agent: 'Mozilla/5.0',
      event_source_url: 'https://hawsmash.com/l/maputo',
      created_at: SALE_TIME,
    },
    items: [{ id: 'item-1', name: 'Classic Smash', qty: 2, price_cents: 30000 }],
    ...over,
  };
}

function makeSupabase(opts: StubOptions = {}) {
  const rpcCalls: Array<{ name: string; args: unknown }> = [];

  const from = vi.fn((table: string) => {
    if (table === 'settings') {
      return {
        select: () => ({
          eq: () => ({
            single: () =>
              Promise.resolve({ data: { meta_pixel_id: opts.meta_pixel_id ?? null }, error: null }),
          }),
        }),
      };
    }
    return {
      insert: () => Promise.resolve({ error: null }),
      select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null }) }) }),
    };
  });

  const rpc = vi.fn((name: string, args?: unknown) => {
    rpcCalls.push({ name, args });
    switch (name) {
      case 'get_secret_settings':
        return Promise.resolve({
          data: {
            meta_capi_token: opts.secretSettings?.meta_capi_token ?? null,
            gads_developer_token: opts.secretSettings?.gads_developer_token ?? null,
          },
          error: null,
        });
      case 'enqueue_conversions':
        return Promise.resolve({ data: opts.enqueued ?? 1, error: null });
      case 'claim_conversion_jobs':
        return Promise.resolve({
          data: opts.jobs ?? [
            {
              id: 1,
              order_id: 'ord-capi',
              store_id: 'store-1',
              destination: 'meta_capi',
              event_name: 'Purchase',
              value_cents: 75000,
              attempts: 1,
            },
          ],
          error: null,
        });
      case 'get_conversion_context':
        return Promise.resolve({
          data: opts.context === undefined ? makeContext() : opts.context,
          error: null,
        });
      default:
        return Promise.resolve({ data: null, error: null });
    }
  });

  const client = { from, rpc } as unknown as import('@supabase/supabase-js').SupabaseClient;
  return { client, rpcCalls, from, rpc };
}

function completion(rpcCalls: Array<{ name: string; args: unknown }>) {
  return rpcCalls.find((c) => c.name === 'complete_conversion_job')?.args as
    | { p_id: number; p_ok: boolean; p_error: string | null; p_response: unknown }
    | undefined;
}

// ── fetch mock ───────────────────────────────────────────────────────────────

let fetchCalls: { url: string; opts: RequestInit }[] = [];

beforeEach(() => {
  fetchCalls = [];
  (globalThis as any).fetch = vi.fn((url: string, opts?: RequestInit) => {
    fetchCalls.push({ url, opts: opts ?? {} });
    return Promise.resolve({ ok: true, text: async () => '{"events_received":1}' });
  });
});

afterEach(() => {
  delete (globalThis as any).fetch;
  vi.restoreAllMocks();
  delete process.env.META_CAPI_TOKEN;
  delete process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  delete process.env.GADS_CONVERSION_ACTION;
  delete process.env.GADS_CUSTOMER_ID;
});

// ── testes ───────────────────────────────────────────────────────────────────

describe('fireConversions — a venda manda', () => {
  it('regista o purchase do funil antes de tudo o resto', async () => {
    const { client, rpcCalls } = makeSupabase();
    await fireConversions('ord-capi', 75000, client);
    expect(rpcCalls[0].name).toBe('record_server_purchase_event');
  });

  it('venda de balcão não vai para a fila nem sai da loja', async () => {
    const { client, rpcCalls } = makeSupabase({ enqueued: 0 });
    await fireConversions('ord-balcao', 30000, client);

    expect(rpcCalls.some((c) => c.name === 'claim_conversion_jobs')).toBe(false);
    expect(fetchCalls).toHaveLength(0);
  });

  it('sem tokens configurados não sai pedido nenhum para fora', async () => {
    const { client, rpcCalls } = makeSupabase();
    await fireConversions('ord-xyz', 50000, client);

    expect(fetchCalls.filter((c) => /facebook|google/.test(c.url))).toHaveLength(0);
    // e o trabalho volta à fila com o motivo, em vez de desaparecer
    expect(completion(rpcCalls)?.p_ok).toBe(false);
    expect(completion(rpcCalls)?.p_error).toContain('meta_nao_configurada');
  });

  it('falha de rede não lança', async () => {
    (globalThis as any).fetch = vi.fn(() => Promise.reject(new Error('network error')));
    const { client } = makeSupabase({
      meta_pixel_id: 'px-err',
      secretSettings: { meta_capi_token: 'tok-err' },
    });
    await expect(fireConversions('ord-err', 1000, client)).resolves.toBeUndefined();
  });

  it('resposta não-ok devolve o trabalho à fila com o erro', async () => {
    (globalThis as any).fetch = vi.fn(() =>
      Promise.resolve({ ok: false, status: 400, text: async () => 'bad token' }),
    );
    const { client, rpcCalls } = makeSupabase({
      meta_pixel_id: 'px-bad',
      secretSettings: { meta_capi_token: 'tok-bad' },
    });

    await fireConversions('ord-bad', 1000, client);

    const done = completion(rpcCalls);
    expect(done?.p_ok).toBe(false);
    expect(done?.p_error).toContain('Meta CAPI 400');
  });
});

describe('fireConversions — Meta CAPI', () => {
  function metaSupabase(over?: StubOptions) {
    return makeSupabase({
      meta_pixel_id: 'px-123',
      secretSettings: { meta_capi_token: 'tok-abc' },
      ...over,
    });
  }

  it('envia para o pixel certo com event_id igual ao do browser', async () => {
    const { client } = metaSupabase();
    await fireConversions('ord-capi', 75000, client);

    const call = fetchCalls.find((c) => c.url.includes('graph.facebook.com'));
    expect(call).toBeTruthy();
    expect(call!.url).toContain('px-123');

    const body = JSON.parse(call!.opts.body as string);
    expect(body.data[0].event_id).toBe('purchase_ord-capi');
    expect(body.data[0].event_name).toBe('Purchase');
    expect(body.data[0].custom_data.currency).toBe('MZN');
    expect(body.data[0].custom_data.value).toBe(750);
    expect(body.data[0].custom_data.num_items).toBe(2);
  });

  it('identifica o comprador só por hash — nunca em claro', async () => {
    const { client } = metaSupabase();
    await fireConversions('ord-capi', 75000, client);

    const body = JSON.parse(
      fetchCalls.find((c) => c.url.includes('graph.facebook.com'))!.opts.body as string,
    );
    const ud = body.data[0].user_data;
    const raw = JSON.stringify(body);

    expect(ud.ph[0]).toMatch(/^[a-f0-9]{64}$/);
    expect(ud.em[0]).toMatch(/^[a-f0-9]{64}$/);
    expect(ud.fn[0]).toMatch(/^[a-f0-9]{64}$/);
    expect(ud.external_id[0]).toBe(ud.ph[0]);

    // nem o telefone nem o email podem aparecer em lado nenhum do payload
    expect(raw).not.toContain('841234567');
    expect(raw.toLowerCase()).not.toContain('ridwan@example.com');
  });

  it('leva fbp, fbc reconstruído do fbclid, ip e user agent', async () => {
    const { client } = metaSupabase();
    await fireConversions('ord-capi', 75000, client);

    const body = JSON.parse(
      fetchCalls.find((c) => c.url.includes('graph.facebook.com'))!.opts.body as string,
    );
    const ud = body.data[0].user_data;

    expect(ud.fbp).toBe('fb.1.1700000000000.1234567890');
    expect(ud.fbc).toBe(`fb.1.${Date.parse(SALE_TIME)}.IwAR-abc`);
    expect(ud.client_ip_address).toBe('197.218.1.1');
    expect(ud.client_user_agent).toBe('Mozilla/5.0');
    expect(body.data[0].event_source_url).toBe('https://hawsmash.com/l/maputo');
  });

  it('event_time é a hora da venda, não a da tentativa que finalmente passou', async () => {
    const { client } = metaSupabase();
    await fireConversions('ord-capi', 75000, client);

    const body = JSON.parse(
      fetchCalls.find((c) => c.url.includes('graph.facebook.com'))!.opts.body as string,
    );
    expect(body.data[0].event_time).toBe(Math.floor(Date.parse(SALE_TIME) / 1000));
  });

  it('usa META_CAPI_TOKEN do env quando settings não tem', async () => {
    process.env.META_CAPI_TOKEN = 'env-tok';
    const { client } = makeSupabase({ meta_pixel_id: 'px-env' });
    await fireConversions('ord-env', 5000, client);

    const call = fetchCalls.find((c) => c.url.includes('facebook'));
    expect(call?.url).toContain('env-tok');
  });
});

describe('fireConversions — Google Ads', () => {
  const googleJob = [
    {
      id: 7,
      order_id: 'ord-capi',
      store_id: 'store-1',
      destination: 'google_ads',
      event_name: 'Purchase',
      value_cents: 75000,
      attempts: 1,
    },
  ];

  it('sem gclid não tenta importar nada', async () => {
    process.env.GADS_CONVERSION_ACTION = 'customers/1/conversionActions/2';
    process.env.GADS_CUSTOMER_ID = '123';

    const { client, rpcCalls } = makeSupabase({
      jobs: googleJob,
      secretSettings: { gads_developer_token: 'dev-tok' },
    });
    await fireConversions('ord-capi', 75000, client);

    expect(fetchCalls.filter((c) => c.url.includes('googleads'))).toHaveLength(0);
    expect(completion(rpcCalls)?.p_error).toContain('sem_gclid');
  });

  it('com gclid envia a conversão de clique com a data da venda', async () => {
    process.env.GADS_CONVERSION_ACTION = 'customers/1/conversionActions/2';
    process.env.GADS_CUSTOMER_ID = '123';

    const { client } = makeSupabase({
      jobs: googleJob,
      secretSettings: { gads_developer_token: 'dev-tok' },
      context: makeContext({
        attribution: { ...makeContext().attribution, click_ids: { gclid: 'GCL-1' } },
      }),
    });
    await fireConversions('ord-capi', 75000, client);

    const call = fetchCalls.find((c) => c.url.includes('googleads'));
    expect(call).toBeTruthy();
    const body = JSON.parse(call!.opts.body as string);
    expect(body.conversions[0].gclid).toBe('GCL-1');
    expect(body.conversions[0].conversionValue).toBe(750);
    expect(body.conversions[0].conversionDateTime).toContain('2026-08-20');
  });
});
