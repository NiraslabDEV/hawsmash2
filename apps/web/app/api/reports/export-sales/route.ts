import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

type ExportRow = {
  store_name: string;
  sale_date: string;
  sale_time: string;
  order_number: string;
  daily_number: number | null;
  channel: string;
  order_status: string;
  customer_name: string;
  customer_phone: string | null;
  subtotal_cents: number;
  delivery_fee_cents: number;
  order_total_cents: number;
  payment_method: string;
  payment_amount_cents: number;
  payment_status: string;
  payment_reference: string | null;
};

const CSV_HEADER = [
  'loja', 'data', 'hora', 'numero_pedido', 'numero_dia', 'canal', 'estado_pedido',
  'cliente', 'telefone', 'subtotal_mt', 'taxa_entrega_mt', 'total_pedido_mt',
  'forma_pagamento', 'valor_pagamento_mt', 'estado_pagamento', 'referencia_pagamento',
];

function csvField(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function centsToMt(cents: number): string {
  return (cents / 100).toFixed(2);
}

function rowToCsvLine(row: ExportRow): string {
  return [
    row.store_name,
    row.sale_date,
    row.sale_time,
    row.order_number,
    row.daily_number ?? '',
    row.channel,
    row.order_status,
    row.customer_name,
    row.customer_phone ?? '',
    centsToMt(row.subtotal_cents),
    centsToMt(row.delivery_fee_cents),
    centsToMt(row.order_total_cents),
    row.payment_method,
    centsToMt(row.payment_amount_cents),
    row.payment_status,
    row.payment_reference ?? '',
  ].map(csvField).join(',');
}

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get: (name: string) => cookieStore.get(name)?.value } },
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Autenticação necessária.' }, { status: 401 });
  }

  const url = new URL(request.url);
  const storeId = url.searchParams.get('store_id');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');

  const { data, error } = await supabase.rpc('export_sales_for_accounting', {
    p_store_id: storeId && storeId !== 'all' ? storeId : null,
    p_from: from ? new Date(from).toISOString() : null,
    p_to: to ? new Date(to).toISOString() : null,
  });

  if (error) {
    const status = error.message.includes('export_access_denied') ? 403 : 400;
    return NextResponse.json({ error: error.message }, { status });
  }

  const rows = (data ?? []) as ExportRow[];
  const csv = [CSV_HEADER.join(','), ...rows.map(rowToCsvLine)].join('\r\n');
  const csvWithBom = String.fromCharCode(0xfeff) + csv;
  const filename = `vendas-${from ?? 'inicio'}-a-${to ?? 'hoje'}.csv`;

  return new NextResponse(csvWithBom, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
