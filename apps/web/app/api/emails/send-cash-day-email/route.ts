import { NextResponse } from 'next/server';
import { isEmailConfigured, sendMail } from '@/lib/email/transport';

import { parseCashDayReport } from '@/lib/cash/day';
import { cashDayEmailHtml } from '@/lib/cash/report';
import { getBrand } from '@/lib/brand/server';
import { createCashServerClient } from '@/lib/cash/server-client';

/**
 * O resumo do fecho do dia (1091) para o dono. Best-effort: o POS chama e não
 * espera — o fecho já está gravado e o talão já está na fila.
 */
export async function POST(request: Request) {
  if (!isEmailConfigured()) {
    return NextResponse.json({ error: 'Serviço de email não configurado.' }, { status: 503 });
  }

  let dayCloseId: string | undefined;
  try {
    const body = await request.json() as { dayCloseId?: unknown };
    if (typeof body.dayCloseId === 'string') dayCloseId = body.dayCloseId;
  } catch {
    return NextResponse.json({ error: 'Pedido inválido.' }, { status: 400 });
  }
  if (!dayCloseId) {
    return NextResponse.json({ error: 'Fecho do dia obrigatório.' }, { status: 400 });
  }

  const supabase = await createCashServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Autenticação necessária.' }, { status: 401 });

  // RLS: só a equipa da loja (sem a cozinha) lê o fecho do dia.
  const { data: day, error } = await supabase
    .from('cash_day_closes')
    .select('id,store_id,report')
    .eq('id', dayCloseId)
    .single();
  if (error || !day) {
    return NextResponse.json({ error: 'Fecho do dia não encontrado nesta loja.' }, { status: 404 });
  }
  const report = parseCashDayReport(day.report);
  if (!report) {
    return NextResponse.json({ error: 'Fecho do dia ilegível.' }, { status: 422 });
  }

  const [{ data: store }, { data: settings }] = await Promise.all([
    supabase.from('stores').select('short_name').eq('id', day.store_id).single(),
    supabase.from('settings').select('owner_email').eq('id', 1).single(),
  ]);
  if (!settings?.owner_email) {
    return NextResponse.json({ error: 'Email do dono não configurado.' }, { status: 503 });
  }

  const storeShortName = store?.short_name ?? 'Loja';
  const brandName = (await getBrand()).name;
  const result = await sendMail({
    to: settings.owner_email,
    subject: `Fecho do Dia — ${brandName} ${storeShortName}`,
    html: cashDayEmailHtml(report, storeShortName, brandName),
  });
  if (!result.ok) {
    console.error('[cash-day-email]', result.error);
    return NextResponse.json({ error: 'Não foi possível enviar o email.' }, { status: 502 });
  }

  return NextResponse.json({ success: true });
}
