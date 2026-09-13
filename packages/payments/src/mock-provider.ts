import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { formatPaysuiteAmount, parsePaysuiteWebhook } from './paysuite-webhook';
import type {
  RedirectPaymentProvider,
  CreateCheckoutRequest,
  CreateCheckoutResponse,
  ParsedWebhook,
  PaymentMethod,
  ProviderPaymentStatus,
} from './provider';

const MOCK_SECRET = 'mock-webhook-secret-for-testing';

export class MockProvider implements RedirectPaymentProvider {
  readonly flow = 'redirect' as const;

  // DECISÃO: autoWebhookMs=0 desativa o disparo automático (útil em testes unitários)
  constructor(private options: { autoWebhookMs?: number } = {}) {}

  async createCheckout(request: CreateCheckoutRequest): Promise<CreateCheckoutResponse> {
    formatPaysuiteAmount(request.amountCents);
    const providerPaymentId = `mock_${randomUUID()}`;

    if (this.options.autoWebhookMs) {
      const { amountCents, idempotencyKey, webhookUrl, method } = request;
      setTimeout(() => {
        const payload = this.buildWebhookPayload(idempotencyKey, 'success', amountCents, method, providerPaymentId);
        const body = JSON.stringify(payload);
        fetch(webhookUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Webhook-Signature': this.signBody(body),
          },
          body,
        }).catch(console.error);
      }, this.options.autoWebhookMs);
    }

    // DECISÃO: o checkoutUrl do mock é o returnUrl — simula o ciclo
    // real (redirect → Paysuite → return) sem página externa. O webhook
    // automático confirma o pagamento ~2s depois; a página de retorno faz
    // polling até 'paid' exactamente como em produção.
    return {
      checkoutUrl: request.returnUrl,
      providerPaymentId,
    };
  }

  async getPaymentStatus(_providerRef: string): Promise<ProviderPaymentStatus> {
    void _providerRef;
    return 'success';
  }

  verifyWebhookSignature(rawBody: string, signatureHeader: string): boolean {
    if (!/^[a-f0-9]{64}$/.test(signatureHeader)) return false;
    const expected = this.signBody(rawBody);
    return timingSafeEqual(Buffer.from(signatureHeader, 'utf8'), Buffer.from(expected, 'utf8'));
  }

  parseWebhook(payload: unknown): ParsedWebhook {
    return parsePaysuiteWebhook(payload);
  }

  buildWebhookPayload(
    requestId: string,
    event: 'success' | 'failed',
    amountCents: number,
    method: PaymentMethod = 'mpesa',
    providerPaymentId?: string,
  ) {
    const data: {
      id: string;
      amount: string;
      reference: string;
      transaction?: { id: string; method: PaymentMethod; paid_at: string };
      error?: string;
    } = {
      id: providerPaymentId ?? `mock_pay_${requestId.slice(0, 8)}`,
      amount: formatPaysuiteAmount(amountCents),
      reference: requestId,
    };
    if (event === 'success') {
      data.transaction = { id: `tr_${requestId.slice(0, 6)}`, method, paid_at: new Date().toISOString() };
    } else {
      data.error = 'mock_failure';
    }
    return {
      event: event === 'success' ? 'payment.success' : 'payment.failed',
      data,
      created_at: Math.floor(Date.now() / 1000),
      request_id: `whk_${requestId.slice(0, 8)}`,
    };
  }

  signBody(body: string): string {
    return createHmac('sha256', MOCK_SECRET).update(body).digest('hex');
  }
}
