export type PaymentMethod = 'mpesa' | 'emola' | 'credit_card';

export type ProviderPaymentStatus = 'pending' | 'success' | 'failed';

/* ───────────────────────── fluxo de REDIRECT ─────────────────────────── */

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

interface ParsedWebhookPayment {
  requestId: string;
  amountCents: number;
  providerRef: string;
}

export type ParsedWebhook = ParsedWebhookPayment & (
  | { event: 'success'; method: PaymentMethod }
  | { event: 'failed'; method?: PaymentMethod }
);

/**
 * Gateway que leva o cliente para fora do site e o traz de volta (Paysuite).
 * A confirmação chega por webhook, e confirma-se activamente no regresso.
 */
export interface RedirectPaymentProvider {
  readonly flow: 'redirect';
  createCheckout(request: CreateCheckoutRequest): Promise<CreateCheckoutResponse>;
  verifyWebhookSignature(rawBody: string, signatureHeader: string): boolean;
  parseWebhook(payload: unknown): ParsedWebhook;
  getPaymentStatus?(providerRef: string, options?: { signal?: AbortSignal }): Promise<ProviderPaymentStatus>;
}

/* ────────────────────────── fluxo DIRECTO ────────────────────────────── */

export interface DirectChargeRequest {
  amountCents: number;
  /** Já normalizado (`258…`). Normalizar é do domínio, não do provider. */
  msisdn: string;
  /**
   * Referência da **tentativa**. Repetir a mesma referência nunca pode cobrar
   * duas vezes — é o que torna seguro o retry automático.
   */
  reference: string;
  description: string;
}

export interface DirectChargeResult {
  /**
   * `pending` quando **não sabemos** — tempo esgotado, erro do gateway, rede
   * em baixo. Nunca se converte "não sei" em "falhou": o cliente pode ter
   * digitado o PIN e o dinheiro ter saído.
   */
  status: ProviderPaymentStatus;
  /** Id da transacção no gateway, quando ele o dá. Serve para reconciliar. */
  providerRef: string | null;
  /** Código cru do gateway — para o painel e para os logs, não para o cliente. */
  code: string | null;
  /** Mensagem já em português, para o cliente ler. */
  message: string;
}

/**
 * Gateway que cobra **sem sair do site**: manda um pedido de PIN ao telemóvel
 * do cliente e responde quando ele confirmar (M-Pesa da Vodacom).
 *
 * Diferenças que mudam o desenho, e não são detalhe:
 * - **não há redirect** — o cliente fica no nosso ecrã a olhar para o telemóvel;
 * - **não há webhook** — quem não souber o estado tem de ir perguntar;
 * - **a chamada demora** — até dois minutos à espera do PIN.
 */
export interface DirectPaymentProvider {
  readonly flow: 'direct';
  charge(request: DirectChargeRequest): Promise<DirectChargeResult>;
  /** Pergunta o estado pela referência da tentativa. É isto que fecha o ciclo. */
  getPaymentStatus(reference: string, options?: { signal?: AbortSignal }): Promise<ProviderPaymentStatus>;
}

export type PaymentProvider = RedirectPaymentProvider | DirectPaymentProvider;

export function isDirectProvider(provider: PaymentProvider): provider is DirectPaymentProvider {
  return provider.flow === 'direct';
}

export function isRedirectProvider(
  provider: PaymentProvider,
): provider is RedirectPaymentProvider {
  return provider.flow === 'redirect';
}
