import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PaymentProvider } from '@delivery/payments';
import {
  createReconciliationRepository, decodeReconciliationCursor, handleReconciliationRequest,
  runPaymentReconciliation, type ReconciliationDependencies, type ReconciliationOrder,
} from '../reconcile';

const storeA = '10000000-0000-4000-8000-000000000001';
const storeB = '10000000-0000-4000-8000-000000000002';
const order = (suffix: number, storeId = storeA): ReconciliationOrder => ({
  id: `20000000-0000-4000-8000-${suffix.toString().padStart(12, '0')}`, store_id: storeId,
  storeSlug: storeId === storeA ? 'loja-a' : 'loja-b', total_cents: 30000,
  payment_reference: `PLACEHOLDER_REFERENCE_${suffix}`, payment_provider_ref: `PLACEHOLDER_PROVIDER_${suffix}`,
  payment_method: 'mpesa', created_at: '2026-09-10T10:00:00.000Z',
});
const config = (provider = 'mpesa') => ({ provider, apiKey: null, webhookSecret: null, mpesa: null });
const directProvider = (getPaymentStatus: NonNullable<PaymentProvider['getPaymentStatus']> = vi.fn(async () => 'pending' as const)): PaymentProvider => ({ flow: 'direct', charge: vi.fn(), getPaymentStatus });
function setup(orders: ReconciliationOrder[]) {
  const listPage = vi.fn(async ({ after, limit }: { after?: { id: string }; limit: number }) => orders.filter((entry) => !after || entry.id > after.id).slice(0, limit));
  const configForStore = vi.fn(async (_slug: string) => config());
  const getPaymentStatus = vi.fn(async () => 'pending' as const);
  const build = vi.fn(() => directProvider(getPaymentStatus));
  const confirm = vi.fn(async () => ({ ok: true, result: 'ok', error: null }));
  const deps = { listPage, configForStore, buildProvider: build, confirm } as unknown as ReconciliationDependencies;
  return { deps, listPage, configForStore, getPaymentStatus, build, confirm };
}

describe('reconciliação limitada por loja', () => {
  it('na mesma loja distingue M-Pesa directo e e-Mola, incluindo o cache de fornecedores', async () => {
    const state = setup([order(1), { ...order(2), payment_method: 'emola' }, { ...order(3), payment_method: 'emola' }]);
    state.configForStore.mockImplementation(async (...args: unknown[]) => config(args[2] === 'emola' ? 'paysuite' : 'mpesa'));
    const mpesa = vi.fn(async () => 'success' as const);
    const emola = vi.fn(async () => 'success' as const);
    state.build.mockImplementation((...args: unknown[]) => (args[0] as { provider: string }).provider === 'mpesa'
      ? directProvider(mpesa)
      : { flow: 'redirect', createCheckout: vi.fn(), parseWebhook: vi.fn(), verifyWebhookSignature: vi.fn(), getPaymentStatus: emola });
    const result = await runPaymentReconciliation(state.deps);
    expect(result.confirmed).toBe(3); expect(mpesa).toHaveBeenCalledTimes(1); expect(emola).toHaveBeenCalledTimes(2);
    expect(state.configForStore).toHaveBeenCalledTimes(2);
    expect(state.configForStore).toHaveBeenCalledWith('loja-a', expect.any(AbortSignal), 'emola');
    expect(state.confirm).toHaveBeenCalledWith(expect.objectContaining({ orderId: order(2).id, provider: 'paysuite', method: 'emola', providerRef: order(2).payment_provider_ref }), expect.any(AbortSignal));
  });
  it('usa a configuração de cada loja mesmo se a configuração global for manual', async () => {
    const state = setup([order(1), order(2, storeB)]);
    state.configForStore.mockImplementation(async (slug) => config(slug === 'loja-a' ? 'mpesa' : slug === 'loja-b' ? 'paysuite' : 'manual'));
    const mpesa = vi.fn(async (_reference: string) => 'success' as const);
    const paysuite = vi.fn(async (_reference: string) => 'pending' as const);
    state.build.mockImplementation((...args: unknown[]) => (args[0] as { provider: string }).provider === 'mpesa'
      ? directProvider(mpesa)
      : { flow: 'redirect', createCheckout: vi.fn(), parseWebhook: vi.fn(), verifyWebhookSignature: vi.fn(), getPaymentStatus: paysuite });
    const result = await runPaymentReconciliation(state.deps, { pageSize: 1 });
    expect(state.configForStore.mock.calls.map(([slug]) => slug)).toEqual(['loja-a', 'loja-b']);
    expect(mpesa.mock.calls[0][0]).toBe(order(1).payment_reference);
    expect(paysuite.mock.calls[0][0]).toBe(order(2).payment_provider_ref);
    expect(state.confirm).toHaveBeenCalledWith(expect.objectContaining({ orderId: order(1).id, provider: 'mpesa', amountCents: 30000 }), expect.any(AbortSignal));
    expect(result).toMatchObject({ completed: true, examined: 2, confirmed: 1, pending: 1 });
  });
  it('pagina por cursor estável, sem saltar o pedido seguinte quando uma confirmação o retira da fila', async () => {
    const all = [order(1), order(2), order(3), order(4), order(5)];
    const state = setup(all);
    state.listPage.mockImplementation(async ({ after, limit }) => all.filter((entry) => !after || entry.id > after.id).slice(0, limit));
    state.getPaymentStatus.mockResolvedValue('success' as never);
    state.confirm.mockImplementation(async (...args: unknown[]) => { const id = (args[0] as { orderId: string }).orderId; all.splice(all.findIndex((entry) => entry.id === id), 1); return { ok: true, result: 'ok', error: null }; });
    const result = await runPaymentReconciliation(state.deps, { pageSize: 2 });
    expect(result).toMatchObject({ examined: 5, confirmed: 5, completed: true });
    expect(state.confirm).toHaveBeenCalledTimes(5);
    expect(state.configForStore).toHaveBeenCalledTimes(1);
    expect(state.listPage.mock.calls[1][0]).toMatchObject({ after: { id: order(2).id, createdAt: order(2).created_at } });
  });
  it('a resposta de falha do gateway não muda estado, não roda referência e não confirma', async () => {
    const state = setup([order(1)]); state.getPaymentStatus.mockResolvedValue('failed' as never);
    expect(await runPaymentReconciliation(state.deps)).toMatchObject({ providerFailed: 1, confirmed: 0 });
    expect(state.confirm).not.toHaveBeenCalled();
  });
  it('limita concorrência e aguarda todas as consultas antes de terminar', async () => {
    const state = setup([order(1), order(2), order(3), order(4)]);
    let active = 0; let max = 0; const done: (() => void)[] = [];
    state.getPaymentStatus.mockImplementation(async () => { active++; max = Math.max(active, max); await new Promise<void>((resolve) => done.push(resolve)); active--; return 'pending'; });
    let settled = false;
    const work = runPaymentReconciliation(state.deps, { concurrency: 2 }).then((result) => { settled = true; return result; });
    await vi.waitFor(() => expect(done).toHaveLength(2));
    expect(settled).toBe(false); done.splice(0).forEach((resolve) => resolve());
    await vi.waitFor(() => expect(done).toHaveLength(2));
    expect(settled).toBe(false); done.splice(0).forEach((resolve) => resolve());
    await work; expect(active).toBe(0); expect(max).toBe(2);
  });
  it('interrompe consultas pelo signal no prazo, aguarda o fim e deixa pendentes', async () => {
    const state = setup([order(1), order(2), order(3)]);
    let active = 0;
    state.getPaymentStatus.mockImplementation(async (...args: unknown[]) => {
      const signal = (args[1] as { signal: AbortSignal }).signal; active++;
      await new Promise<void>((resolve) => signal.aborted ? resolve() : signal.addEventListener('abort', () => resolve(), { once: true }));
      active--; return 'pending';
    });
    const result = await runPaymentReconciliation(state.deps, { concurrency: 2, runBudgetMs: 25, statusTimeoutMs: 100 });
    expect(result).toMatchObject({ completed: false, reason: 'budget_exhausted', examined: 2 });
    expect(active).toBe(0); expect(state.confirm).not.toHaveBeenCalled(); expect(result.nextCursor).toBeTruthy();
  });
  it('devolve cursor de continuação quando chega ao limite e retoma o que faltava', async () => {
    const state = setup([order(1), order(2), order(3)]);
    const first = await runPaymentReconciliation(state.deps, { maxOrders: 2, pageSize: 2 });
    expect(first).toMatchObject({ completed: false, examined: 2, reason: 'limit_reached' });
    const second = await runPaymentReconciliation(state.deps, { cursor: first.nextCursor! });
    expect(second).toMatchObject({ completed: true, examined: 1 });
    expect(() => decodeReconciliationCursor('não-é-cursor')).toThrow();
  });
  it('resume falhas sem expor erros brutos, referências, dados pessoais ou chaves', async () => {
    const state = setup([order(1)]); state.getPaymentStatus.mockRejectedValue(new Error('SEGREDO_DO_PROVIDER telefone'));
    const result = await runPaymentReconciliation(state.deps);
    expect(result).toMatchObject({ errors: 1 });
    expect(JSON.stringify(result)).not.toMatch(/SEGREDO|PLACEHOLDER_REFERENCE|PLACEHOLDER_PROVIDER|telefone/);
  });
  it('não confirma uma resposta tardia depois do prazo', async () => {
    const state = setup([order(1)]);
    state.getPaymentStatus.mockImplementation(async (...args: unknown[]) => { const signal = (args[1] as { signal: AbortSignal }).signal; await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true })); return 'success' as never; });
    expect(await runPaymentReconciliation(state.deps, { statusTimeoutMs: 10 })).toMatchObject({ pending: 1, confirmed: 0 });
    expect(state.confirm).not.toHaveBeenCalled();
  });
});

describe('repositório de reconciliação', () => {
  it('selecciona a loja e usa ordenação e cursor explícitos, sem offset nem limite implícito', async () => {
    const chain: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const name of ['select', 'in', 'lt', 'order', 'limit', 'or', 'abortSignal']) chain[name] = vi.fn(() => chain);
    chain.then = vi.fn((resolve) => resolve({ data: [{ ...order(1), stores: { slug: 'loja-a' } }], error: null }));
    const from = vi.fn(() => chain);
    const repository = createReconciliationRepository({ from } as unknown as SupabaseClient);
    const data = await repository({ cutoff: '2026-09-14T00:00:00.000Z', after: { id: order(1).id, createdAt: order(1).created_at }, limit: 50, signal: new AbortController().signal });
    expect(data[0]).toMatchObject({ store_id: storeA, storeSlug: 'loja-a' });
    expect(chain.select.mock.calls[0][0]).toContain('store_id');
    expect(chain.order.mock.calls).toEqual([['created_at', { ascending: true }], ['id', { ascending: true }]]);
    expect(chain.limit).toHaveBeenCalledWith(50);
    expect(chain.or.mock.calls[0][0]).toContain(`id.gt.${order(1).id}`);
  });
});

describe('porta HTTP do cron', () => {
  it('fecha por omissão e não toca em providers quando falta o segredo ou o bearer é errado', async () => {
    const run = vi.fn();
    expect((await handleReconciliationRequest(new Request('https://example.test/api/cron/reconcile'), { secret: '', run })).status).toBe(503);
    expect((await handleReconciliationRequest(new Request('https://example.test/api/cron/reconcile'), { secret: 'PLACEHOLDER_CRON_SECRET', run })).status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });
  it('autoriza bearer certo, valida cursor e devolve resultado sem cache', async () => {
    const run = vi.fn(async () => ({ ok: true }));
    const headers = { authorization: 'Bearer PLACEHOLDER_CRON_SECRET' };
    const response = await handleReconciliationRequest(new Request('https://example.test/api/cron/reconcile', { headers }), { secret: 'PLACEHOLDER_CRON_SECRET', run });
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toContain('no-store'); expect(run).toHaveBeenCalledTimes(1);
    const invalid = await handleReconciliationRequest(new Request('https://example.test/api/cron/reconcile?cursor=invalid', { headers }), { secret: 'PLACEHOLDER_CRON_SECRET', run });
    expect(invalid.status).toBe(400); expect(run).toHaveBeenCalledTimes(1);
  });
});
