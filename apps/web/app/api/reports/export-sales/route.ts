import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { buildAccountingCsv } from '@/lib/admin/accounting-export';

export const dynamic = 'force-dynamic';
const querySchema = z.object({
  store_id: z.union([z.literal('all'), z.string().uuid()]).default('all'),
  from: z.string().datetime({ offset: true }), to: z.string().datetime({ offset: true }),
  layout: z.enum(['payments', 'orders']).default('payments'),
  format: z.enum(['standard', 'excel']).default('standard'),
}).refine((q) => Date.parse(q.to) > Date.parse(q.from) && Date.parse(q.to) - Date.parse(q.from) <= 366 * 86400000);
const headers = { 'Cache-Control': 'private, no-store', Vary: 'Authorization', 'X-Content-Type-Options': 'nosniff' };
const fail = (error: string, status: number) => NextResponse.json({ error }, { status, headers });

export async function GET(request: Request) {
  const token = /^Bearer ([^\s]+)$/i.exec(request.headers.get('authorization') ?? '')?.[1];
  if (!token) return fail('Autenticação necessária. Volte a entrar no painel.', 401);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return fail('Exportação temporariamente indisponível.', 503);

  // A sessão do painel está no navegador. Validar o Bearer recebido e manter
  // esse utilizador na RPC: nunca usar service_role para contornar a autorização.
  const supabase = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return fail('A sessão expirou. Volte a entrar no painel.', 401);
    const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) return fail('Verifique a loja, o formato e as datas. Escolha um período até 366 dias.', 400);
    const query = parsed.data;
    const rows: unknown[] = [];
    let expected: number | null = null;
    do {
      const { data, error, count } = await supabase.rpc('export_sales_for_accounting', {
        p_store_id: query.store_id === 'all' ? null : query.store_id,
        p_from: new Date(query.from).toISOString(), p_to: new Date(query.to).toISOString(),
      }, { count: 'exact' })
        .order('sale_date').order('sale_time').order('store_name').order('order_number')
        .order('payment_method').order('payment_status').order('payment_reference').order('payment_amount_cents')
        .range(rows.length, rows.length + 499);
      if (error) {
        if (error.code === 'P0403' || error.message.includes('export_access_denied')) return fail('Não tem permissão para exportar esta loja.', 403);
        if (error.code === 'P0020' || error.code === 'PGRST301') return fail('A sessão expirou. Volte a entrar no painel.', 401);
        return fail('Não foi possível ler todos os pagamentos. Tente novamente.', 503);
      }
      if (!Array.isArray(data) || count === null || !Number.isSafeInteger(count) || count < 0) return fail('Não foi possível confirmar a totalidade dos pagamentos. Tente novamente.', 503);
      if (expected !== null && count !== expected) return fail('Os dados mudaram durante a leitura. Repita a exportação.', 409);
      expected = count;
      if (expected > 50000) return fail('O período tem demasiados pagamentos. Exporte por mês ou por loja.', 413);
      if (data.length === 0 && rows.length < expected) return fail('A leitura ficou incompleta. Tente novamente.', 503);
      rows.push(...data);
      if (rows.length > expected) return fail('Os dados mudaram durante a leitura. Repita a exportação.', 409);
    } while (rows.length < expected);

    const csv = buildAccountingCsv(rows, query.layout, query.format);
    const filename = `${query.layout === 'orders' ? 'pedidos' : 'pagamentos'}-${query.from.slice(0, 10)}.csv`;
    return new NextResponse(csv, { headers: {
      ...headers, 'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'X-Export-Payment-Count': String(rows.length),
    } });
  } catch {
    // Não expor detalhes internos nem devolver um ficheiro parcial.
    return fail('Não foi possível concluir a exportação. Tente novamente.', 503);
  }
}
