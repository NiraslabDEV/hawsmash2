import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { createClient } from '@supabase/supabase-js';

// Envia email de fecho de caixa ao owner.
// Body: { to: string, report?: object } (report inline)
//    ou { to: string, sessionId: string } (reenvio → busca da BD)

const fmtMT = (cents: number) =>
  `${(cents / 100).toLocaleString('pt-MZ', { minimumFractionDigits: 2 })} MT`;

const fmtDT = (iso: string) =>
  new Date(iso).toLocaleString('pt-MZ', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

export async function POST(request: Request) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'RESEND_API_KEY not configured' }, { status: 503 });
  }

  const body = await request.json();
  const { to, report: inlineReport, sessionId } = body as {
    to: string;
    report?: Record<string, unknown>;
    sessionId?: string;
  };

  if (!to) {
    return NextResponse.json({ error: 'Missing: to' }, { status: 400 });
  }

  let report = inlineReport;
  let session: Record<string, unknown> | null = null;

  // Reenvio: buscar relatório da BD
  if (!report && sessionId) {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    const { data, error } = await supabase
      .from('cash_sessions')
      .select('*')
      .eq('id', sessionId)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: 'Sessão não encontrada' }, { status: 404 });
    }
    session = data as Record<string, unknown>;
    report = session.report as Record<string, unknown>;
  }

  if (!report) {
    return NextResponse.json({ error: 'Missing: report or sessionId' }, { status: 400 });
  }

  const openedAt  = (report.opened_at  ?? session?.opened_at)  as string | undefined;
  const closedAt  = (report.closed_at  ?? session?.closed_at)  as string | undefined;
  const expected  = (report.total_faturado_cents ?? session?.expected_cash_cents ?? 0) as number;
  const counted   = (report.counted_cash_cents   ?? session?.counted_cash_cents  ?? 0) as number;
  const diff      = (report.difference_cents     ?? session?.difference_cents    ?? 0) as number;
  const pedidos   = (report.total_pedidos   ?? 0) as number;
  const entregues = (report.total_entregues ?? 0) as number;
  const notes     = (report.notes ?? session?.notes) as string | undefined;

  const items = (report.items_vendidos as Array<{ name: string; qty: number; total_cents: number }>) ?? [];
  const diffColor = diff === 0 ? '#e5a93c' : diff > 0 ? '#4ade80' : '#f87171';
  const diffText  = diff >= 0 ? `+${fmtMT(diff)}` : fmtMT(diff);

  const itemsHtml = items
    .map(
      (i) => `
      <tr>
        <td style="padding:6px 0;border-bottom:1px solid #1a1614">${i.name}</td>
        <td style="padding:6px 0;border-bottom:1px solid #1a1614;text-align:center">${i.qty}</td>
        <td style="padding:6px 0;border-bottom:1px solid #1a1614;text-align:right;color:#e5a93c">${fmtMT(i.total_cents)}</td>
      </tr>`
    )
    .join('');

  const html = `<!DOCTYPE html>
<html lang="pt">
<head><meta charset="UTF-8"><title>Fecho de Caixa</title></head>
<body style="font-family:Arial,sans-serif;background:#0a0807;color:#e5e5e5;margin:0;padding:32px">
  <div style="max-width:520px;margin:auto;background:#110d0a;border:1px solid #1a1614;border-radius:12px;padding:28px">
    <h1 style="color:#e5a93c;font-size:20px;margin:0 0 4px">Fecho de Caixa</h1>
    ${openedAt && closedAt ? `<p style="color:#a8a29e;font-size:13px;margin:0 0 24px">${fmtDT(openedAt)} → ${fmtDT(closedAt)}</p>` : ''}

    <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #1a1614;color:#a8a29e;font-size:14px">Pedidos Confirmados</td>
        <td style="padding:8px 0;border-bottom:1px solid #1a1614;text-align:right;font-size:14px">${pedidos}</td>
      </tr>
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #1a1614;color:#a8a29e;font-size:14px">Entregues</td>
        <td style="padding:8px 0;border-bottom:1px solid #1a1614;text-align:right;font-size:14px">${entregues}</td>
      </tr>
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #1a1614;color:#a8a29e;font-size:14px">Total Esperado</td>
        <td style="padding:8px 0;border-bottom:1px solid #1a1614;text-align:right;font-size:18px;font-weight:bold;color:#e5a93c">${fmtMT(expected)}</td>
      </tr>
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #1a1614;color:#a8a29e;font-size:14px">Valor Contado</td>
        <td style="padding:8px 0;border-bottom:1px solid #1a1614;text-align:right;font-size:18px;font-weight:bold">${fmtMT(counted)}</td>
      </tr>
      <tr>
        <td style="padding:8px 0;color:#a8a29e;font-size:14px">Diferença</td>
        <td style="padding:8px 0;text-align:right;font-size:16px;font-weight:bold;color:${diffColor}">${diffText}</td>
      </tr>
    </table>

    ${
      notes
        ? `<p style="font-size:13px;color:#a8a29e;margin-bottom:20px">Notas: ${notes}</p>`
        : ''
    }

    ${
      itemsHtml
        ? `<h2 style="color:#e5a93c;font-size:14px;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px">Itens Vendidos</h2>
    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:20px">
      <thead>
        <tr>
          <th style="text-align:left;color:#a8a29e;font-weight:normal;padding-bottom:6px">Produto</th>
          <th style="text-align:center;color:#a8a29e;font-weight:normal;padding-bottom:6px">Qtd</th>
          <th style="text-align:right;color:#a8a29e;font-weight:normal;padding-bottom:6px">Total</th>
        </tr>
      </thead>
      <tbody>${itemsHtml}</tbody>
    </table>`
        : ''
    }

    <p style="font-size:11px;color:#666;text-align:center;margin-top:8px">Delivery OS · ${new Date().toLocaleString('pt-MZ')}</p>
  </div>
</body>
</html>`;

  try {
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL || 'noreply@delivery-os.com',
      to,
      subject: `Fecho de Caixa — ${closedAt ? fmtDT(closedAt) : new Date().toLocaleDateString('pt-MZ')}`,
      html,
    });

    if (error) {
      console.error('Resend error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('send-cash-close-email error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
