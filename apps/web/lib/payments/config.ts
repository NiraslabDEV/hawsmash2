import { createClient } from '@supabase/supabase-js';
import {
  MockProvider,
  MpesaProvider,
  MpesaSimulator,
  PaysuiteProvider,
  type PaymentProvider,
} from '@delivery/payments';

/**
 * Resolve a configuração de pagamento (provider + credenciais) da loja.
 *
 * Precedência: **a loja manda**; o que ela não tiver cai em `settings`; o que
 * `settings` não tiver cai no `.env`. É o que permite uma instalação de uma
 * loja só viver no `.env` e uma de várias ter cada loja com a sua conta.
 *
 * As credenciais são segredos: lidas só no servidor com service role. Nunca
 * saem em `get_menu()` nem em nenhuma RPC anónima (CLAUDE.md §5.6 · §17).
 */

export type PaymentProviderName = 'manual' | 'mock' | 'paysuite' | 'mpesa' | 'mpesa_sim';

export interface MpesaCredentials {
  apiKey: string;
  publicKey: string;
  serviceProviderCode: string;
  sessionBaseUrl: string;
  chargeBaseUrl: string;
  queryBaseUrl: string;
}

export interface PaymentConfig {
  provider: PaymentProviderName;
  apiKey: string | null;
  webhookSecret: string | null;
  mpesa: MpesaCredentials | null;
}

/** Colunas de segredo da loja. Nunca devolvidas a um cliente autenticado. */
const STORE_COLUMNS =
  'payment_provider, paysuite_api_key, paysuite_webhook_secret,' +
  'mpesa_api_key, mpesa_public_key, mpesa_service_provider_code,' +
  'mpesa_session_base_url, mpesa_charge_base_url, mpesa_query_base_url';

type StoreRow = Record<string, string | null>;

function mpesaFromEnv(): Partial<MpesaCredentials> {
  return {
    apiKey: process.env.MPESA_API_KEY ?? '',
    publicKey: process.env.MPESA_PUBLIC_KEY ?? '',
    serviceProviderCode: process.env.MPESA_SERVICE_PROVIDER_CODE ?? '',
    sessionBaseUrl: process.env.MPESA_SESSION_BASE_URL ?? '',
    chargeBaseUrl: process.env.MPESA_CHARGE_BASE_URL ?? '',
    queryBaseUrl: process.env.MPESA_QUERY_BASE_URL ?? '',
  };
}

/** Só conta como configurado se estiver **tudo** lá — meio configurado é pior. */
function completeMpesa(partial: Partial<MpesaCredentials>): MpesaCredentials | null {
  const campos: (keyof MpesaCredentials)[] = [
    'apiKey',
    'publicKey',
    'serviceProviderCode',
    'sessionBaseUrl',
    'chargeBaseUrl',
    'queryBaseUrl',
  ];
  if (campos.some((campo) => !partial[campo]?.trim())) return null;
  return partial as MpesaCredentials;
}

export async function getPaymentConfig(storeSlug?: string | null, options?: { signal?: AbortSignal; requireStore?: boolean }): Promise<PaymentConfig> {
  options?.signal?.throwIfAborted();
  let provider = (process.env.PAYMENT_PROVIDER ?? 'manual') as PaymentProviderName;
  let apiKey = process.env.PAYSUITE_API_KEY ?? null;
  let webhookSecret = process.env.PAYSUITE_WEBHOOK_SECRET ?? null;
  const mpesa = mpesaFromEnv();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (url && serviceKey) {
    try {
      const svc = createClient(url, serviceKey, {
        auth: { persistSession: false },
        ...(options?.signal ? { global: { fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, options.signal!]) : options.signal }) } } : {}),
      });

      const { data: settings } = await svc
        .from('settings')
        .select('payment_provider, paysuite_api_key, paysuite_webhook_secret')
        .eq('id', 1)
        .single();
      if (settings) {
        if (settings.payment_provider) provider = settings.payment_provider;
        if (settings.paysuite_api_key) apiKey = settings.paysuite_api_key;
        if (settings.paysuite_webhook_secret) webhookSecret = settings.paysuite_webhook_secret;
      }

      if (storeSlug) {
        const { data, error } = await svc
          .from('stores')
          .select(STORE_COLUMNS)
          .eq('slug', storeSlug)
          .maybeSingle<StoreRow>();

        if (options?.requireStore && (error || !data)) throw new Error('store_payment_config_unavailable');

        if (data) {
          if (data.payment_provider) provider = data.payment_provider as PaymentProviderName;
          if (data.paysuite_api_key) apiKey = data.paysuite_api_key;
          if (data.paysuite_webhook_secret) webhookSecret = data.paysuite_webhook_secret;

          if (data.mpesa_api_key) mpesa.apiKey = data.mpesa_api_key;
          if (data.mpesa_public_key) mpesa.publicKey = data.mpesa_public_key;
          if (data.mpesa_service_provider_code)
            mpesa.serviceProviderCode = data.mpesa_service_provider_code;
          if (data.mpesa_session_base_url) mpesa.sessionBaseUrl = data.mpesa_session_base_url;
          if (data.mpesa_charge_base_url) mpesa.chargeBaseUrl = data.mpesa_charge_base_url;
          if (data.mpesa_query_base_url) mpesa.queryBaseUrl = data.mpesa_query_base_url;
        }
      }
    } catch {
      options?.signal?.throwIfAborted();
      if (options?.requireStore) throw new Error('store_payment_config_unavailable');
      /* sem BD acessível → usa só o .env */
    }
  }

  if (options?.requireStore && (!storeSlug || !url || !serviceKey)) throw new Error('store_payment_config_unavailable');
  options?.signal?.throwIfAborted();
  return { provider, apiKey, webhookSecret, mpesa: completeMpesa(mpesa) };
}

/**
 * Constrói o provider a partir da config resolvida.
 *
 * Lança quando o provider escolhido não tem com que trabalhar. É deliberado:
 * uma loja marcada como `mpesa` sem credenciais não deve receber encomendas em
 * silêncio — o checkout tem de cair no fluxo manual e o painel tem de saber
 * (CLAUDE.md §11.9).
 */
export function buildProvider(
  cfg: PaymentConfig,
  opts?: { autoWebhookMs?: number },
): PaymentProvider {
  switch (cfg.provider) {
    case 'mock':
      return new MockProvider({ autoWebhookMs: opts?.autoWebhookMs });
    case 'mpesa_sim':
      return new MpesaSimulator();
    case 'mpesa':
      if (!cfg.mpesa) throw new Error('mpesa_not_configured');
      return new MpesaProvider(cfg.mpesa);
    default:
      return new PaysuiteProvider(cfg.apiKey ?? '', cfg.webhookSecret ?? '');
  }
}

/** O provider cobra sem o cliente sair do site? */
export function isDirectFlow(provider: PaymentProviderName): boolean {
  return provider === 'mpesa' || provider === 'mpesa_sim';
}
