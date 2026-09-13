import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({ store: null as Record<string, string | null> | null, error: null as unknown, calls: [] as string[] }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      mocked.calls.push(table);
      const chain = { select: () => chain, eq: () => chain,
        single: async () => ({ data: { payment_provider: 'manual' }, error: null }),
        maybeSingle: async () => ({ data: mocked.store, error: mocked.error }),
      };
      return chain;
    },
  }),
}));
import { getPaymentConfig } from '../config';

beforeEach(() => {
  mocked.store = null; mocked.error = null; mocked.calls = [];
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://supabase.example');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'PLACEHOLDER_SERVICE_KEY');
  vi.stubEnv('PAYMENT_PROVIDER', 'manual');
});
afterEach(() => vi.unstubAllEnvs());

describe('configuração estrita da reconciliação', () => {
  it('usa M-Pesa da loja mesmo com configuração global manual', async () => {
    mocked.store = { payment_provider: 'mpesa', mpesa_api_key: 'PLACEHOLDER_API_KEY', mpesa_public_key: 'PLACEHOLDER_PUBLIC_KEY', mpesa_service_provider_code: 'PLACEHOLDER_CODE', mpesa_session_base_url: 'https://session.example', mpesa_charge_base_url: 'https://charge.example', mpesa_query_base_url: 'https://query.example' };
    expect(await getPaymentConfig('loja-a', { requireStore: true })).toMatchObject({ provider: 'mpesa', mpesa: { serviceProviderCode: 'PLACEHOLDER_CODE' } });
    expect(mocked.calls).toEqual(['settings', 'stores']);
  });
  it('recusa ausência/erro da loja em vez de reconciliar com credenciais globais', async () => {
    await expect(getPaymentConfig('loja-a', { requireStore: true })).rejects.toThrow('store_payment_config_unavailable');
    mocked.error = { message: 'SEGREDO_INTERNO' };
    await expect(getPaymentConfig('loja-a', { requireStore: true })).rejects.toThrow('store_payment_config_unavailable');
  });
  it('cancela antes de consultar e não cai no fallback global', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(getPaymentConfig('loja-a', { signal: controller.signal, requireStore: true })).rejects.toThrow();
    expect(mocked.calls).toEqual([]);
  });
});
