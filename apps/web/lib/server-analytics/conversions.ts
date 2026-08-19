/**
 * conversions.ts — F4.5: server-side conversion signals (CLAUDE.md 16.8)
 *
 * Disparado fire-and-forget após paid (webhook) ou approved (APPROVE admin).
 * Nunca lança, nunca bloqueia o pedido. Falha → event_log.
 *
 * event_id = 'purchase_<orderId>' em todos os destinos → deduplicação browser↔server.
 * Token lido de settings (B) → fallback env.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

// ── tipos internos ────────────────────────────────────────────────────────────

interface ConversionPayload {
  orderId: string;
  totalCents: number;
  /** pixel_id lido de settings.meta_pixel_id (campo A público — já disponível) */
  metaPixelId?: string | null;
  /** token CAPI de settings.meta_capi_token (B) ou env META_CAPI_TOKEN */
  metaCapiToken?: string | null;
  /** developer token de settings.gads_developer_token (B) ou env GOOGLE_ADS_DEVELOPER_TOKEN */
  gadsDevToken?: string | null;
}

// ── Meta CAPI ────────────────────────────────────────────────────────────────

async function sendMetaCapi(payload: ConversionPayload): Promise<void> {
  const { orderId, totalCents, metaPixelId, metaCapiToken } = payload;
  if (!metaPixelId || !metaCapiToken) return;

  const eventId = `purchase_${orderId}`;
  const body = {
    data: [
      {
        event_name: 'Purchase',
        event_time: Math.floor(Date.now() / 1000),
        event_id: eventId,
        action_source: 'website',
        custom_data: {
          value: totalCents / 100,
          currency: 'MZN',
          order_id: orderId,
        },
      },
    ],
  };

  const res = await fetch(
    `https://graph.facebook.com/v19.0/${metaPixelId}/events?access_token=${metaCapiToken}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Meta CAPI ${res.status}: ${text}`);
  }
}

// ── Google Enhanced / Offline Conversions ────────────────────────────────────
// Usa o Google Ads REST API (Offline Conversion Import).
// Requer developer_token no header; conversion_action configurado pelo dono.
// Se GADS_CONVERSION_ACTION env não estiver definido, o registo fica em event_log
// para referência — sem bloquear nada.

async function sendGoogleConversion(payload: ConversionPayload): Promise<void> {
  const { orderId, totalCents, gadsDevToken } = payload;
  if (!gadsDevToken) return;

  const conversionAction = process.env.GADS_CONVERSION_ACTION ?? '';
  if (!conversionAction) {
    // Sem action resource name configurado — regista a tentativa mas não falha.
    throw new Error('GADS_CONVERSION_ACTION não configurado; skipped');
  }

  const body = {
    conversions: [
      {
        conversionAction,
        conversionDateTime: new Date().toISOString().replace('T', ' ').replace('Z', '+00:00'),
        conversionValue: totalCents / 100,
        currencyCode: 'MZN',
        orderId,
        // transaction_id = order.id → dedup nativo Google Ads
        transactionId: orderId,
      },
    ],
    partialFailure: true,
  };

  const customerId = process.env.GADS_CUSTOMER_ID ?? '';
  if (!customerId) {
    throw new Error('GADS_CUSTOMER_ID não configurado; skipped');
  }

  const res = await fetch(
    `https://googleads.googleapis.com/v17/customers/${customerId}/conversionUploads:uploadClickConversions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'developer-token': gadsDevToken,
        Authorization: `Bearer ${process.env.GADS_OAUTH_TOKEN ?? ''}`,
      },
      body: JSON.stringify(body),
    },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Google Ads API ${res.status}: ${text}`);
  }
}

// ── log helper ────────────────────────────────────────────────────────────────

async function logError(
  supabase: SupabaseClient,
  orderId: string,
  type: string,
  error: unknown,
) {
  const message = error instanceof Error ? error.message : String(error);
  try {
    await supabase
      .from('event_log')
      .insert({ order_id: orderId, type, payload: { error: message } });
  } catch {
    // silencioso — log de log não pode falhar visivelmente
  }
}

// ── public API ────────────────────────────────────────────────────────────────

/**
 * Lê tokens de settings (B) com fallback para env, e dispara CAPI + Google.
 * Fire-and-forget: nunca lança, nunca bloqueia o pedido. Falha → event_log.
 */
export async function fireConversions(
  orderId: string,
  totalCents: number,
  supabase: SupabaseClient,
): Promise<void> {
  // Ler config pública (pixel_id) + segredos (tokens B) via get_secret_settings
  let metaPixelId: string | null = null;
  let metaCapiToken: string | null = null;
  let gadsDevToken: string | null = null;

  try {
    // Campos (A) públicos: meta_pixel_id já no settings direto
    const { data: pub } = await supabase
      .from('settings')
      .select('meta_pixel_id')
      .eq('id', 1)
      .single();
    metaPixelId = pub?.meta_pixel_id ?? null;

    // Campos (B) secretos via RPC (restrita a service_role)
    const { data: sec } = await supabase.rpc('get_secret_settings');
    metaCapiToken = sec?.meta_capi_token ?? process.env.META_CAPI_TOKEN ?? null;
    gadsDevToken = sec?.gads_developer_token ?? process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? null;
  } catch {
    // Se falhar a leitura de config, usa só env vars
    metaCapiToken = process.env.META_CAPI_TOKEN ?? null;
    gadsDevToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? null;
  }

  const payload: ConversionPayload = { orderId, totalCents, metaPixelId, metaCapiToken, gadsDevToken };

  // First-party purchase event (fonte de verdade do funil — CLAUDE.md 16.6).
  // Gravado server-side para garantir que o funil conta mesmo que o browser
  // do cliente tenha fechado a aba antes de ver o status 'approved'/'paid'.
  // session_id = 'server_<orderId>' distingue entradas server-side das do browser.
  void supabase
    .from('analytics_events')
    .insert({
      session_id: `server_${orderId}`,
      type: 'purchase',
      value_cents: totalCents,
      utm: {},
      payload: { order_id: orderId, source: 'server' },
    });

  // Meta CAPI — fire-and-forget individual
  sendMetaCapi(payload).catch((err) =>
    logError(supabase, orderId, 'conversion.capi_error', err),
  );

  // Google Enhanced — fire-and-forget individual
  sendGoogleConversion(payload).catch((err) =>
    logError(supabase, orderId, 'conversion.gads_error', err),
  );
}
