import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({ store: null as Record<string, string | null> | null }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: () => {
  const chain = { select: () => chain, eq: () => chain,
    single: async () => ({ data: { payment_provider: 'paysuite', paysuite_api_key: 'PLACEHOLDER_GLOBAL_KEY', paysuite_webhook_secret: 'PLACEHOLDER_GLOBAL_SECRET' } }),
    maybeSingle: async () => ({ data: mocked.store, error: null }),
  }; return chain;
} }) }));
import { buildProvider, getPaymentConfig, isDirectFlow, type PaymentConfig } from '../config';

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://supabase.example');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'PLACEHOLDER_SERVICE');
  mocked.store = { payment_provider: 'mpesa', emola_provider: 'paysuite', paysuite_api_key: 'PLACEHOLDER_LOJA_KEY', paysuite_webhook_secret: 'PLACEHOLDER_LOJA_SECRET' };
});
afterEach(() => vi.unstubAllEnvs());

describe('e-Mola com configuração da própria loja', () => {
  it('selecciona Paysuite para e-Mola e mantém M-Pesa directo', async () => {
    expect(await getPaymentConfig('loja-a', { requireStore: true, method: 'emola' })).toMatchObject({ provider: 'paysuite', apiKey: 'PLACEHOLDER_LOJA_KEY', webhookSecret: 'PLACEHOLDER_LOJA_SECRET' });
    expect(await getPaymentConfig('loja-a', { requireStore: true, method: 'mpesa' })).toMatchObject({ provider: 'mpesa' });
  });
  it('não usa a chave global quando o e-Mola da loja está incompleto', async () => {
    mocked.store!.paysuite_api_key = null;
    const config = await getPaymentConfig('loja-a', { requireStore: true, method: 'emola' });
    expect(config.apiKey).toBeNull();
    expect(() => buildProvider(config)).toThrow('paysuite_not_configured');
  });
  it('também exige o segredo webhook da própria loja', async () => {
    mocked.store!.paysuite_webhook_secret = null;
    const config = await getPaymentConfig('loja-a', { requireStore: true, method: 'emola' });
    expect(config.webhookSecret).toBeNull();
    expect(() => buildProvider(config)).toThrow('paysuite_not_configured');
  });
  it('M-Pesa directo sem configuração de e-Mola continua manual nesse método', async () => {
    mocked.store!.emola_provider = null;
    expect(await getPaymentConfig('loja-a', { requireStore: true, method: 'emola' })).toMatchObject({ provider: 'manual' });
  });
  it('falha com loja inexistente em vez de herdar Paysuite global', async () => {
    mocked.store = null;
    await expect(getPaymentConfig('loja-a', { method: 'emola' })).rejects.toThrow('store_payment_config_unavailable');
  });
  it('preserva o gateway herdado em lojas antigas sem override', async () => {
    mocked.store = { payment_provider: 'paysuite', emola_provider: null };
    expect(await getPaymentConfig('loja-a', { method: 'emola' })).toMatchObject({ provider: 'paysuite', apiKey: 'PLACEHOLDER_GLOBAL_KEY' });
  });
  it('método vazio não herda o caminho directo', async () => {
    expect(await getPaymentConfig('loja-a', { requireStore: true, method: '' })).toMatchObject({ provider: 'manual' });
  });
  it('não constrói um gateway real para manual ou provider desconhecido', () => {
    const base = { apiKey: 'PLACEHOLDER_KEY', webhookSecret: 'PLACEHOLDER_SECRET', mpesa: null };
    expect(() => buildProvider({ ...base, provider: 'manual' })).toThrow('payment_provider_unavailable');
    expect(() => buildProvider({ ...base, provider: 'desconhecido' } as unknown as PaymentConfig)).toThrow('payment_provider_unavailable');
    expect(() => buildProvider({ ...base, provider: 'paysuite', webhookSecret: '  ' })).toThrow('paysuite_not_configured');
  });
  it.each(['emola', 'emola_sim'])('%s ignora credenciais dos outros meios de pagamento', async (provider) => {
    mocked.store!.emola_provider = provider;
    const config = await getPaymentConfig('loja-a', { requireStore: true, method: 'emola' });
    expect(config).toEqual({ provider, apiKey: null, webhookSecret: null, mpesa: null });
    expect(isDirectFlow(config.provider)).toBe(true);
  });
  it('e-Mola real bloqueia a construção antes de qualquer operação externa', async () => {
    mocked.store!.emola_provider = 'emola';
    const config = await getPaymentConfig('loja-a', { requireStore: true, method: 'emola' });
    expect(() => buildProvider(config)).toThrow('emola_direct_contract_unavailable');
  });
  it('e-Mola simulado constrói provider directo sem credenciais de gateway', async () => {
    mocked.store = { payment_provider: 'mpesa', emola_provider: 'emola_sim' };
    const config = await getPaymentConfig('loja-a', { requireStore: true, method: 'emola' });
    const provider = buildProvider(config);
    expect(provider.flow).toBe('direct');
    expect(provider).toHaveProperty('charge');
  });
  it('e-Mola simulado fica bloqueado em produção', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const config: PaymentConfig = { provider: 'emola_sim', apiKey: null, webhookSecret: null, mpesa: null };
    expect(() => buildProvider(config)).toThrow('emola_sim_disabled_in_production');
    vi.stubEnv('NODE_ENV', 'development');
    expect(buildProvider(config).flow).toBe('direct');
  });
});
