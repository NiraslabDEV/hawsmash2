import { NextResponse } from 'next/server';

import { buildCashClosePdf, cashCloseReportFromSession } from '@/lib/cash/report';
import { createCashServerClient } from '@/lib/cash/server-client';

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const supabase = await createCashServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Autenticação necessária.' }, { status: 401 });

  const { data: session, error } = await supabase
    .from('cash_sessions')
    .select('id,store_id,shift_label,opened_at,closed_at,opening_float_cents,counted_cash_cents,difference_cents,difference_reason,closed_by,report')
    .eq('id', params.id)
    .single();
  if (error || !session) {
    return NextResponse.json({ error: 'Sessão não encontrada nesta loja.' }, { status: 404 });
  }
  if (!session.closed_at) {
    return NextResponse.json({ error: 'A sessão ainda está aberta.' }, { status: 409 });
  }

  const [{ data: store }, { data: closer }] = await Promise.all([
    supabase.from('stores').select('short_name').eq('id', session.store_id).single(),
    session.closed_by
      ? supabase.from('staff_profiles').select('full_name').eq('user_id', session.closed_by).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const report = cashCloseReportFromSession(
    session,
    store?.short_name ?? 'Loja',
    closer?.full_name,
  );
  const pdf = await buildCashClosePdf(report);
  const safeStore = (store?.short_name ?? 'loja').toLowerCase().replace(/[^a-z0-9]+/g, '-');

  return new NextResponse(Buffer.from(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="fecho-caixa-${safeStore}-${session.id}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
