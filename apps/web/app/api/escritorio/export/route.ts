import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { buildMonthFile, checkExport, type MonthExport, type Purchase } from '@/lib/escritorio/ficheiros';
import { officeError } from '@/lib/escritorio/regras';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  year: z.coerce.number().int().min(2020).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  format: z.enum(['csv', 'xml', 'compras']),
});
const headers = { 'Cache-Control': 'private, no-store', Vary: 'Authorization', 'X-Content-Type-Options': 'nosniff' };
const fail = (error: string, status: number) => NextResponse.json({ error }, { status, headers });

/**
 * O ficheiro do mês, para o dono (ADR 0014). Corre com a sessão de quem pede — nunca com service_role —
 * e a BD decide: `fiscal_export_month` é só do dono e fica registado.
 */
export async function GET(request: Request) {
  const token = /^Bearer ([^\s]+)$/i.exec(request.headers.get('authorization') ?? '')?.[1];
  if (!token) return fail('Volte a entrar no painel.', 401);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return fail('Exportação indisponível.', 503);
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return fail('Escolha o mês e o formato.', 400);
  const { year, month, format } = parsed.data;

  const supabase = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return fail('A sessão expirou. Volte a entrar no painel.', 401);

  const [docs, purchases] = await Promise.all([
    format === 'compras' ? Promise.resolve({ data: null, error: null }) : supabase.rpc('fiscal_export_month', { p_year: year, p_month: month }),
    format === 'compras' ? supabase.rpc('office_month_purchases', { p_year: year, p_month: month }) : Promise.resolve({ data: [], error: null }),
  ]);
  const error = docs.error ?? purchases.error;
  if (error) return fail(officeError(error.message), error.message.includes('forbidden') ? 403 : 500);

  const data: MonthExport = format === 'compras'
    ? { issuer: { name: '', nuit: 'compras', address: '' }, from: `${year}-${String(month).padStart(2, '0')}-01`, to: '', documents: [] }
    : (docs.data as MonthExport);
  if (format !== 'compras') {
    const check = checkExport(data);
    if (!check.ok) return fail(check.error, 409);
  }
  const file = buildMonthFile(format, data, (purchases.data ?? []) as Purchase[]);
  return new NextResponse(file.body, {
    headers: { ...headers, 'Content-Type': file.contentType, 'Content-Disposition': `attachment; filename="${file.fileName}"` },
  });
}
