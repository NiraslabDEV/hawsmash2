/**
 * Sentry só arranca com DSN configurado. Sem DSN o sistema funciona na mesma —
 * observabilidade nunca pode ser a razão pela qual uma venda não acontece.
 * BLOQUEIO: B-013 (falta o projecto/DSN).
 */
export async function register() {
  const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return;

  const Sentry = await import('@sentry/nextjs');
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development',
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
    // Dados de clientes não vão para fora: nada de corpos de pedido nem cookies.
    sendDefaultPii: false,
  });
}

export async function onRequestError(
  ...args: Parameters<typeof import('@sentry/nextjs').captureRequestError>
) {
  const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return;
  const Sentry = await import('@sentry/nextjs');
  Sentry.captureRequestError(...args);
}
