import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Relatório HTML de fecho de caixa — abre em nova aba e dispara window.print()
// O browser gera o PDF via "Guardar como PDF" no diálogo de impressão.

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: session, error } = await supabase
    .from('cash_sessions')
    .select('*')
    .eq('id', params.id)
    .single();

  if (error || !session) {
    return new NextResponse('Sessão não encontrada.', { status: 404 });
  }

  if (!session.closed_at) {
    return new NextResponse('Sessão ainda em aberto.', { status: 400 });
  }

  const report = session.report as Record<string, unknown>;

  const fmtMT = (cents: number) =>
    `${(cents / 100).toLocaleString('pt-MZ', { minimumFractionDigits: 2 })} MT`;

  const fmtDT = (iso: string) =>
    new Date(iso).toLocaleString('pt-MZ', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });

  const items = (report.items_vendidos as Array<{ name: string; qty: number; total_cents: number }>) ?? [];
  const byMethod = (report.por_metodo as Record<string, { count: number; total_cents: number }>) ?? {};
  const byFulfill = (report.por_entrega as Record<string, { count: number; total_cents: number }>) ?? {};

  const diff = (session.difference_cents ?? 0) as number;
  const diffText = diff >= 0 ? `+${fmtMT(diff)}` : fmtMT(diff);
  const diffColor = diff === 0 ? '#e5a93c' : diff > 0 ? '#4ade80' : '#f87171';

  const itemRows = items
    .map(
      (i) => `
    <tr>
      <td>${i.name}</td>
      <td style="text-align:center">${i.qty}</td>
      <td style="text-align:right">${fmtMT(i.total_cents)}</td>
    </tr>`
    )
    .join('');

  const methodRows = Object.entries(byMethod)
    .map(
      ([m, v]) => `
    <tr>
      <td>${m.toUpperCase()}</td>
      <td style="text-align:center">${v.count}</td>
      <td style="text-align:right">${fmtMT(v.total_cents)}</td>
    </tr>`
    )
    .join('');

  const fulfillRows = Object.entries(byFulfill)
    .map(
      ([f, v]) => `
    <tr>
      <td>${f === 'pickup' ? 'Levantamento' : 'Entrega'}</td>
      <td style="text-align:center">${v.count}</td>
      <td style="text-align:right">${fmtMT(v.total_cents)}</td>
    </tr>`
    )
    .join('');

  const html = `<!DOCTYPE html>
<html lang="pt">
<head>
  <meta charset="UTF-8">
  <title>Fecho de Caixa</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Courier New', monospace;
      background: #fff;
      color: #111;
      padding: 32px;
      max-width: 600px;
      margin: auto;
    }
    h1 { font-size: 22px; text-align: center; margin-bottom: 4px; }
    .sub { text-align: center; color: #666; font-size: 13px; margin-bottom: 24px; }
    .section { margin-bottom: 20px; }
    .section h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 1px; color: #666; border-bottom: 1px solid #ddd; padding-bottom: 4px; margin-bottom: 10px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    td, th { padding: 5px 4px; }
    th { text-align: left; font-weight: bold; font-size: 12px; color: #666; }
    .highlight { font-size: 18px; font-weight: bold; }
    .diff { font-weight: bold; color: ${diffColor}; }
    .footer { margin-top: 32px; font-size: 11px; color: #999; text-align: center; }
    @media print {
      body { padding: 16px; }
      button { display: none !important; }
    }
  </style>
</head>
<body>
  <h1>Fecho de Caixa</h1>
  <div class="sub">
    ${fmtDT(session.opened_at as string)} → ${fmtDT(session.closed_at as string)}
  </div>

  <div class="section">
    <h2>Resumo</h2>
    <table>
      <tr><td>Pedidos Confirmados</td><td style="text-align:right">${report.total_pedidos ?? 0}</td></tr>
      <tr><td>Entregues</td><td style="text-align:right">${report.total_entregues ?? 0}</td></tr>
      <tr><td>Total Esperado</td><td style="text-align:right" class="highlight">${fmtMT((report.total_faturado_cents as number) ?? 0)}</td></tr>
      <tr><td>Valor Contado</td><td style="text-align:right" class="highlight">${fmtMT(session.counted_cash_cents as number)}</td></tr>
      <tr><td>Diferença</td><td style="text-align:right" class="diff">${diffText}</td></tr>
    </table>
    ${session.notes ? `<p style="margin-top:8px;font-size:12px;color:#666">Notas: ${session.notes}</p>` : ''}
  </div>

  ${
    itemRows
      ? `<div class="section">
    <h2>Itens Vendidos</h2>
    <table>
      <thead><tr><th>Produto</th><th style="text-align:center">Qtd</th><th style="text-align:right">Total</th></tr></thead>
      <tbody>${itemRows}</tbody>
    </table>
  </div>`
      : ''
  }

  ${
    methodRows
      ? `<div class="section">
    <h2>Por Método de Pagamento</h2>
    <table>
      <thead><tr><th>Método</th><th style="text-align:center">Qtd</th><th style="text-align:right">Total</th></tr></thead>
      <tbody>${methodRows}</tbody>
    </table>
  </div>`
      : ''
  }

  ${
    fulfillRows
      ? `<div class="section">
    <h2>Por Tipo de Entrega</h2>
    <table>
      <thead><tr><th>Tipo</th><th style="text-align:center">Qtd</th><th style="text-align:right">Total</th></tr></thead>
      <tbody>${fulfillRows}</tbody>
    </table>
  </div>`
      : ''
  }

  <div class="footer">Gerado em ${new Date().toLocaleString('pt-MZ')} · Delivery OS</div>

  <script>window.addEventListener('load', () => window.print());</script>
</body>
</html>`;

  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
