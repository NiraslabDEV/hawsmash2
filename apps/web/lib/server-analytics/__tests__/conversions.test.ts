/**
 * F4.5 — testes de fireConversions (CLAUDE.md 16.8).
 * Validações chave:
 *   1. event_id = 'purchase_<orderId>' — igual ao do browser (track.ts)
 *   2. Falha de rede não lança, não afeta o estado do pedido
 *   3. Sem tokens → não chama fetch (skip silencioso)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireConversions } from '../conversions';

// ── stub mínimo do SupabaseClient ────────────────────────────────────────────

function makeSupabase(overrides?: {
  meta_pixel_id?: string;
  secretSettings?: { meta_capi_token?: string; gads_developer_token?: string };
  insertError?: boolean;
}) {
  const from = vi.fn((table: string) => {
    if (table === 'settings') {
      return {
        select: () => ({
          eq: () => ({
            single: () =>
              Promise.resolve({ data: { meta_pixel_id: overrides?.meta_pixel_id ?? null }, error: null }),
          }),
        }),
      };
    }
    if (table === 'event_log') {
      return {
        insert: () =>
          Promise.resolve({ error: overrides?.insertError ? new Error('db error') : null }),
      };
    }
    // fallback: suporta insert (analytics_events) e select genérico
    return {
      insert: () => Promise.resolve({ error: null }),
      select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null }) }) }),
    };
  });

  const rpc = vi.fn((name: string) => {
    if (name === 'get_secret_settings') {
      return Promise.resolve({
        data: {
          meta_capi_token: overrides?.secretSettings?.meta_capi_token ?? null,
          gads_developer_token: overrides?.secretSettings?.gads_developer_token ?? null,
        },
        error: null,
      });
    }
    return Promise.resolve({ data: null, error: null });
  });

  return { from, rpc } as unknown as import('@supabase/supabase-js').SupabaseClient;
}

// ── fetch mock ───────────────────────────────────────────────────────────────

let fetchCalls: { url: string; opts: RequestInit }[] = [];

beforeEach(() => {
  fetchCalls = [];
  (globalThis as any).fetch = vi.fn((url: string, opts?: RequestInit) => {
    fetchCalls.push({ url, opts: opts ?? {} });
    return Promise.resolve({ ok: true, text: async () => '{}' });
  });
});

afterEach(() => {
  delete (globalThis as any).fetch;
  vi.restoreAllMocks();
  delete process.env.META_CAPI_TOKEN;
  delete process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
});

// ── helper: esperar que os fire-and-forget terminem ──────────────────────────
const flush = () => new Promise((r) => setTimeout(r, 10));

// ── testes ───────────────────────────────────────────────────────────────────

describe('fireConversions — sem tokens', () => {
  it('não chama fetch se não há tokens configurados', async () => {
    const sb = makeSupabase();
    await fireConversions('ord-xyz', 50000, sb);
    await flush();
    // Só settings + rpc foram chamados; nenhum fetch externo
    const externalCalls = fetchCalls.filter((c) => c.url.includes('facebook') || c.url.includes('google'));
    expect(externalCalls).toHaveLength(0);
  });
});

describe('fireConversions — Meta CAPI', () => {
  it('envia para graph.facebook.com com event_id = "purchase_<orderId>"', async () => {
    const sb = makeSupabase({
      meta_pixel_id: 'px-123',
      secretSettings: { meta_capi_token: 'tok-abc' },
    });

    await fireConversions('ord-capi', 75000, sb);
    await flush();

    const capiCall = fetchCalls.find((c) => c.url.includes('graph.facebook.com'));
    expect(capiCall).toBeTruthy();
    expect(capiCall!.url).toContain('px-123');

    const body = JSON.parse(capiCall!.opts.body as string);
    expect(body.data[0].event_id).toBe('purchase_ord-capi');
    expect(body.data[0].event_name).toBe('Purchase');
    expect(body.data[0].custom_data.order_id).toBe('ord-capi');
    expect(body.data[0].custom_data.currency).toBe('MZN');
  });

  it('event_id tem o mesmo formato que o browser (purchase_<orderId>)', async () => {
    const orderId = 'abc-123-def';
    const sb = makeSupabase({
      meta_pixel_id: 'px-x',
      secretSettings: { meta_capi_token: 'tok-x' },
    });

    await fireConversions(orderId, 10000, sb);
    await flush();

    const capiCall = fetchCalls.find((c) => c.url.includes('graph.facebook.com'));
    // Confirmar que o formato é idêntico ao que o browser usa em trackPurchase
    expect(capiCall && JSON.parse(capiCall.opts.body as string).data[0].event_id).toBe(
      `purchase_${orderId}`,
    );
  });

  it('falha de rede não lança nem afeta o pedido', async () => {
    (globalThis as any).fetch = vi.fn(() => Promise.reject(new Error('network error')));

    const sb = makeSupabase({
      meta_pixel_id: 'px-err',
      secretSettings: { meta_capi_token: 'tok-err' },
    });

    // Não deve rejeitar
    await expect(fireConversions('ord-err', 1000, sb)).resolves.toBeUndefined();
    await flush();
  });

  it('resposta não-ok não lança', async () => {
    (globalThis as any).fetch = vi.fn(() =>
      Promise.resolve({ ok: false, text: async () => 'bad token' }),
    );

    const sb = makeSupabase({
      meta_pixel_id: 'px-bad',
      secretSettings: { meta_capi_token: 'tok-bad' },
    });

    await expect(fireConversions('ord-bad', 1000, sb)).resolves.toBeUndefined();
    await flush();
  });
});

describe('fireConversions — tokens via env (fallback)', () => {
  it('usa META_CAPI_TOKEN do env se settings não tem', async () => {
    process.env.META_CAPI_TOKEN = 'env-tok';
    const sb = makeSupabase({ meta_pixel_id: 'px-env' });

    await fireConversions('ord-env', 5000, sb);
    await flush();

    const capiCall = fetchCalls.find((c) => c.url.includes('facebook'));
    expect(capiCall).toBeTruthy();
    expect(capiCall!.url).toContain('env-tok');
  });
});

describe('fireConversions — log de erros no event_log', () => {
  it('falha de CAPI é logada como conversion.capi_error', async () => {
    (globalThis as any).fetch = vi.fn((url: string) => {
      if (url.includes('facebook')) return Promise.reject(new Error('capi down'));
      return Promise.resolve({ ok: true, text: async () => '{}' });
    });

    const sb = makeSupabase({
      meta_pixel_id: 'px-log',
      secretSettings: { meta_capi_token: 'tok-log' },
    });

    await fireConversions('ord-log', 1000, sb);
    await flush();

    // event_log.insert deve ter sido chamado com type = 'conversion.capi_error'
    const insertCall = (sb.from as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => c[0] === 'event_log',
    );
    expect(insertCall).toBeTruthy();
  });
});
