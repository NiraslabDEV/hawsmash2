export type PaymentMethod = 'mpesa' | 'emola' | 'credit_card';

export interface CreateCheckoutRequest {
  amountCents: number;
  method?: PaymentMethod;
  idempotencyKey: string;
  returnUrl: string;
  webhookUrl: string;
}

export interface CreateCheckoutResponse {
  checkoutUrl: string;
  providerPaymentId: string;
}

export interface ParsedWebhook {
  event: 'success' | 'failed';
  requestId: string;
  amountCents: number;
  providerRef: string;
  method: PaymentMethod;
}

export type ProviderPaymentStatus = 'pending' | 'success' | 'failed';

export interface PaymentProvider {
  createCheckout(request: CreateCheckoutRequest): Promise<CreateCheckoutResponse>;
  verifyWebhookSignature(rawBody: string, signatureHeader: string): boolean;
  parseWebhook(payload: unknown): ParsedWebhook;
  getPaymentStatus?(providerRef: string): Promise<ProviderPaymentStatus>;
}
