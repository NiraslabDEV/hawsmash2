import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { DirectPaymentProvider } from '@delivery/payments';

const state = vi.hoisted(() => ({ confirm: vi.fn() }));
vi.mock('../confirm', () => ({ confirmOrderPaid: state.confirm }));
import { runDirectCharge } from '../direct';

const order = { id: '20000000-0000-4000-8000-000000000001', store_id: '10000000-0000-4000-8000-000000000001', total_cents: 12345, payment_method: 'emola' };
const charge = vi.fn();
const rpc = vi.fn();
const insert = vi.fn();
const from = vi.fn();
const update = vi.fn();
const eq = vi.fn();
const provider: DirectPaymentProvider = { flow: 'direct', charge, getPaymentStatus: vi.fn() };
const svc = { rpc, from } as unknown as SupabaseClient;
const run = () => runDirectCharge({ svc, provider, providerName: 'emola_sim', order, msisdn: '258871234567' });

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockImplementation(async (name: string) => ({ data: name === 'ensure_payment_reference' ? 'PLACEHOLDER_REFERENCE' : { status: 'payment_failed' }, error: null }));
  insert.mockResolvedValue({ error: null });
  const chain = { insert, update, eq, then: (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve) };
  from.mockReturnValue(chain); update.mockReturnValue(chain); eq.mockReturnValue(chain);
  charge.mockResolvedValue({ status: 'success', providerRef: 'PLACEHOLDER_PROVIDER_REF', code: 'SIM_SUCCESS', message: 'Simulação confirmada.' });
  state.confirm.mockResolvedValue({ ok: true });
});

describe('cobrança directa por método e loja', () => {
  it('confirma e-Mola com método gravado e valor inteiro do servidor', async () => {
    expect(await run()).toMatchObject({ status: 'paid' });
    expect(state.confirm).toHaveBeenCalledWith(expect.objectContaining({ method: 'emola', provider: 'emola_sim', amountCents: 12345 }));
    expect(charge).toHaveBeenCalledWith(expect.objectContaining({ amountCents: 12345, reference: 'PLACEHOLDER_REFERENCE', msisdn: '258871234567' }));
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ store_id: order.store_id, actor_user_id: null, order_id: order.id, payload: expect.objectContaining({ msisdn: '…4567', method: 'emola' }) }));
  });
  it('continua a confirmar M-Pesa com o seu próprio método', async () => {
    await runDirectCharge({ svc, provider, providerName: 'mpesa_sim', order: { ...order, payment_method: 'mpesa' }, msisdn: '258841234567' });
    expect(state.confirm).toHaveBeenCalledWith(expect.objectContaining({ method: 'mpesa' }));
  });
  it('guarda a referência do fornecedor na loja antes de uma consulta noutro processo', async () => {
    charge.mockResolvedValue({ status: 'pending', providerRef: 'SIM_EMOLA_PLACEHOLDER_REFERENCE', code: 'SIM_PENDING', message: 'Simulação pendente.' });
    expect(await run()).toMatchObject({ status: 'pending' });
    expect(update).toHaveBeenCalledWith({ payment_provider_ref: 'SIM_EMOLA_PLACEHOLDER_REFERENCE' });
    expect(eq).toHaveBeenCalledWith('id', order.id); expect(eq).toHaveBeenCalledWith('store_id', order.store_id);
    expect(eq).toHaveBeenCalledWith('payment_reference', 'PLACEHOLDER_REFERENCE');
  });
  it('falha a guardar referência do fornecedor não impede confirmar dinheiro recebido', async () => {
    update.mockImplementation(() => { throw new Error('PLACEHOLDER_DB'); });
    expect(await run()).toMatchObject({ status: 'paid' }); expect(state.confirm).toHaveBeenCalled();
  });
  it('recusa fornecedor de outro método antes de procurar referência ou cobrar', async () => {
    await expect(runDirectCharge({ svc, provider, providerName: 'mpesa_sim', order, msisdn: '258871234567' })).rejects.toThrow('direct_payment_method_mismatch');
    expect(rpc).not.toHaveBeenCalled(); expect(charge).not.toHaveBeenCalled();
  });
  it('sem referência não cobra', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'PLACEHOLDER_INTERNAL' } });
    expect(await run()).toMatchObject({ status: 'pending' }); expect(charge).not.toHaveBeenCalled();
  });
  it('erro de rede conserva pendência e referência, sem confirmar nem falhar a encomenda', async () => {
    charge.mockRejectedValue(new Error('PLACEHOLDER_SECRET'));
    const result = await run();
    expect(result).toMatchObject({ status: 'pending' }); expect(JSON.stringify(result)).not.toContain('PLACEHOLDER_SECRET');
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(['ensure_payment_reference']); expect(state.confirm).not.toHaveBeenCalled();
  });
  it('resposta pendente conserva a tentativa', async () => {
    charge.mockResolvedValue({ status: 'pending', providerRef: null, code: 'SIM_PENDING', message: 'Simulação pendente.' });
    expect(await run()).toMatchObject({ status: 'pending' });
    expect(rpc).toHaveBeenCalledTimes(1); expect(state.confirm).not.toHaveBeenCalled();
  });
  it('falha de auditoria não impede confirmar um pagamento recebido', async () => {
    insert.mockRejectedValue(new Error('PLACEHOLDER_LOG_FAILURE'));
    expect(await run()).toMatchObject({ status: 'paid' }); expect(state.confirm).toHaveBeenCalled();
  });
  it('falha de confirmação depois da cobrança mantém pendência', async () => {
    state.confirm.mockResolvedValue({ ok: false });
    expect(await run()).toMatchObject({ status: 'pending' });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it('falha definitiva passa pelo domínio e preserva referência para futuras consultas', async () => {
    charge.mockResolvedValue({ status: 'failed', providerRef: null, code: 'SIM_FAILED', message: 'Simulação recusada.' });
    expect(await run()).toMatchObject({ status: 'failed' });
    expect(rpc).toHaveBeenCalledWith('advance_order', expect.objectContaining({ p_order_id: order.id, p_event: 'PAYMENT_FAILED' }));
    expect(rpc).not.toHaveBeenCalledWith('ensure_payment_reference', expect.objectContaining({ p_rotate: true }));
    expect(from.mock.calls.every(([table]) => table === 'event_log')).toBe(true);
  });
  it.each([
    [{ data: null, error: { message: 'PLACEHOLDER_DB' } }, 'pending'],
    [{ data: null, error: null }, 'pending'],
    [{ data: { status: 'paid' }, error: null }, 'paid'],
    [{ data: { status: 'in_preparation' }, error: null }, 'paid'],
    [{ data: { status: 'cancelled' }, error: null }, 'cancelled'],
  ])('respeita a transição real da BD depois de uma resposta de falha: %j', async (transition, expected) => {
    charge.mockResolvedValue({ status: 'failed', providerRef: null, code: 'SIM_FAILED', message: 'Simulação recusada.' });
    rpc.mockImplementation(async (name: string) => name === 'ensure_payment_reference' ? { data: 'PLACEHOLDER_REFERENCE', error: null } : transition);
    expect(await run()).toMatchObject({ status: expected });
    expect(state.confirm).not.toHaveBeenCalled();
  });
});
