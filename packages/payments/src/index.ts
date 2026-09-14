export type {
  PaymentMethod,
  CreateCheckoutRequest,
  CreateCheckoutResponse,
  ParsedWebhook,
  PaymentProvider,
  RedirectPaymentProvider,
  DirectPaymentProvider,
  DirectChargeRequest,
  DirectChargeResult,
  ProviderPaymentStatus,
} from './provider';
export { isDirectProvider, isRedirectProvider } from './provider';
export { MockProvider } from './mock-provider';
export { PaysuiteProvider } from './paysuite-provider';
export {
  PAYSUITE_ERROR_MESSAGES_PT,
  PAYSUITE_ERROR_FALLBACK_PT,
  paysuiteErrorToPt,
} from './errors';

// ── M-Pesa directo (Vodacom) ────────────────────────────────────────────────
export { MpesaProvider, MpesaConfigError, type MpesaConfig } from './mpesa/mpesa-provider';
export { MpesaSimulator } from './mpesa/simulator';
// ── Preparação e-Mola directa: só simulador, sem contrato/API real inventados ──
export { EmolaSimulator } from './emola/simulator';
export { normalizeEmolaMsisdn, InvalidEmolaMsisdnError, EMOLA_MSISDN_ERROR_PT } from './emola/msisdn';
export {
  normalizeMsisdn,
  isValidMsisdn,
  formatMsisdn,
  InvalidMsisdnError,
  MSISDN_ERROR_PT,
} from './mpesa/msisdn';
export { readMpesaCode, mpesaMessagePt, MPESA_FALLBACK_PT, type MpesaOutcome } from './mpesa/codes';
export { paymentStatementSchema, reconcilePaymentStatement, parseStatementAmount, type StatementInput, type StatementIssue } from './statement';
