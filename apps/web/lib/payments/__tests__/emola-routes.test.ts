import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MockProvider } from '@delivery/payments';
import { orderToReference } from '../reference';

const state = vi.hoisted(() => ({
  config: vi.fn(), build: vi.fn(), direct: vi.fn(), confirm: vi.fn(), rpc: vi.fn(), from: vi.fn(),
  order: {} as Record<string, unknown>, store: { slug: 'loja-a' } as { slug: string } | null,
  checkout: vi.fn(), status: vi.fn(), writes: [] as { table: string; value: unknown }[],
}));
vi.mock('../config', () => ({ getPaymentConfig: state.config, buildProvider: state.build, isDirectFlow: (name: string) => ['mpesa', 'mpesa_sim', 'emola', 'emola_sim'].includes(name) }));
vi.mock('../direct', () => ({ serviceClient: () => ({ from: state.from, rpc: state.rpc }), runDirectCharge: state.direct }));
vi.mock('../confirm', () => ({ confirmOrderPaid: state.confirm }));
vi.mock('@/utils/supabase/server', () => ({ createClient: async () => ({ from: state.from, rpc: state.rpc }) }));

import { POST as checkout } from '@/app/api/payments/route';
import { POST as verify } from '@/app/api/payments/verify/route';
import { POST as webhook } from '@/app/api/webhooks/paysuite/route';

const orderId = '20000000-0000-4000-8000-000000000001';
const storeId = '10000000-0000-4000-8000-000000000001';
const clientCheckoutId = '30000000-0000-4000-8000-000000000001';
const mock = new MockProvider();
const request = (body: unknown, path = '/api/payments') => new Request(`https://loja.example${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clientCheckoutId, ...body as Record<string, unknown> }) });
function signedWebhook(overrides: Record<string, unknown> = {}, signature?: string) {
  const payload = mock.buildWebhookPayload(orderToReference(orderId), 'success', 12345, 'emola');
  payload.data.id = 'PLACEHOLDER_PROVIDER_ID';
  const raw = JSON.stringify({ ...payload, ...overrides });
  return new Request('https://loja.example/api/webhooks/paysuite', { method: 'POST', headers: { 'x-webhook-signature': signature ?? mock.signBody(raw) }, body: raw });
}

beforeEach(() => {
  vi.clearAllMocks(); state.writes = []; state.store = { slug: 'loja-a' };
  state.order = { id: orderId, store_id: storeId, status: 'awaiting_payment', total_cents: 12345,
    payment_method: 'emola', payment_provider_ref: 'PLACEHOLDER_PROVIDER_ID', payment_reference: null,
    checkout_started_at: '2026-09-14T00:00:00Z', checkout_url: null, order_number: 'PLACEHOLDER_ORDER', customer_email: null, customer_name: null, stores: { slug: 'loja-a' } };
  state.rpc.mockImplementation(async (name: string) => ({ data: name === 'claim_online_checkout' ? { claimed: true, checkoutUrl: null } : orderId, error: null }));
  state.from.mockImplementation((table: string) => {
    const chain: Record<string, unknown> = {};
    for (const name of ['select', 'eq', 'in', 'is']) chain[name] = vi.fn(() => chain);
    chain.update = vi.fn((value: unknown) => { state.writes.push({ table, value }); if (table === 'orders') Object.assign(state.order, value); return chain; });
    chain.insert = vi.fn((value: unknown) => { state.writes.push({ table, value }); return chain; });
    const response = () => ({ data: table === 'orders' ? state.order : state.store, error: null });
    chain.single = vi.fn(async () => response()); chain.maybeSingle = vi.fn(async () => response());
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(response()).then(resolve);
    return chain;
  });
  state.config.mockImplementation(async (_slug: string, options?: { method?: string }) => ({
    provider: options?.method === 'emola' ? 'mock' : 'mpesa_sim', apiKey: null, webhookSecret: null, mpesa: null,
  }));
  state.checkout.mockResolvedValue({ checkoutUrl: `https://loja.example/payment/return/${orderId}`, providerPaymentId: 'PLACEHOLDER_PROVIDER_ID' });
  state.status.mockResolvedValue('success');
  state.build.mockImplementation((cfg: { provider: string }) => cfg.provider === 'mock'
    ? { flow: 'redirect', createCheckout: state.checkout, getPaymentStatus: state.status,
      parseWebhook: mock.parseWebhook.bind(mock), verifyWebhookSignature: mock.verifyWebhookSignature.bind(mock) }
    : { flow: 'direct', charge: vi.fn(), getPaymentStatus: state.status });
  state.direct.mockResolvedValue({ status: 'paid', message: 'Pago.' });
  state.confirm.mockResolvedValue({ ok: true, result: 'ok', error: null });
});

describe('e-Mola online ao lado de M-Pesa directo', () => {
  it('encaminha e-Mola sem pedir nem normalizar um número M-Pesa e usa o preço da BD', async () => {
    const response = await checkout(request({ storeSlug: 'loja-a', paymentMethod: 'emola', total_cents: 1 }));
    expect(response.status).toBe(200);
    expect(state.config).toHaveBeenCalledWith('loja-a', expect.objectContaining({ requireStore: true, method: 'emola' }));
    expect(state.checkout).toHaveBeenCalledWith(expect.objectContaining({ method: 'emola', amountCents: 12345, idempotencyKey: orderToReference(orderId) }));
    expect(state.direct).not.toHaveBeenCalled();
  });
  it('mantém M-Pesa no fluxo directo', async () => {
    state.order.payment_method = 'mpesa';
    expect((await checkout(request({ storeSlug: 'loja-a', paymentMethod: 'mpesa', msisdn: '841234567' }))).status).toBe(200);
    expect(state.direct).toHaveBeenCalled(); expect(state.checkout).not.toHaveBeenCalled();
  });
  it('recusa método inválido e loja inválida antes de criar pedido', async () => {
    expect((await checkout(request({ storeSlug: 'loja-a', paymentMethod: 'cash' }))).status).toBe(400);
    expect((await checkout(request({ storeSlug: '../outra', paymentMethod: 'emola' }))).status).toBe(400);
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it('sem configuração de e-Mola não cria pedido nem tenta cobrar', async () => {
    state.config.mockRejectedValue(new Error('PLACEHOLDER_SECRET'));
    const response = await checkout(request({ storeSlug: 'loja-a', paymentMethod: 'emola' }));
    expect(response.status).toBe(503); expect(await response.text()).not.toContain('PLACEHOLDER_SECRET');
    expect(state.rpc).not.toHaveBeenCalled(); expect(state.checkout).not.toHaveBeenCalled();
  });
  it('verifica o método gravado na encomenda, ignorando um método recebido no body', async () => {
    const response = await verify(request({ orderId, paymentMethod: 'mpesa' }));
    expect(await response.json()).toMatchObject({ status: 'paid' });
    expect(state.config).toHaveBeenCalledWith('loja-a', expect.objectContaining({ requireStore: true, method: 'emola' }));
    expect(state.status).toHaveBeenCalledWith('PLACEHOLDER_PROVIDER_ID');
    expect(state.confirm).toHaveBeenCalledWith(expect.objectContaining({ method: 'emola', provider: 'mock', amountCents: 12345 }));
  });
  it('sem loja válida na verificação não cai na conta global', async () => {
    state.store = null;
    expect(await (await verify(request({ orderId }))).json()).toMatchObject({ status: 'pending' });
    expect(state.config).not.toHaveBeenCalled(); expect(state.confirm).not.toHaveBeenCalled();
  });
  it('webhook resolve loja/método do pedido e confirma sem cookie de sessão', async () => {
    const response = await webhook(signedWebhook());
    expect(response.status).toBe(200);
    expect(state.config).toHaveBeenCalledWith('loja-a', expect.objectContaining({ requireStore: true, method: 'emola' }));
    expect(state.confirm).toHaveBeenCalledWith(expect.objectContaining({ orderId, method: 'emola', provider: 'mock', amountCents: 12345 }));
  });
  it('assinatura de outra conta não confirma', async () => {
    expect((await webhook(signedWebhook({}, 'assinatura-de-outra-loja'))).status).toBe(401);
    expect(state.confirm).not.toHaveBeenCalled(); expect(state.writes).toHaveLength(0);
  });
  it.each(['method', 'amount', 'reference'])('recusa webhook assinado que não corresponde ao pedido: %s', async (field) => {
    if (field === 'method') state.order.payment_method = 'mpesa';
    if (field === 'amount') state.order.total_cents = 99999;
    if (field === 'reference') state.order.payment_provider_ref = 'PLACEHOLDER_OTHER_PAYMENT';
    state.config.mockResolvedValue({ provider: 'mock', apiKey: null, webhookSecret: null, mpesa: null });
    expect((await webhook(signedWebhook())).status).toBe(409);
    expect(state.confirm).not.toHaveBeenCalled(); expect(state.writes).toHaveLength(0);
  });
  it('falha de gravação pede retry do webhook e não devolve falso sucesso', async () => {
    state.confirm.mockResolvedValue({ ok: false, result: null, error: 'PLACEHOLDER_INTERNAL' });
    const response = await webhook(signedWebhook());
    expect(response.status).toBe(503); expect(await response.text()).not.toContain('PLACEHOLDER_INTERNAL');
  });
  it('resposta de checkout perdida mantém a encomenda pendente, sem cancelar nem criar outra', async () => {
    state.checkout.mockRejectedValue(new Error('PLACEHOLDER_TIMEOUT'));
    const response = await checkout(request({ storeSlug: 'loja-a', paymentMethod: 'emola' }));
    expect(await response.json()).toMatchObject({ orderId, status: 'pending' });
    expect(state.rpc.mock.calls.map(([name]) => name)).toEqual(['create_order', 'claim_online_checkout']);
  });
  it('callback assinado recupera a referência perdida de uma tentativa iniciada', async () => {
    state.order.payment_provider_ref = null;
    expect((await webhook(signedWebhook())).status).toBe(200);
    expect(state.writes).toEqual([{ table: 'orders', value: { payment_provider_ref: 'PLACEHOLDER_PROVIDER_ID' } }]);
    expect(state.confirm).toHaveBeenCalled();
  });
  it('callback não cria uma tentativa que o servidor nunca iniciou', async () => {
    state.order.payment_provider_ref = null; state.order.checkout_started_at = null;
    expect((await webhook(signedWebhook())).status).toBe(503);
    expect(state.writes).toHaveLength(0); expect(state.confirm).not.toHaveBeenCalled();
  });
  it('callback desconhecido ou malformado não muda pagamentos', async () => {
    expect((await webhook(signedWebhook({ event: 'payment.pending' }))).status).toBe(400);
    expect((await webhook(request({ data: { reference: 'invalid' } }))).status).toBe(400);
    expect(state.confirm).not.toHaveBeenCalled(); expect(state.writes).toHaveLength(0);
  });
  it('falha assinada passa pela transição de domínio e não faz UPDATE directo', async () => {
    const payload = mock.buildWebhookPayload(orderToReference(orderId), 'failed', 12345, 'emola', 'PLACEHOLDER_PROVIDER_ID');
    expect((await webhook(signedWebhook(payload))).status).toBe(200);
    expect(state.rpc).toHaveBeenCalledWith('advance_order', expect.objectContaining({ p_order_id: orderId, p_event: 'PAYMENT_FAILED' }));
    expect(state.writes).toHaveLength(0); expect(state.confirm).not.toHaveBeenCalled();
  });
  it('falha definitiva na verificação também passa pelo domínio', async () => {
    state.status.mockResolvedValue('failed');
    expect(await (await verify(request({ orderId }))).json()).toMatchObject({ status: 'failed' });
    expect(state.rpc).toHaveBeenCalledWith('advance_order', expect.objectContaining({ p_order_id: orderId, p_event: 'PAYMENT_FAILED' }));
    expect(state.writes).toHaveLength(0);
  });
  it('verificação de encomenda cancelada não tenta confirmar nem cobrar', async () => {
    state.order.status = 'cancelled';
    expect(await (await verify(request({ orderId }))).json()).toMatchObject({ status: 'cancelled' });
    expect(state.status).not.toHaveBeenCalled(); expect(state.confirm).not.toHaveBeenCalled();
  });
  it('exige identificador estável antes de criar a encomenda', async () => {
    expect((await checkout(request({ storeSlug: 'loja-a', paymentMethod: 'emola', clientCheckoutId: null }))).status).toBe(400);
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it('uma repetição recupera o checkout existente sem voltar a chamar o fornecedor', async () => {
    state.rpc.mockImplementation(async (name: string) => ({ data: name === 'claim_online_checkout' ? { claimed: false, checkoutUrl: 'https://gateway.example/PLACEHOLDER_CHECKOUT' } : orderId, error: null }));
    const response = await checkout(request({ storeSlug: 'loja-a', paymentMethod: 'emola' }));
    expect(await response.json()).toMatchObject({ orderId, checkoutUrl: 'https://gateway.example/PLACEHOLDER_CHECKOUT' });
    expect(state.checkout).not.toHaveBeenCalled(); expect(state.direct).not.toHaveBeenCalled();
  });
  it('duas submissões com a mesma chave só iniciam um checkout, mesmo antes de guardar o ID', async () => {
    let claims = 0;
    state.rpc.mockImplementation(async (name: string) => ({ data: name === 'claim_online_checkout' ? { claimed: ++claims === 1, checkoutUrl: null } : orderId, error: null }));
    const responses = await Promise.all([checkout(request({ storeSlug: 'loja-a', paymentMethod: 'emola' })), checkout(request({ storeSlug: 'loja-a', paymentMethod: 'emola' }))]);
    expect(state.checkout).toHaveBeenCalledTimes(1);
    expect(await Promise.all(responses.map((response) => response.json()))).toEqual(expect.arrayContaining([expect.objectContaining({ orderId, status: 'pending' })]));
  });
});

describe('e-Mola directo preparado sem contrato real', () => {
  beforeEach(() => {
    state.config.mockResolvedValue({ provider: 'emola_sim', apiKey: null, webhookSecret: null, mpesa: null });
  });
  it.each(['860000000', '870000000'])('usa o normalizador e-Mola para %s e conserva método/loja no domínio', async (phone) => {
    const response = await checkout(request({ storeSlug: 'loja-a', paymentMethod: 'emola', msisdn: phone }));
    expect(response.status).toBe(200);
    expect(state.direct).toHaveBeenCalledWith(expect.objectContaining({
      providerName: 'emola_sim', msisdn: `258${phone}`,
      order: expect.objectContaining({ id: orderId, payment_method: 'emola', store_id: storeId, total_cents: 12345 }),
    }));
    expect(state.checkout).not.toHaveBeenCalled();
  });
  it.each(['700000000', ''])('recusa telefone e-Mola inválido antes de criar pedido: %s', async (phone) => {
    const response = await checkout(request({ storeSlug: 'loja-a', paymentMethod: 'emola', msisdn: phone }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'invalid_msisdn' });
    expect(state.rpc).not.toHaveBeenCalled(); expect(state.direct).not.toHaveBeenCalled();
  });
  it('o modo real indisponível devolve comprovativo antes de criar ou cobrar', async () => {
    state.config.mockResolvedValue({ provider: 'emola', apiKey: null, webhookSecret: null, mpesa: null });
    state.build.mockImplementation(() => { throw new Error('emola_direct_contract_unavailable'); });
    const response = await checkout(request({ storeSlug: 'loja-a', paymentMethod: 'emola', msisdn: '870000000' }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ status: 'unavailable' });
    expect(state.rpc).not.toHaveBeenCalled(); expect(state.direct).not.toHaveBeenCalled(); expect(state.checkout).not.toHaveBeenCalled();
  });
  it('uma resposta incerta conserva o pedido sem redireccionar nem fazer outra tentativa', async () => {
    state.direct.mockResolvedValue({ status: 'pending', message: 'Simulação pendente.' });
    const response = await checkout(request({ storeSlug: 'loja-a', paymentMethod: 'emola', msisdn: '870000000' }));
    expect(await response.json()).toMatchObject({ orderId, status: 'pending' });
    expect(state.direct).toHaveBeenCalledTimes(1); expect(state.checkout).not.toHaveBeenCalled();
  });
  it('duas submissões com a mesma chave só iniciam uma operação directa', async () => {
    let claims = 0;
    state.rpc.mockImplementation(async (name: string) => ({ data: name === 'claim_online_checkout' ? { claimed: ++claims === 1, checkoutUrl: null } : orderId, error: null }));
    await Promise.all([1, 2].map(() => checkout(request({ storeSlug: 'loja-a', paymentMethod: 'emola', msisdn: '870000000' }))));
    expect(state.direct).toHaveBeenCalledTimes(1); expect(state.checkout).not.toHaveBeenCalled();
  });
  it('a verificação simulada usa o identificador persistido e conserva e-Mola', async () => {
    state.order.payment_reference = 'PLACEHOLDER_EMOLA_REFERENCE';
    expect(await (await verify(request({ orderId }))).json()).toMatchObject({ status: 'paid' });
    expect(state.status).toHaveBeenCalledWith('PLACEHOLDER_PROVIDER_ID');
    expect(state.confirm).toHaveBeenCalledWith(expect.objectContaining({ method: 'emola', provider: 'emola_sim', amountCents: 12345 }));
  });
});
