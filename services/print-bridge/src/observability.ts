import * as Sentry from '@sentry/node';

/**
 * O bridge corre 24/7 num mini-PC de loja. Com SENTRY_DSN definido, um crash
 * chega ao Niraslab sem depender de alguém reparar; sem DSN, fica só no log
 * local — nunca impede a impressão. BLOQUEIO: B-013.
 */
let enabled = false;

export function initObservability(storeId: string | undefined, version: string): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? 'production',
    release: version,
    tracesSampleRate: 0,
    sendDefaultPii: false,
    initialScope: { tags: { store_id: storeId ?? 'unknown', component: 'print-bridge' } },
  });
  enabled = true;
}

export function reportError(error: unknown, context?: Record<string, unknown>): void {
  if (!enabled) return;
  Sentry.captureException(error, context ? { extra: context } : undefined);
}

export function observabilityEnabled(): boolean {
  return enabled;
}
