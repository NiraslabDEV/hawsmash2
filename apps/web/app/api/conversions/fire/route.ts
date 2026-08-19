/**
 * POST /api/conversions/fire
 * Chamado fire-and-forget pelo admin panel após advance_order APPROVE.
 * Sempre responde 200 — o admin nunca deve esperar por isto.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { fireConversions } from '@/lib/server-analytics/conversions';

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 200 });
  }

  const b = body as Record<string, unknown>;
  const orderId = typeof b.orderId === 'string' ? b.orderId : null;
  const totalCents = typeof b.totalCents === 'number' ? b.totalCents : null;

  if (!orderId || totalCents === null) {
    return NextResponse.json({ ok: false, error: 'missing orderId or totalCents' }, { status: 200 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  // fire-and-forget — não faz await, responde imediatamente
  fireConversions(orderId, totalCents, supabase).catch(() => {});

  return NextResponse.json({ ok: true });
}
