import { describe, it, expect } from 'vitest';
import { MockProvider, PaysuiteProvider } from '../index';
import type { PaymentProvider } from '../index';

describe('paysuite index exports', () => {
  it('MockProvider implementa PaymentProvider', () => {
    const p: PaymentProvider = new MockProvider();
    expect(typeof p.createCheckout).toBe('function');
    expect(typeof p.verifyWebhookSignature).toBe('function');
    expect(typeof p.parseWebhook).toBe('function');
  });

  it('PaysuiteProvider implementa PaymentProvider', () => {
    const p: PaymentProvider = new PaysuiteProvider('fake-key', 'fake-secret');
    expect(typeof p.verifyWebhookSignature).toBe('function');
    expect(typeof p.parseWebhook).toBe('function');
  });
});
