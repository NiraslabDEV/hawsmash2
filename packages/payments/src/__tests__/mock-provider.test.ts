import { describe, it, expect } from 'vitest';
import { MockProvider } from '../mock-provider';

describe('MockProvider', () => {
  const provider = new MockProvider();

  it('cria checkout e retorna checkoutUrl + providerPaymentId', async () => {
    const result = await provider.createCheckout({
      amountCents: 5000,
      idempotencyKey: 'idem-1',
      returnUrl: 'http://localhost/return',
      webhookUrl: 'http://localhost/webhook',
    });
    expect(result.checkoutUrl).toBe('http://localhost/return');
    expect(result.providerPaymentId).toMatch(/^mock_/);
  });

  it('verifica assinatura válida', () => {
    const body = JSON.stringify({ foo: 'bar' });
    const sig = provider.signBody(body);
    expect(provider.verifyWebhookSignature(body, sig)).toBe(true);
  });

  it('rejeita assinatura inválida', () => {
    const body = JSON.stringify({ foo: 'bar' });
    expect(provider.verifyWebhookSignature(body, 'bad-sig')).toBe(false);
    expect(provider.verifyWebhookSignature(body, '')).toBe(false);
  });

  it('parseWebhook converte amount string → amountCents', () => {
    const payload = provider.buildWebhookPayload('req-1', 'success', 3500);
    const parsed = provider.parseWebhook(payload);
    expect(parsed.event).toBe('success');
    expect(parsed.requestId).toBe('req-1');
    expect(parsed.amountCents).toBe(3500);
    expect(parsed.providerRef).toContain('mock_pay_');
    expect(parsed.method).toBe('mpesa');
  });

  it('parseWebhook event failed', () => {
    const payload = provider.buildWebhookPayload('req-2', 'failed', 1000);
    const parsed = provider.parseWebhook(payload);
    expect(parsed.event).toBe('failed');
  });

  it('buildWebhookPayload produz payload no formato real da Paysuite (data aninhado)', () => {
    const p = provider.buildWebhookPayload('abc-123', 'success', 12550, 'emola');
    expect(p.event).toBe('payment.success');
    expect(p.data.reference).toBe('abc-123');
    expect(p.data.amount).toBe(125.5);
    expect(p.data.transaction?.method).toBe('emola');
    expect(p.request_id).toContain('whk_');
  });
});
