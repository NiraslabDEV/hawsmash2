/**
 * GET /api/cron/conversions — a retoma da fila de conversões (1030).
 *
 * O envio imediato acontece a seguir à venda, dentro de `fireConversions`.
 * Este cron existe para o que esse envio não apanha: a Meta em baixo, o token
 * expirado, a rede da loja em baixo ao segundo em que a venda entrou. Sem
 * isto, uma falha de dois minutos apagava conversões de forma permanente.
 *
 * Correr a cada 5 minutos chega: o backoff da fila (1 → 4 → 16 → 64 min…)
 * é que decide quando cada trabalho volta a ser tentado.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

import { drainConversionJobs } from '@/lib/server-analytics/conversions';
import { cronUnauthorized } from '@/lib/cron/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const denied = cronUnauthorized(request);
  if (denied) return denied;

  // Service role: a fila e os segredos de marketing nunca passam pelo browser.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ ok: false, error: 'supabase_not_configured' }, { status: 503 });
  }

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const result = await drainConversionJobs(supabase, 50);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[cron/conversions]', message);
    // 200 de propósito: um cron que devolve erro entra em ciclo de alertas por
    // uma falha que já está registada trabalho a trabalho na própria fila.
    return NextResponse.json({ ok: false, error: message });
  }
}
