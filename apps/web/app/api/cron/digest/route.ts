import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { formatMT, type Cents } from '@delivery/core';

export const dynamic = 'force-dynamic';

type DigestStore = {
  store_id: string;
  store_name: string;
  owner_email: string | null;
  orders_count: number;
  revenue_cents: number;
  payments: Record<string, number>;
  cancelled_count: number;
  cash_closes: Array<{
    closed_at: string;
    expected_cash_cents: number;
    counted_cash_cents: number;
    difference_cents: number;
    difference_reason: string | null;
  }>;
  incidents: number;
};

const mt = (value: number) => formatMT(value as Cents);

const METHOD_LABELS: Record<string, string> = {
  cash: 'Dinheiro',
  mpesa: 'M-Pesa',
  emola: 'e-Mola',
  credit_card: 'Cartão',
};

function digestHtml(day: string, stores: DigestStore[]): string {
  const blocks = stores.map((store) => {
    const payments = Object.entries(store.payments)
      .map(([method, total]) => `<li>${METHOD_LABELS[method] ?? method}: ${mt(total)}</li>`)
      .join('');
    const closes = store.cash_closes
      .map(
        (close) =>
          `<li>Fecho: esperado ${mt(close.expected_cash_cents)} · contado ${mt(
            close.counted_cash_cents,
          )} · diferença ${mt(close.difference_cents)}${
            close.difference_reason ? ` (${close.difference_reason})` : ''
          }</li>`,
      )
      .join('');

    return `<h2 style="color:#e5a93c;font-size:16px;margin:24px 0 8px">${store.store_name}</h2>
      <p><strong>${store.orders_count}</strong> pedidos · <strong>${mt(store.revenue_cents)}</strong> facturado
      ${store.cancelled_count > 0 ? ` · ${store.cancelled_count} anulado(s)` : ''}</p>
      <ul>${payments || '<li>Sem pagamentos registados</li>'}</ul>
      <ul>${closes || '<li>Sem fecho de caixa neste dia</li>'}</ul>
      <p style="color:#847e72;font-size:12px">Incidentes registados: ${store.incidents}</p>`;
  });

  return `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <h1 style="color:#e5a93c;font-size:20px">HAWSMASH · resumo de ${day}</h1>
      ${blocks.join('')}
      <p style="color:#847e72;font-size:12px">Email automático do sistema.</p>
    </div>`;
}

/** Digest diário ao dono: vendas por loja, fecho de caixa e incidentes. */
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authorization = request.headers.get('authorization') ?? '';
    if (authorization !== `Bearer ${cronSecret}`) {
      return new Response('unauthorized', { status: 401 });
    }
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ ok: false, error: 'supabase_not_configured' }, { status: 503 });
  }

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { searchParams } = new URL(request.url);
  const day = searchParams.get('day');

  const { data, error } = await supabase.rpc('get_daily_digest', { p_day: day });
  if (error) {
    console.error('[cron/digest]', error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const payload = data as { day: string; stores: DigestStore[] };
  const recipients = Array.from(
    new Set(
      [process.env.OWNER_EMAIL, ...payload.stores.map((store) => store.owner_email)].filter(
        (value): value is string => Boolean(value && value.includes('@')),
      ),
    ),
  );

  const apiKey = process.env.RESEND_API_KEY;
  let delivery: 'sent' | 'skipped_no_key' | 'skipped_no_recipient' | 'failed' = 'sent';

  if (!apiKey) delivery = 'skipped_no_key';
  else if (recipients.length === 0) delivery = 'skipped_no_recipient';
  else {
    try {
      const resend = new Resend(apiKey);
      const { error: sendError } = await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL || 'noreply@hawsmash.com',
        to: recipients,
        subject: `HAWSMASH · resumo de ${payload.day}`,
        html: digestHtml(payload.day, payload.stores),
      });
      if (sendError) delivery = 'failed';
    } catch (sendError) {
      console.error('[cron/digest] envio falhou:', sendError);
      delivery = 'failed';
    }
  }

  await supabase.from('event_log').insert(
    payload.stores.map((store) => ({
      store_id: store.store_id,
      type: 'digest.sent',
      payload: {
        day: payload.day,
        orders_count: store.orders_count,
        revenue_cents: store.revenue_cents,
        delivery,
      },
    })),
  );

  return NextResponse.json({ ok: true, day: payload.day, stores: payload.stores.length, delivery });
}
