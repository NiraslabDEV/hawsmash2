import { cents, formatMT } from '@delivery/core';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export type CashCloseReport = {
  session_id: string;
  store_id: string;
  store_short_name: string;
  shift_label: string;
  opened_at: string;
  closed_at: string;
  opening_float_cents: number;
  cash_sales_cents: number;
  sangria_cents: number;
  reforco_cents: number;
  despesa_cents: number;
  expected_cash_cents: number;
  counted_cash_cents: number;
  difference_cents: number;
  difference_reason?: string | null;
  total_pedidos: number;
  total_faturado_cents: number;
  payments: { cash: number; mpesa: number; emola: number; credit_card: number };
  closed_by_name?: string | null;
};

type CashSessionRow = {
  id: string;
  store_id: string;
  shift_label: string;
  opened_at: string;
  closed_at: string | null;
  opening_float_cents: number;
  counted_cash_cents: number | null;
  difference_cents: number | null;
  difference_reason: string | null;
  report: unknown;
};

const amount = (value: unknown) => (Number.isInteger(value) ? (value as number) : 0);
const mt = (value: number) => formatMT(cents(value));
const signedMT = (value: number) => value < 0 ? `-${mt(Math.abs(value))}` : mt(value);
const dateTime = (iso: string) =>
  new Intl.DateTimeFormat('pt-PT', {
    timeZone: 'Africa/Maputo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));

export function cashCloseReportFromSession(
  session: CashSessionRow,
  storeShortName: string,
  closedByName?: string | null,
): CashCloseReport {
  if (!session.closed_at) throw new Error('cash_session_still_open');
  const raw = (session.report ?? {}) as Record<string, unknown>;
  const payments = (raw.payments ?? {}) as Record<string, unknown>;
  return {
    session_id: session.id,
    store_id: session.store_id,
    store_short_name: storeShortName,
    shift_label: session.shift_label,
    opened_at: session.opened_at,
    closed_at: session.closed_at,
    opening_float_cents: session.opening_float_cents,
    cash_sales_cents: amount(raw.cash_sales_cents),
    sangria_cents: amount(raw.sangria_cents),
    reforco_cents: amount(raw.reforco_cents),
    despesa_cents: amount(raw.despesa_cents),
    expected_cash_cents: amount(raw.expected_cash_cents),
    counted_cash_cents: session.counted_cash_cents ?? amount(raw.counted_cash_cents),
    difference_cents: session.difference_cents ?? amount(raw.difference_cents),
    difference_reason: session.difference_reason,
    total_pedidos: amount(raw.total_pedidos),
    total_faturado_cents: amount(raw.total_faturado_cents),
    payments: {
      cash: amount(payments.cash),
      mpesa: amount(payments.mpesa),
      emola: amount(payments.emola),
      credit_card: amount(payments.credit_card),
    },
    closed_by_name: closedByName,
  };
}

export async function buildCashClosePdf(report: CashCloseReport): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Fecho de Caixa — HAWSMASH ${report.store_short_name}`);
  pdf.setSubject(report.shift_label);
  pdf.setCreator('HAWSMASH 2.0');
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([595.28, 841.89]);
  const gold = rgb(0.78, 0.48, 0.08);
  const dark = rgb(0.12, 0.09, 0.07);
  let y = 790;

  const write = (text: string, options?: { size?: number; strong?: boolean; color?: ReturnType<typeof rgb> }) => {
    page.drawText(text, {
      x: 52,
      y,
      size: options?.size ?? 11,
      font: options?.strong ? bold : regular,
      color: options?.color ?? dark,
    });
    y -= (options?.size ?? 11) + 8;
  };
  const row = (label: string, value: string, strong = false) => {
    page.drawText(label, { x: 52, y, size: 10, font: strong ? bold : regular, color: dark });
    const width = (strong ? bold : regular).widthOfTextAtSize(value, 10);
    page.drawText(value, { x: 543 - width, y, size: 10, font: strong ? bold : regular, color: dark });
    y -= 22;
  };

  write(`HAWSMASH ${report.store_short_name.toUpperCase()}`, { size: 12, strong: true, color: gold });
  write('Fecho de Caixa', { size: 24, strong: true });
  write(report.shift_label, { size: 11 });
  write(`${dateTime(report.opened_at)} a ${dateTime(report.closed_at)}`, { size: 10 });
  y -= 14;
  write('Gaveta', { size: 13, strong: true, color: gold });
  row('Fundo inicial', mt(report.opening_float_cents));
  row('Vendas em dinheiro', mt(report.cash_sales_cents));
  row('Sangrias', `-${mt(report.sangria_cents)}`);
  row('Reforços', mt(report.reforco_cents));
  row('Despesas', `-${mt(report.despesa_cents)}`);
  row('Esperado na gaveta', mt(report.expected_cash_cents), true);
  row('Valor contado', mt(report.counted_cash_cents), true);
  row('Diferença', signedMT(report.difference_cents), true);
  y -= 8;
  write('Pagamentos por método', { size: 13, strong: true, color: gold });
  row('Dinheiro', mt(report.payments.cash));
  row('M-Pesa', mt(report.payments.mpesa));
  row('e-Mola', mt(report.payments.emola));
  row('Cartão', mt(report.payments.credit_card));
  row('Total facturado', mt(report.total_faturado_cents), true);
  row('Pedidos', String(report.total_pedidos));
  if (report.difference_reason) {
    y -= 8;
    write('Motivo da diferença', { size: 13, strong: true, color: gold });
    write(report.difference_reason.slice(0, 110), { size: 10 });
  }
  if (report.closed_by_name) write(`Fechado por: ${report.closed_by_name}`, { size: 10 });

  return pdf.save();
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  })[character]!);

export function cashCloseEmailHtml(report: CashCloseReport): string {
  const rows = [
    ['Fundo inicial', mt(report.opening_float_cents)],
    ['Vendas em dinheiro', mt(report.cash_sales_cents)],
    ['Sangrias', `-${mt(report.sangria_cents)}`],
    ['Reforços', mt(report.reforco_cents)],
    ['Despesas', `-${mt(report.despesa_cents)}`],
    ['Esperado na gaveta', mt(report.expected_cash_cents)],
    ['Valor contado', mt(report.counted_cash_cents)],
    ['Diferença', signedMT(report.difference_cents)],
    ['M-Pesa', mt(report.payments.mpesa)],
    ['e-Mola', mt(report.payments.emola)],
    ['Cartão', mt(report.payments.credit_card)],
  ];
  return `<!doctype html><html lang="pt"><body style="font-family:Arial,sans-serif;background:#0a0807;color:#f6f1e6;padding:24px"><main style="max-width:560px;margin:auto;background:#151310;padding:24px;border-radius:16px"><h1 style="color:#e5a93c">HAWSMASH ${escapeHtml(report.store_short_name)} — Fecho de Caixa</h1><p>${escapeHtml(report.shift_label)} · ${dateTime(report.opened_at)} a ${dateTime(report.closed_at)}</p><table style="width:100%;border-collapse:collapse">${rows.map(([label, value]) => `<tr><td style="padding:8px;border-bottom:1px solid #332a22">${label}</td><td style="padding:8px;text-align:right;border-bottom:1px solid #332a22"><strong>${value}</strong></td></tr>`).join('')}</table>${report.difference_reason ? `<p><strong>Motivo da diferença:</strong> ${escapeHtml(report.difference_reason)}</p>` : ''}${report.closed_by_name ? `<p>Fechado por: ${escapeHtml(report.closed_by_name)}</p>` : ''}</main></body></html>`;
}
