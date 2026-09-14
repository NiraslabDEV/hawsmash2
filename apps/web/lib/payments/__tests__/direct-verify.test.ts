import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ config: vi.fn(), build: vi.fn(), rpc: vi.fn(), from: vi.fn(), status: vi.fn(), confirm: vi.fn(), order: {} as Record<string, unknown> }));
vi.mock('../config', () => ({ getPaymentConfig: state.config, buildProvider: state.build, isDirectFlow: () => true }));
vi.mock('../direct', () => ({ serviceClient: () => ({ from: state.from, rpc: state.rpc }) }));
vi.mock('../confirm', () => ({ confirmOrderPaid: state.confirm }));
import { POST } from '@/app/api/payments/verify/route';

const orderId = '20000000-0000-4000-8000-000000000001';
const verify = () => POST(new Request('https://loja.example/api/payments/verify', { method: 'POST', body: JSON.stringify({ orderId }) }));
beforeEach(() => {
  vi.clearAllMocks();
  state.order = { id: orderId, store_id: '10000000-0000-4000-8000-000000000001', payment_method: 'emola', payment_reference: 'PLACEHOLDER_ATTEMPT', payment_provider_ref: 'SIM_EMOLA_PLACEHOLDER_REF', total_cents: 12345, status: 'awaiting_payment' };
  state.from.mockImplementation((table: string) => {
    const chain = { select: () => chain, eq: () => chain, single: async () => ({ data: state.order }), maybeSingle: async () => ({ data: table === 'stores' ? { slug: 'loja-a' } : state.order }) };
    return chain;
  });
  state.config.mockResolvedValue({ provider: 'emola_sim', apiKey: null, webhookSecret: null, mpesa: null });
  state.build.mockReturnValue({ flow: 'direct', charge: vi.fn(), getPaymentStatus: state.status });
  state.status.mockResolvedValue('success'); state.confirm.mockResolvedValue({ ok: true });
  state.rpc.mockResolvedValue({ data: { status: 'payment_failed' }, error: null });
});
describe('consulta da mesma tentativa de e-Mola directo simulado', () => {
  it('usa a referência persistida do simulador e confirma e-Mola', async () => {
    expect(await (await verify()).json()).toMatchObject({ status: 'paid' });
    expect(state.status).toHaveBeenCalledWith('SIM_EMOLA_PLACEHOLDER_REF');
    expect(state.confirm).toHaveBeenCalledWith(expect.objectContaining({ method: 'emola', provider: 'emola_sim', amountCents: 12345 }));
  });
  it('preserva referência numa falha definitiva para não perder a consulta em retries', async () => {
    state.status.mockResolvedValue('failed');
    expect(await (await verify()).json()).toMatchObject({ status: 'failed' });
    expect(state.rpc.mock.calls.map(([name]) => name)).toEqual(['advance_order']);
  });
  it('sem referência persistida continua pendente e não confirma uma tentativa desconhecida', async () => {
    state.order.payment_provider_ref = null;
    expect(await (await verify()).json()).toMatchObject({ status: 'awaiting_payment' });
    expect(state.status).not.toHaveBeenCalled(); expect(state.confirm).not.toHaveBeenCalled();
  });
});
