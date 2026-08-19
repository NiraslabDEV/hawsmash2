import { createClient } from '@supabase/supabase-js';
import { PaysuiteProvider, MockProvider, type PaymentProvider } from '@delivery/paysuite';

/**
 * Resolve a configuração de pagamento (provider + chaves Paysuite).
 *
 * Precedência (CLAUDE.md 6.2 / 16.2): valor em `settings` tem prioridade; se vazio,
 * cai no `.env`. Assim funciona tanto "tudo no admin" como "tudo no .env".
 *
 * As chaves Paysuite são segredos (B): lidas só no servidor via service role —
 * NUNCA saem em get_menu() nem em qualquer RPC anon.
 */
export interface PaymentConfig {
  provider: 'manual' | 'mock' | 'paysuite';
  apiKey: string | null;
  webhookSecret: string | null;
}

export async function getPaymentConfig(): Promise<PaymentConfig> {
  // defaults a partir do .env (fallback)
  let provider = (process.env.PAYMENT_PROVIDER ?? 'manual') as PaymentConfig['provider'];
  let apiKey = process.env.PAYSUITE_API_KEY ?? null;
  let webhookSecret = process.env.PAYSUITE_WEBHOOK_SECRET ?? null;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (url && serviceKey) {
    try {
      const svc = createClient(url, serviceKey, { auth: { persistSession: false } });
      const { data } = await svc
        .from('settings')
        .select('payment_provider, paysuite_api_key, paysuite_webhook_secret')
        .eq('id', 1)
        .single();
      if (data) {
        if (data.payment_provider) provider = data.payment_provider as PaymentConfig['provider'];
        if (data.paysuite_api_key) apiKey = data.paysuite_api_key; // settings tem prioridade
        if (data.paysuite_webhook_secret) webhookSecret = data.paysuite_webhook_secret;
      }
    } catch {
      /* sem BD acessível → usa só o .env */
    }
  }

  return { provider, apiKey, webhookSecret };
}

/** Constrói o provider a partir da config resolvida. */
export function buildProvider(
  cfg: PaymentConfig,
  opts?: { autoWebhookMs?: number },
): PaymentProvider {
  if (cfg.provider === 'mock') return new MockProvider({ autoWebhookMs: opts?.autoWebhookMs });
  return new PaysuiteProvider(cfg.apiKey ?? '', cfg.webhookSecret ?? '');
}
