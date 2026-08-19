import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { Resend } from 'resend';

import {
  alertEmailHtml,
  alertSubject,
  pendingAlerts,
  type AlertRecipientStore,
  type SystemAlert,
} from '@/lib/alerts/digest';

export const dynamic = 'force-dynamic';

/**
 * Alertas automáticos (CLAUDE §11.5). Corre a cada poucos minutos: lê o estado,
 * ignora o que já foi avisado há pouco e manda um email com atalho de WhatsApp
 * para a loja. Falhar a enviar nunca é fatal — fica registado na mesma.
 */
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

  const { data: alertData, error: alertError } = await supabase.rpc('list_system_alerts');
  if (alertError) {
    console.error('[cron/alerts]', alertError.message);
    return NextResponse.json({ ok: false, error: alertError.message }, { status: 500 });
  }

  const alerts = (alertData ?? []) as SystemAlert[];
  if (alerts.length === 0) {
    return NextResponse.json({ ok: true, alerts: 0, sent: 0 });
  }

  const since = new Date(Date.now() - 6 * 60 * 60_000).toISOString();
  const { data: sentRows } = await supabase
    .from('event_log')
    .select('store_id,payload,created_at')
    .eq('type', 'alert.sent')
    .gte('created_at', since);

  const alreadySent = (sentRows ?? []).map((row) => ({
    store_id: (row.store_id as string | null) ?? '',
    kind: ((row.payload as { kind?: string } | null)?.kind ?? '') as string,
    sent_at: row.created_at as string,
  }));

  const pending = pendingAlerts(alerts, alreadySent);
  if (pending.length === 0) {
    return NextResponse.json({ ok: true, alerts: alerts.length, sent: 0, skipped: 'cooldown' });
  }

  const { data: storeRows } = await supabase
    .from('stores')
    .select('id,short_name,phone,owner_email')
    .in('id', Array.from(new Set(pending.map((alert) => alert.store_id))));

  const stores: AlertRecipientStore[] = (storeRows ?? []).map((row) => ({
    store_id: row.id as string,
    store_name: row.short_name as string,
    phone: (row.phone as string | null) ?? null,
  }));

  const recipients = Array.from(
    new Set(
      [
        process.env.OWNER_EMAIL,
        ...(storeRows ?? []).map((row) => row.owner_email as string | null),
      ].filter((value): value is string => Boolean(value && value.includes('@'))),
    ),
  );

  let delivery: 'sent' | 'skipped_no_key' | 'skipped_no_recipient' | 'failed' = 'sent';
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) delivery = 'skipped_no_key';
  else if (recipients.length === 0) delivery = 'skipped_no_recipient';
  else {
    try {
      const resend = new Resend(apiKey);
      const { error } = await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL || 'noreply@hawsmash.com',
        to: recipients,
        subject: alertSubject(pending),
        html: alertEmailHtml(pending, stores),
      });
      if (error) delivery = 'failed';
    } catch (error) {
      console.error('[cron/alerts] envio falhou:', error);
      delivery = 'failed';
    }
  }

  // O registo acontece mesmo quando o email não sai: é o que evita repetir o
  // aviso em ciclo e deixa rasto de que o sistema detectou o problema.
  await supabase.from('event_log').insert(
    pending.map((alert) => ({
      store_id: alert.store_id,
      type: 'alert.sent',
      payload: {
        kind: alert.kind,
        severity: alert.severity,
        message: alert.message,
        delivery,
        recipients: recipients.length,
      },
    })),
  );

  return NextResponse.json({ ok: true, alerts: alerts.length, sent: pending.length, delivery });
}
