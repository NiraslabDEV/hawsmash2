import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

import { getBrand } from '@/lib/brand/server';
import { cronUnauthorized } from '@/lib/cron/auth';
import { isEmailConfigured, sendMail } from '@/lib/email/transport';
import { newAlerts, officeAlertEmail, type OfficeAlert } from '@/lib/escritorio/avisos';
import { maputoToday } from '@/lib/escritorio/regras';

export const dynamic = 'force-dynamic';

/**
 * Cron do Escritório (ADR 0014). Duas coisas, nenhuma bloqueia a outra:
 * 1. emitir as facturas que ficaram pendentes (vendas pagas sem documento, por falha técnica);
 * 2. avisar o dono dos prazos, das validades e da facturação — um email por assunto e por dia.
 */
export async function GET(request: Request) {
  const denied = cronUnauthorized(request);
  if (denied) return denied;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'supabase_not_configured' }, { status: 503 });
  const svc = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  let emitted: number | null = null;
  const pending = await svc.rpc('fiscal_emit_pending', { p_limit: 100 });
  if (pending.error) console.error('[cron/escritorio] pendentes:', pending.error.message);
  else emitted = pending.data as number;

  const { data, error } = await svc.rpc('office_alerts_all');
  if (error) {
    console.error('[cron/escritorio] avisos:', error.message);
    return NextResponse.json({ ok: false, emitted, error: error.message }, { status: 500 });
  }
  const alerts = (data ?? []) as OfficeAlert[];
  const today = maputoToday();
  const { data: sentRows } = await svc
    .from('event_log')
    .select('payload')
    .eq('type', 'office.alert_sent')
    .gte('created_at', `${today}T00:00:00+02:00`);
  const sentKeys = new Set((sentRows ?? []).map((row) => (row.payload as { key?: string } | null)?.key ?? ''));
  const fresh = newAlerts(alerts, sentKeys);
  if (fresh.length === 0) return NextResponse.json({ ok: true, emitted, alerts: alerts.length, sent: 0 });

  const { data: stores } = await svc.from('stores').select('owner_email');
  const recipients = Array.from(new Set(
    [process.env.OWNER_EMAIL, ...(stores ?? []).map((s) => s.owner_email as string | null)]
      .filter((value): value is string => Boolean(value && value.includes('@'))),
  ));
  const base = process.env.APP_BASE_URL?.trim().replace(/\/+$/, '');
  const panelUrl = base ? `${/^https?:\/\//.test(base) ? base : `https://${base}`}/escritorio` : null;

  let delivery: 'sent' | 'skipped_no_key' | 'skipped_no_recipient' | 'failed' = 'sent';
  if (!(await isEmailConfigured())) delivery = 'skipped_no_key';
  else if (recipients.length === 0) delivery = 'skipped_no_recipient';
  else {
    const { subject, html } = officeAlertEmail(fresh, (await getBrand()).name, panelUrl);
    const result = await sendMail({ event: 'alerts', to: recipients, subject, html });
    if (!result.ok) {
      console.error('[cron/escritorio] envio falhou:', result.error);
      delivery = 'failed';
    }
  }
  // Fica registado mesmo sem email: é o que evita repetir o aviso no mesmo dia.
  if (delivery !== 'failed') {
    await svc.from('event_log').insert(fresh.map((alert) => ({
      store_id: alert.store_id, type: 'office.alert_sent', payload: { key: alert.key, kind: alert.kind, delivery },
    })));
  }
  return NextResponse.json({ ok: true, emitted, alerts: alerts.length, sent: fresh.length, delivery });
}
