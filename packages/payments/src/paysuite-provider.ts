import { createHmac, timingSafeEqual } from 'node:crypto';
import { formatPaysuiteAmount, parsePaysuiteWebhook } from './paysuite-webhook';
import type {
  RedirectPaymentProvider,
  CreateCheckoutRequest,
  CreateCheckoutResponse,
  ParsedWebhook,
  ProviderPaymentStatus,
} from './provider';

// Contrato real verificado em 2026-06-11 contra https://paysuite.tech/docs
const PAYSUITE_API_BASE = 'https://paysuite.tech/api/v1';

const API_STATUS_MAP: Record<string, ProviderPaymentStatus> = {
  paid:       'success',
  completed:  'success',
  success:    'success',
  failed:     'failed',
  cancelled:  'failed',
  expired:    'failed',
  pending:    'pending',
  processing: 'pending',
};

export class PaysuiteProvider implements RedirectPaymentProvider {
  readonly flow = 'redirect' as const;

  constructor(
    private apiKey: string,
    private webhookSecret: string,
    private apiBase: string = PAYSUITE_API_BASE,
  ) {}

  async createCheckout(request: CreateCheckoutRequest): Promise<CreateCheckoutResponse> {
    // Boundary: centavos → string decimal (CLAUDE.md 6.4) — nunca float
    const amount = formatPaysuiteAmount(request.amountCents);

    const res = await fetch(`${this.apiBase}/payments`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        amount,
        reference: request.idempotencyKey,
        description: 'Pedido Delivery OS',
        ...(request.method ? { method: request.method } : {}),
        return_url: request.returnUrl,
        callback_url: request.webhookUrl,
      }),
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      const code =
        (errBody as { error?: { code?: string }; message?: string })?.error?.code ??
        (errBody as { message?: string })?.message ??
        `http_${res.status}`;
      throw new Error(`paysuite_checkout_failed: ${code}`);
    }

    const json = (await res.json()) as { data?: Record<string, string> };
    const data = (json.data ?? json) as Record<string, string>;

    const checkoutUrl = data.checkout_url;
    const providerPaymentId = data.id;

    if (!checkoutUrl || !providerPaymentId) {
      throw new Error('paysuite_checkout_failed: malformed_response');
    }

    return { checkoutUrl, providerPaymentId };
  }

  verifyWebhookSignature(rawBody: string, signatureHeader: string): boolean {
    if (!this.webhookSecret.trim() || !/^[a-f0-9]{64}$/.test(signatureHeader)) return false;
    const expected = createHmac('sha256', this.webhookSecret).update(rawBody).digest('hex');
    try {
      const expectedBuf = Buffer.from(expected, 'utf8');
      const actualBuf = Buffer.from(signatureHeader, 'utf8');
      if (expectedBuf.length !== actualBuf.length) return false;
      return timingSafeEqual(expectedBuf, actualBuf);
    } catch {
      return false;
    }
  }

  parseWebhook(payload: unknown): ParsedWebhook {
    return parsePaysuiteWebhook(payload);
  }

  // DECISÃO: erro de rede/API → 'pending' (nunca marcar failed sem certeza;
  // a próxima volta do cron tenta de novo).
  async getPaymentStatus(providerRef: string, options?: { signal?: AbortSignal }): Promise<ProviderPaymentStatus> {
    try {
      const timeout = AbortSignal.timeout(20_000);
      const signal = options?.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
      signal.throwIfAborted();
      const res = await fetch(`${this.apiBase}/payments/${providerRef}`, {
        method: 'GET',
        signal,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: 'application/json',
        },
      });
      if (!res.ok) return 'pending';

      const json = (await res.json()) as {
        data?: { status?: string; transaction?: { status?: string } };
      };
      const data = json.data ?? (json as { status?: string; transaction?: { status?: string } });
      const status = data.transaction?.status ?? data.status;
      return API_STATUS_MAP[status?.toLowerCase() ?? ''] ?? 'pending';
    } catch {
      return 'pending';
    }
  }
}
