import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PaysuiteProvider } from '../paysuite-provider';
import { MockProvider } from '../mock-provider';

const secret = 'PLACEHOLDER_WEBHOOK_SECRET';
const provider = new PaysuiteProvider('PLACEHOLDER_API_KEY', secret);
const webhook = (amount: unknown = '125.50', method: unknown = 'emola') => ({
  event: 'payment.success',
  data: { id: 'PLACEHOLDER_PAYMENT_ID', reference: 'PLACEHOLDER_ORDER_ID', amount, transaction: { method } },
});

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('webhook Paysuite e-Mola', () => {
  it.each(['125.50', '125.5', 125.5, 125])('converte %s sem arredondar centavos', (amount) => {
    const result = provider.parseWebhook(webhook(amount));
    expect(result).toEqual({ event: 'success', requestId: 'PLACEHOLDER_ORDER_ID', providerRef: 'PLACEHOLDER_PAYMENT_ID', amountCents: amount === 125 ? 12500 : 12550, method: 'emola' });
  });

  it('preserva todos os centavos no limite de inteiro seguro recebido em texto', () => {
    expect(provider.parseWebhook(webhook('90071992547409.91')).amountCents).toBe(Number.MAX_SAFE_INTEGER);
  });

  it.each(['0', '-1.00', '1.001', '1e2', '1,00', ' 1.00', '1.00 ', '01.00', '', null, true, {}, Infinity, NaN, '90071992547409.92'])('rejeita montante inválido %s', (amount) => {
    expect(() => provider.parseWebhook(webhook(amount))).toThrow();
  });

  it.each(['payment.pending', 'payment.processing', 'payment.cancelled', 'unknown', ''])('não transforma %s em falha definitiva', (event) => {
    expect(() => provider.parseWebhook({ ...webhook(), event })).toThrow();
  });

  it.each([undefined, 'cash', 'e-mola', 'MPESA', '', null])('recusa sucesso sem método válido (%s)', (method) => {
    const payload = webhook(); payload.data.transaction.method = method;
    expect(() => provider.parseWebhook(payload)).toThrow();
  });

  it('recusa sucesso sem transacção e falha com método inválido', () => {
    const { transaction: _transaction, ...data } = webhook().data;
    expect(() => provider.parseWebhook({ event: 'payment.success', data })).toThrow();
    expect(() => provider.parseWebhook({ ...webhook('10.00', 'invalid'), event: 'payment.failed' })).toThrow();
  });

  it('aceita falha definitiva sem inventar um método', () => {
    const { transaction: _transaction, ...data } = webhook().data;
    expect(provider.parseWebhook({ event: 'payment.failed', data })).toEqual({ event: 'failed', requestId: data.reference, providerRef: data.id, amountCents: 12550 });
  });

  it.each([null, [], {}, { event: 'payment.success', data: null }])('rejeita payload estruturalmente inválido', (payload) => {
    expect(() => provider.parseWebhook(payload)).toThrow();
  });

  it.each(['', 'id com espaço', '../path?x=1', 'a'.repeat(129), 123])('recusa identificadores inválidos %s', (value) => {
    expect(() => provider.parseWebhook({ ...webhook(), data: { ...webhook().data, id: value } })).toThrow();
    expect(() => provider.parseWebhook({ ...webhook(), data: { ...webhook().data, reference: value } })).toThrow();
  });

  it('verifica HMAC do corpo exacto e rejeita assinatura errada/corpo alterado', () => {
    const raw = JSON.stringify(webhook());
    const signature = createHmac('sha256', secret).update(raw).digest('hex');
    expect(provider.verifyWebhookSignature(raw, signature)).toBe(true);
    expect(provider.verifyWebhookSignature(`${raw} `, signature)).toBe(false);
    expect(provider.verifyWebhookSignature(raw, '0'.repeat(64))).toBe(false);
    expect(provider.verifyWebhookSignature(raw, '')).toBe(false);
  });

  it.each(['', '   '])('não aceita assinaturas com segredo vazio', (emptySecret) => {
    const raw = JSON.stringify(webhook());
    const signature = createHmac('sha256', emptySecret).update(raw).digest('hex');
    expect(new PaysuiteProvider('PLACEHOLDER_API_KEY', emptySecret).verifyWebhookSignature(raw, signature)).toBe(false);
  });
});

describe('checkout e-Mola simulado', () => {
  const request = { amountCents: 12550, method: 'emola' as const, idempotencyKey: 'PLACEHOLDER_ORDER_ID', returnUrl: 'http://localhost/return', webhookUrl: 'http://localhost/webhook' };

  it('envia o método e-Mola e o montante decimal exacto ao gateway', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { id: 'PLACEHOLDER_PAYMENT_ID', checkout_url: 'https://example.test/checkout' } }), { status: 200 }));
    vi.stubGlobal('fetch', mockFetch);
    const result = await provider.createCheckout({ ...request, amountCents: Number.MAX_SAFE_INTEGER });
    expect(result.providerPaymentId).toBe('PLACEHOLDER_PAYMENT_ID');
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toMatchObject({ amount: '90071992547409.91', method: 'emola', reference: request.idempotencyKey });
  });

  it.each([0, -1, 1.1, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1])('não inicia checkout de centavos inválidos %s', async (amountCents) => {
    const mockFetch = vi.fn(); vi.stubGlobal('fetch', mockFetch);
    await expect(provider.createCheckout({ ...request, amountCents })).rejects.toThrow();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('mock e-Mola assina e repete a mesma referência do checkout no webhook automático', async () => {
    vi.useFakeTimers();
    const mockFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', mockFetch);
    const mock = new MockProvider({ autoWebhookMs: 100 });
    const result = await mock.createCheckout(request);
    await vi.advanceTimersByTimeAsync(100);
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe(request.webhookUrl);
    expect(mock.verifyWebhookSignature(init.body, init.headers['X-Webhook-Signature'])).toBe(true);
    expect(mock.parseWebhook(JSON.parse(init.body))).toEqual({ event: 'success', requestId: request.idempotencyKey, providerRef: result.providerPaymentId, amountCents: request.amountCents, method: 'emola' });
  });

  it('mock usa as mesmas regras que o provider real para eventos desconhecidos', () => {
    expect(() => new MockProvider().parseWebhook({ ...webhook(), event: 'payment.pending' })).toThrow();
  });

  it('mock recusa assinatura não ASCII sem lançar uma excepção', () => {
    expect(new MockProvider().verifyWebhookSignature('{}', 'é'.repeat(64))).toBe(false);
  });
});
