import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

interface TrackBody {
  type: string;
  value_cents?: number;
  utm?: Record<string, string>;
  payload?: Record<string, unknown>;
}

function validate(body: unknown): { ok: true; data: TrackBody } | { ok: false; error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'body must be an object' };
  }
  const b = body as Record<string, unknown>;
  if (typeof b.type !== 'string' || b.type.length === 0 || b.type.length > 100) {
    return { ok: false, error: 'type must be a non-empty string (max 100)' };
  }
  if (b.value_cents !== undefined) {
    if (typeof b.value_cents !== 'number' || !Number.isInteger(b.value_cents) || b.value_cents < 0) {
      return { ok: false, error: 'value_cents must be a non-negative integer' };
    }
  }
  return {
    ok: true,
    data: {
      type: b.type,
      value_cents: b.value_cents as number | undefined,
      utm: (b.utm && typeof b.utm === 'object' ? b.utm : {}) as Record<string, string>,
      payload: (b.payload && typeof b.payload === 'object' ? b.payload : {}) as Record<string, unknown>,
    },
  };
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const result = validate(body);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  const cookieStore = await cookies();
  const sessionId = cookieStore.get('dl_session')?.value ?? 'unknown';
  const customerPhone = cookieStore.get('dl_phone')?.value ?? null;

  // Insere com service role — anon nunca faz INSERT direto (sem policy anon na tabela).
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const { error } = await supabase.from('analytics_events').insert({
    session_id: sessionId,
    customer_phone: customerPhone,
    type: result.data.type,
    value_cents: result.data.value_cents ?? null,
    utm: result.data.utm ?? {},
    payload: result.data.payload ?? {},
  });

  if (error) {
    console.error('[track]', error.message);
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
