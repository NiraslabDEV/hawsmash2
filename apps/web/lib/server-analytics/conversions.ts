/**
 * conversions.ts — F4.5: sinais de conversão server-side (CLAUDE.md 16.8).
 *
 * Reescrito na 1030 para o padrão outbox. Antes, isto fazia `fetch()`
 * fire-and-forget: se a Meta estivesse em baixo ou a rede falhasse, a
 * conversão de uma venda real desaparecia sem deixar rasto. Agora a conversão
 * é primeiro uma LINHA em `conversion_jobs` e só depois um pedido HTTP —
 * falhar passa a ser um estado com retoma, como em `print_jobs` (§8.1).
 *
 * O que continua igual, porque é regra da casa (§1.1): nada disto pode
 * bloquear ou atrasar a venda. `fireConversions` nunca lança e nunca é
 * esperado pelo caminho do dinheiro.
 *
 * event_id = 'purchase_<orderId>' em todos os destinos → deduplicação
 * browser ↔ servidor. É o mesmo id que o `trackPurchase` do browser usa.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  buildMetaUserData,
  matchQualityScore,
  type MetaUserData,
} from './user-data';

// ── config ───────────────────────────────────────────────────────────────────

interface ConversionConfig {
  metaPixelId: string | null;
  metaCapiToken: string | null;
  metaTestEventCode: string | null;
  gadsDevToken: string | null;
}

interface ConversionContext {
  order_id: string;
  order_number: string | null;
  total_cents: number;
  created_at: string;
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  attribution: {
    channel: string | null;
    source: string | null;
    campaign: string | null;
    click_ids: Record<string, string> | null;
    fbp: string | null;
    client_ip: string | null;
    user_agent: string | null;
    event_source_url: string | null;
    created_at: string | null;
  } | null;
  items: Array<{ id: string | null; name: string; qty: number; price_cents: number }>;
}

interface ClaimedJob {
  id: number;
  order_id: string;
  store_id: string | null;
  destination: 'meta_capi' | 'google_ads';
  event_name: string;
  value_cents: number;
  attempts: number;
}

const CURRENCY = 'MZN';

async function loadConfig(supabase: SupabaseClient): Promise<ConversionConfig> {
  let metaPixelId: string | null = null;
  let metaCapiToken: string | null = null;
  let gadsDevToken: string | null = null;

  try {
    const { data: pub } = await supabase
      .from('settings')
      .select('meta_pixel_id')
      .eq('id', 1)
      .single();
    metaPixelId = pub?.meta_pixel_id ?? null;

    const { data: sec } = await supabase.rpc('get_secret_settings');
    metaCapiToken = sec?.meta_capi_token ?? process.env.META_CAPI_TOKEN ?? null;
    gadsDevToken = sec?.gads_developer_token ?? process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? null;
  } catch {
    metaCapiToken = process.env.META_CAPI_TOKEN ?? null;
    gadsDevToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? null;
  }

  return {
    metaPixelId,
    metaCapiToken,
    metaTestEventCode: process.env.META_TEST_EVENT_CODE ?? null,
    gadsDevToken,
  };
}

// ── Meta CAPI ────────────────────────────────────────────────────────────────

export function buildMetaPayload(
  ctx: ConversionContext,
  config: ConversionConfig,
): { body: Record<string, unknown>; userData: MetaUserData } {
  const attr = ctx.attribution;
  const clickIds = attr?.click_ids ?? {};

  const userData = buildMetaUserData({
    phone: ctx.customer_phone,
    email: ctx.customer_email,
    fullName: ctx.customer_name,
    fbp: attr?.fbp,
    fbclid: clickIds.fbclid,
    clickTimeMs: attr?.created_at ? Date.parse(attr.created_at) : undefined,
    clientIp: attr?.client_ip,
    userAgent: attr?.user_agent,
  });

  // `event_time` é o momento da VENDA, não o do envio: uma conversão que só
  // saiu à terceira tentativa tem de chegar à Meta com a hora certa, senão a
  // atribuição da campanha fica deslocada.
  const eventTime = Math.floor(Date.parse(ctx.created_at) / 1000) || Math.floor(Date.now() / 1000);

  const body: Record<string, unknown> = {
    data: [
      {
        event_name: 'Purchase',
        event_time: eventTime,
        event_id: `purchase_${ctx.order_id}`,
        action_source: 'website',
        ...(attr?.event_source_url ? { event_source_url: attr.event_source_url } : {}),
        user_data: userData,
        custom_data: {
          value: ctx.total_cents / 100,
          currency: CURRENCY,
          order_id: ctx.order_number ?? ctx.order_id,
          content_type: 'product',
          contents: ctx.items.map((i) => ({
            id: i.id ?? i.name,
            quantity: i.qty,
            item_price: i.price_cents / 100,
          })),
          num_items: ctx.items.reduce((sum, i) => sum + i.qty, 0),
        },
      },
    ],
  };

  if (config.metaTestEventCode) body.test_event_code = config.metaTestEventCode;

  return { body, userData };
}

async function sendMetaCapi(
  ctx: ConversionContext,
  config: ConversionConfig,
): Promise<Record<string, unknown>> {
  if (!config.metaPixelId || !config.metaCapiToken) {
    throw new Error('meta_nao_configurada: falta pixel_id ou capi_token');
  }

  const { body, userData } = buildMetaPayload(ctx, config);

  const res = await fetch(
    `https://graph.facebook.com/v19.0/${config.metaPixelId}/events?access_token=${config.metaCapiToken}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );

  const text = await res.text().catch(() => '');
  if (!res.ok) throw new Error(`Meta CAPI ${res.status}: ${text.slice(0, 400)}`);

  return { match_signals: matchQualityScore(userData), response: text.slice(0, 400) };
}

// ── Google Ads (offline click conversions) ───────────────────────────────────

async function sendGoogleConversion(
  ctx: ConversionContext,
  config: ConversionConfig,
): Promise<Record<string, unknown>> {
  if (!config.gadsDevToken) throw new Error('google_nao_configurado: falta developer token');

  const conversionAction = process.env.GADS_CONVERSION_ACTION ?? '';
  if (!conversionAction) throw new Error('GADS_CONVERSION_ACTION não configurado');

  const customerId = process.env.GADS_CUSTOMER_ID ?? '';
  if (!customerId) throw new Error('GADS_CUSTOMER_ID não configurado');

  // Sem identificador de clique não há conversão de clique para importar —
  // era isto que faltava antes e fazia a API recusar tudo.
  const clickIds = ctx.attribution?.click_ids ?? {};
  const gclid = clickIds.gclid ?? null;
  const gbraid = clickIds.gbraid ?? null;
  const wbraid = clickIds.wbraid ?? null;
  if (!gclid && !gbraid && !wbraid) throw new Error('sem_gclid: nada para importar');

  const body = {
    conversions: [
      {
        conversionAction,
        conversionDateTime: new Date(ctx.created_at)
          .toISOString()
          .replace('T', ' ')
          .replace('Z', '+00:00'),
        conversionValue: ctx.total_cents / 100,
        currencyCode: CURRENCY,
        orderId: ctx.order_number ?? ctx.order_id,
        ...(gclid ? { gclid } : {}),
        ...(gbraid ? { gbraid } : {}),
        ...(wbraid ? { wbraid } : {}),
      },
    ],
    partialFailure: true,
  };

  const res = await fetch(
    `https://googleads.googleapis.com/v17/customers/${customerId}/conversionUploads:uploadClickConversions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'developer-token': config.gadsDevToken,
        Authorization: `Bearer ${process.env.GADS_OAUTH_TOKEN ?? ''}`,
      },
      body: JSON.stringify(body),
    },
  );

  const text = await res.text().catch(() => '');
  if (!res.ok) throw new Error(`Google Ads API ${res.status}: ${text.slice(0, 400)}`);

  return { response: text.slice(0, 400) };
}

// ── worker ───────────────────────────────────────────────────────────────────

export interface DrainResult {
  claimed: number;
  sent: number;
  failed: number;
}

/**
 * Reclama trabalho da fila e tenta enviá-lo. Corre nos dois sítios: logo a
 * seguir à venda (para a conversão chegar em segundos) e no cron (para apanhar
 * o que falhou). `for update skip locked` na BD garante que os dois nunca
 * enviam o mesmo trabalho.
 */
export async function drainConversionJobs(
  supabase: SupabaseClient,
  limit = 20,
): Promise<DrainResult> {
  const result: DrainResult = { claimed: 0, sent: 0, failed: 0 };

  const { data: jobs, error } = await supabase.rpc('claim_conversion_jobs', { p_limit: limit });
  if (error || !Array.isArray(jobs) || jobs.length === 0) return result;

  result.claimed = jobs.length;
  const config = await loadConfig(supabase);

  // Um pedido pode ter dois destinos: lê-se o contexto uma vez por pedido.
  const contexts = new Map<string, ConversionContext | null>();

  for (const job of jobs as ClaimedJob[]) {
    try {
      if (!contexts.has(job.order_id)) {
        const { data } = await supabase.rpc('get_conversion_context', { p_order_id: job.order_id });
        contexts.set(job.order_id, (data as ConversionContext) ?? null);
      }
      const ctx = contexts.get(job.order_id);
      if (!ctx) throw new Error('pedido_nao_encontrado');

      const response =
        job.destination === 'meta_capi'
          ? await sendMetaCapi(ctx, config)
          : await sendGoogleConversion(ctx, config);

      await supabase.rpc('complete_conversion_job', {
        p_id: job.id,
        p_ok: true,
        p_error: null,
        p_response: response,
      });
      result.sent += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await supabase.rpc('complete_conversion_job', {
        p_id: job.id,
        p_ok: false,
        p_error: message,
        p_response: null,
      });
      result.failed += 1;
    }
  }

  return result;
}

// ── public API ───────────────────────────────────────────────────────────────

/**
 * Chamada quando o pedido passa a dinheiro real (webhook, verify, aprovação).
 * Regista o `purchase` do funil, põe as conversões na fila e tenta esvaziá-la
 * já. Nunca lança: se tudo isto falhar, a fila fica com o trabalho e o cron
 * apanha-o mais tarde.
 *
 * Idempotente por construção — `unique (order_id, destination)` na fila e
 * `where not exists` no evento do funil. Pode ser chamada as vezes que forem.
 */
export async function fireConversions(
  orderId: string,
  totalCents: number,
  supabase: SupabaseClient,
): Promise<void> {
  try {
    // Fonte de verdade do funil (§16.6): grava-se server-side para a venda
    // contar mesmo que o cliente feche a aba antes de ver o estado 'pago'.
    await supabase.rpc('record_server_purchase_event', {
      p_order_id: orderId,
      p_value_cents: totalCents,
    });
  } catch {
    // funil é observação, nunca bloqueia o resto
  }

  try {
    const { data: queued } = await supabase.rpc('enqueue_conversions', { p_order_id: orderId });
    if (!queued) return; // balcão, ou pedido ainda sem dinheiro confirmado
    await drainConversionJobs(supabase, 10);
  } catch (err) {
    // O trabalho ficou na fila; o cron trata dele. Só se regista o tropeção.
    const message = err instanceof Error ? err.message : String(err);
    try {
      await supabase
        .from('event_log')
        .insert({ order_id: orderId, type: 'conversion.enqueue_error', payload: { error: message } });
    } catch {
      // log de log não pode falhar visivelmente
    }
  }
}
