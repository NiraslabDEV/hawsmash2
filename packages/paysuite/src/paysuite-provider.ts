import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  PaymentProvider,
  CreateCheckoutRequest,
  CreateCheckoutResponse,
  ParsedWebhook,
  PaymentMethod,
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

interface PaysuiteWebhookBody {
  event: string;
  data: {
    id: string;
    amount: number | string;
    reference: string;
    transaction?: { id: string; method: string; paid_at: string };
    error?: string;
  };
  created_at: number;
  request_id: string;
}

export class PaysuiteProvider implements PaymentProvider {
  constructor(
    private apiKey: string,
    private webhookSecret: string,
    private apiBase: string = PAYSUITE_API_BASE,
  ) {}

  async createCheckout(request: CreateCheckoutRequest): Promise<CreateCheckoutResponse> {
    // Boundary: centavos → string decimal (CLAUDE.md 6.4) — nunca float
    const amount = (request.amountCents / 100).toFixed(2);

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
    const p = payload as PaysuiteWebhookBody;
    return {
      event: p.event === 'payment.success' ? 'success' : 'failed',
      requestId: p.data.reference,
      amountCents: Math.round(Number(p.data.amount) * 100),
      providerRef: p.data.id,
      method: (p.data.transaction?.method ?? 'mpesa') as PaymentMethod,
    };
  }

  // DECISÃO: erro de rede/API → 'pending' (nunca marcar failed sem certeza;
  // a próxima volta do cron tenta de novo).
  async getPaymentStatus(providerRef: string): Promise<ProviderPaymentStatus> {
    try {
      const res = await fetch(`${this.apiBase}/payments/${providerRef}`, {
        method: 'GET',
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
