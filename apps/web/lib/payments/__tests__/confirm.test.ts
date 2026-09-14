import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const state = vi.hoisted(() => ({ conversions: vi.fn() }));
vi.mock('@/lib/server-analytics/conversions', () => ({ fireConversions: state.conversions }));
import { confirmOrderPaid } from '../confirm';

const rpc = vi.fn();
const from = vi.fn();
const select = vi.fn();
const eq = vi.fn();
const maybeSingle = vi.fn();
const fetchMock = vi.fn();
const orderId = '20000000-0000-4000-8000-000000000001';
const storeId = '10000000-0000-4000-8000-000000000001';
const svc = { rpc, from } as unknown as SupabaseClient;
const input = {
  svc, orderId, storeId, provider: 'emola_sim', providerRef: 'PLACEHOLDER_REF', method: 'emola',
  amountCents: 12345, source: 'test', origin: 'https://store.example',
  customer: { email: 'PLACEHOLDER_CLIENT@example.test', name: 'PLACEHOLDER_CLIENT' },
};
const paid = { status: 'paid', payment_method: 'emola', total_cents: 12345 };

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockResolvedValue({ data: 'ok', error: null });
  const chain = { select, eq, maybeSingle };
  from.mockReturnValue(chain); select.mockReturnValue(chain); eq.mockReturnValue(chain);
  maybeSingle.mockResolvedValue({ data: paid, error: null });
  state.conversions.mockResolvedValue(undefined);
  fetchMock.mockResolvedValue({ ok: true });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('confirmação comum só aceita pagamento verificado', () => {
  it('primeira confirmação válida envia efeitos uma vez', async () => {
    expect(await confirmOrderPaid(input)).toEqual({ ok: true, result: 'ok', error: null });
    expect(state.conversions).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(from).not.toHaveBeenCalled();
  });
  it.each(['invalid_state', 'amount_mismatch', 'order_not_found', null, 'PLACEHOLDER_UNKNOWN_RESULT'])('resultado %s não anuncia pedido pago', async (result) => {
    rpc.mockResolvedValue({ data: result, error: null });
    const outcome = await confirmOrderPaid(input);
    expect(outcome.ok).toBe(false);
    expect(state.conversions).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(['paid', 'in_preparation', 'ready', 'delivered'])('duplicate só aceita estado canónico %s com valor/método iguais', async (status) => {
    rpc.mockResolvedValue({ data: 'duplicate', error: null });
    maybeSingle.mockResolvedValue({ data: { ...paid, status }, error: null });
    expect(await confirmOrderPaid(input)).toEqual({ ok: true, result: 'duplicate', error: null });
    expect(from).toHaveBeenCalledWith('orders');
    expect(eq).toHaveBeenCalledWith('id', orderId);
    expect(eq).toHaveBeenCalledWith('store_id', storeId);
    expect(state.conversions).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([
    { status: 'cancelled' }, { status: 'awaiting_payment' }, { status: 'payment_failed' },
    { total_cents: 12346 }, { payment_method: 'mpesa' },
  ])('duplicate recusa divergência canónica %j', async (patch) => {
    rpc.mockResolvedValue({ data: 'duplicate', error: null });
    maybeSingle.mockResolvedValue({ data: { ...paid, ...patch }, error: null });
    expect((await confirmOrderPaid(input)).ok).toBe(false);
    expect(state.conversions).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('duplicate sem ordem legível não confirma', async () => {
    rpc.mockResolvedValue({ data: 'duplicate', error: null });
    maybeSingle.mockResolvedValue({ data: null, error: null });
    expect((await confirmOrderPaid(input)).ok).toBe(false);
  });
  it('erros de consulta não viram confirmação nem expõem detalhes internos', async () => {
    rpc.mockResolvedValue({ data: 'duplicate', error: null });
    maybeSingle.mockResolvedValue({ data: paid, error: { message: 'PLACEHOLDER_SECRET_ERROR' } });
    const outcome = await confirmOrderPaid(input);
    expect(outcome.ok).toBe(false);
    expect(JSON.stringify(outcome)).not.toContain('PLACEHOLDER_SECRET_ERROR');
  });
  it('excepção na consulta mantém resultado por confirmar', async () => {
    rpc.mockResolvedValue({ data: 'duplicate', error: null });
    maybeSingle.mockRejectedValue(new Error('PLACEHOLDER_NETWORK_ERROR'));
    await expect(confirmOrderPaid(input)).resolves.toMatchObject({ ok: false });
  });
  it('excepção na RPC mantém resultado por confirmar', async () => {
    rpc.mockRejectedValue(new Error('PLACEHOLDER_NETWORK_ERROR'));
    await expect(confirmOrderPaid(input)).resolves.toMatchObject({ ok: false });
  });
});
