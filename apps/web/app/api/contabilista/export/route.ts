import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { buildMonthFile, checkExport, type MonthExport, type Purchase } from '@/lib/escritorio/ficheiros';
import { officeError } from '@/lib/escritorio/regras';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  token: z.string().regex(/^[0-9a-f]{48}$/),
  year: z.coerce.number().int().min(2020).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  format: z.enum(['csv', 'xml', 'compras']),
});
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
const fail = (error: string, status: number) => NextResponse.json({ error }, { status, headers });

/**
 * O contabilista descarrega o mês com a ligação que o dono lhe deu (ADR 0014). O token vai no corpo (POST),
 * não no URL, para não ficar em registos de servidores pelo caminho. Quem valida é a BD (`accountant_month_export`).
 */
export async function POST(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return fail('Indisponível.', 503);
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail('Pedido inválido.', 400);
  const { token, year, month, format } = parsed.data;

  const supabase = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { data, error } = await supabase.rpc('accountant_month_export', { p_token: token, p_year: year, p_month: month });
  if (error) return fail(officeError(error.message), /accountant_invalid/.test(error.message) ? 403 : 500);

  const pack = data as MonthExport & { purchases: Purchase[] };
  if (format !== 'compras') {
    const check = checkExport(pack);
    if (!check.ok) return fail(check.error, 409);
  }
  const file = buildMonthFile(format, pack, pack.purchases ?? []);
  return new NextResponse(file.body, {
    headers: { ...headers, 'Content-Type': file.contentType, 'Content-Disposition': `attachment; filename="${file.fileName}"` },
  });
}
