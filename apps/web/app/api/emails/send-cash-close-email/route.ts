import { NextResponse } from 'next/server';
import { isEmailConfigured, sendMail } from '@/lib/email/transport';

import { cashCloseEmailHtml, cashCloseReportFromSession } from '@/lib/cash/report';
import { createCashServerClient } from '@/lib/cash/server-client';

export async function POST(request: Request) {
  if (!isEmailConfigured()) {
    return NextResponse.json({ error: 'Serviço de email não configurado.' }, { status: 503 });
  }

  let sessionId: string | undefined;
  try {
    const body = await request.json() as { sessionId?: unknown };
    if (typeof body.sessionId === 'string') sessionId = body.sessionId;
  } catch {
    return NextResponse.json({ error: 'Pedido inválido.' }, { status: 400 });
  }
  if (!sessionId) {
    return NextResponse.json({ error: 'Sessão obrigatória.' }, { status: 400 });
  }

  const supabase = await createCashServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Autenticação necessária.' }, { status: 401 });

  const { data: session, error } = await supabase
    .from('cash_sessions')
    .select('id,store_id,shift_label,opened_at,closed_at,opening_float_cents,counted_cash_cents,difference_cents,difference_reason,closed_by,report')
    .eq('id', sessionId)
    .single();
  if (error || !session || !session.closed_at) {
    return NextResponse.json({ error: 'Fecho não encontrado nesta loja.' }, { status: 404 });
  }

  const [{ data: store }, { data: closer }, { data: settings }] = await Promise.all([
    supabase.from('stores').select('short_name').eq('id', session.store_id).single(),
    session.closed_by
      ? supabase.from('staff_profiles').select('full_name').eq('user_id', session.closed_by).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from('settings').select('owner_email').eq('id', 1).single(),
  ]);
  if (!settings?.owner_email) {
    return NextResponse.json({ error: 'Email do dono não configurado.' }, { status: 503 });
  }

  const report = cashCloseReportFromSession(
    session,
    store?.short_name ?? 'Loja',
    closer?.full_name,
  );
  const result = await sendMail({
    to: settings.owner_email,
    subject: `Fecho de Caixa — HAWSMASH ${report.store_short_name}`,
    html: cashCloseEmailHtml(report),
  });
  if (!result.ok) {
    console.error('[cash-close-email]', result.error);
    return NextResponse.json({ error: 'Não foi possível enviar o email.' }, { status: 502 });
  }

  return NextResponse.json({ success: true });
}
