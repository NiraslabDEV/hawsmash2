import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

import { getBrand } from '@/lib/brand/server';
import { isEmailConfigured, sendMail } from '@/lib/email/transport';
import { fetchPlaceSummary } from '@/lib/google/places';
import {
  lastClosedMonth,
  monthlyEmailHtml,
  monthlySubject,
  parseMonthParam,
  reportRecipients,
  type GoogleSection,
  type MonthlyDigest,
  type MonthlyStore,
} from '@/lib/reports/monthly';

export const dynamic = 'force-dynamic';

/**
 * Resumo do mês ao dono (1096), no dia 1: vendas de cada loja e a loja no Google.
 *
 * `?month=2026-09` escolhe o mês; sem ele, é o último mês fechado.
 * O mesmo mês não sai duas vezes — um scheduler que repete não enche a caixa do
 * dono. `?force=1` reenvia de propósito.
 */
export async function GET(request: Request) {
  // Esta rota manda email e chama uma API paga: sem segredo fica fechada.
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ ok: false, error: 'cron_secret_not_configured' }, { status: 503 });
  }
  if ((request.headers.get('authorization') ?? '') !== `Bearer ${cronSecret}`) {
    return new Response('unauthorized', { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ ok: false, error: 'supabase_not_configured' }, { status: 503 });
  }

  const { searchParams } = new URL(request.url);
  const parsed = parseMonthParam(searchParams.get('month'));
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, error: 'invalid_month' }, { status: 400 });
  }
  const force = searchParams.get('force') === '1';

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase.rpc('get_monthly_digest', { p_month: parsed.month });
  if (error) {
    console.error('[cron/monthly]', error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  const digest = data as MonthlyDigest;

  if (!force) {
    const { data: sent } = await supabase
      .from('event_log')
      .select('id')
      .eq('type', 'monthly_digest.sent')
      .eq('payload->>month', digest.month)
      .eq('payload->>delivery', 'sent')
      .limit(1);
    if (sent && sent.length > 0) {
      return NextResponse.json({ ok: true, month: digest.month, skipped: 'already_sent' });
    }
  }

  const google = await readGoogle(supabase, digest);

  const recipients = reportRecipients(process.env.OWNER_EMAIL, digest.stores);
  let delivery: 'sent' | 'skipped_no_key' | 'skipped_no_recipient' | 'failed' = 'sent';

  const brandName = (await getBrand()).name;
  if (!(await isEmailConfigured())) delivery = 'skipped_no_key';
  else if (recipients.length === 0) delivery = 'skipped_no_recipient';
  else {
    const result = await sendMail({
      to: recipients,
      subject: monthlySubject(brandName, digest.month),
      html: monthlyEmailHtml({ brandName, digest, google }),
    });
    if (!result.ok) {
      console.error('[cron/monthly] envio falhou:', result.error);
      delivery = 'failed';
    }
  }

  if (digest.stores.length > 0) {
    await supabase.from('event_log').insert(
      digest.stores.map((store) => ({
        store_id: store.store_id,
        type: 'monthly_digest.sent',
        payload: {
          month: digest.month,
          orders_count: store.orders_count,
          revenue_cents: store.revenue_cents,
          google: google[store.store_id]?.status ?? 'failed',
          delivery,
          forced: force,
        },
      })),
    );
  }

  return NextResponse.json({
    ok: true,
    month: digest.month,
    stores: digest.stores.length,
    delivery,
    google: Object.fromEntries(
      digest.stores.map((store) => [store.store_name, google[store.store_id]?.status ?? 'failed']),
    ),
  });
}

/**
 * O Google de cada loja. A fotografia já guardada para o mês manda — um reenvio
 * mostra os mesmos números. Sem ela, só se lê na hora o último mês fechado.
 */
async function readGoogle(
  supabase: SupabaseClient,
  digest: MonthlyDigest,
): Promise<Record<string, GoogleSection>> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  const canReadLive = digest.month === lastClosedMonth();

  const entries = await Promise.all(
    digest.stores.map(async (store): Promise<[string, GoogleSection]> => {
      if (store.google_snapshot) {
        return [store.store_id, fromSnapshot(store)];
      }
      if (!store.google_place_id) return [store.store_id, { status: 'no_place_id' }];
      if (!canReadLive) return [store.store_id, { status: 'not_captured' }];
      if (!apiKey) return [store.store_id, { status: 'no_key' }];

      const result = await fetchPlaceSummary(store.google_place_id, apiKey);
      if (!result.ok) {
        console.error(`[cron/monthly] Google ${store.store_name}:`, result.error);
        return [store.store_id, { status: 'failed' }];
      }

      const { error } = await supabase.from('google_profile_snapshots').upsert(
        {
          store_id: store.store_id,
          month: digest.month,
          place_id: store.google_place_id,
          rating: result.place.rating,
          review_count: result.place.reviewCount,
        },
        { onConflict: 'store_id,month', ignoreDuplicates: true },
      );
      // Sem fotografia o email sai na mesma; só o próximo mês perde a comparação.
      if (error) console.error(`[cron/monthly] fotografia ${store.store_name}:`, error.message);

      return [
        store.store_id,
        {
          status: 'ok',
          rating: result.place.rating,
          reviewCount: result.place.reviewCount,
          previous: store.google_previous,
          mapsUri: result.place.mapsUri,
        },
      ];
    }),
  );

  return Object.fromEntries(entries);
}

function fromSnapshot(store: MonthlyStore): GoogleSection {
  return {
    status: 'ok',
    rating: store.google_snapshot?.rating ?? null,
    reviewCount: store.google_snapshot?.review_count ?? null,
    previous: store.google_previous,
    mapsUri: store.google_place_id
      ? `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(store.google_place_id)}`
      : null,
  };
}
