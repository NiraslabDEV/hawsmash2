import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

import {
  FIRST_TOUCH_COOKIE,
  LAST_TOUCH_COOKIE,
  attributionPayload,
  decodeTouch,
} from '@/lib/attribution';
import { parseStoreCookie, resolveStoreSlug } from '@/lib/store-context';

interface TrackBody {
  type: string;
  value_cents?: number;
  utm?: Record<string, string>;
  payload?: Record<string, unknown>;
  store?: string | null;
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
  let store: string | null = null;
  if (b.store !== undefined && b.store !== null && b.store !== '') {
    try {
      store = resolveStoreSlug(b.store);
    } catch {
      return { ok: false, error: 'store must be a valid slug' };
    }
  }

  return {
    ok: true,
    data: {
      type: b.type,
      value_cents: b.value_cents as number | undefined,
      utm: (b.utm && typeof b.utm === 'object' ? b.utm : {}) as Record<string, string>,
      payload: (b.payload && typeof b.payload === 'object' ? b.payload : {}) as Record<string, unknown>,
      store,
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

  // A origem vem do cookie selado pelo middleware, não do que o browser envia
  // no corpo: o corpo só sabe a URL do momento do evento e perde a campanha
  // assim que o cliente navega. O `utm` do cliente entra apenas como reforço,
  // nunca a substituir o que o servidor classificou.
  const firstTouch = decodeTouch(cookieStore.get(FIRST_TOUCH_COOKIE)?.value);
  const lastTouch = decodeTouch(cookieStore.get(LAST_TOUCH_COOKIE)?.value);
  const attribution = attributionPayload(firstTouch, lastTouch);

  // Insere com service role — anon nunca faz INSERT direto (sem policy anon na tabela).
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  // A loja é uma dimensão do funil: tráfego antes da escolha fica sem loja.
  const storeSlug = result.data.store ?? parseStoreCookie(req.headers.get('cookie'));
  let storeId: string | null = null;
  if (storeSlug) {
    const { data: store } = await supabase
      .from('stores')
      .select('id')
      .eq('slug', storeSlug)
      .maybeSingle();
    storeId = store?.id ?? null;
  }

  const { error } = await supabase.from('analytics_events').insert({
    session_id: sessionId,
    customer_phone: customerPhone,
    type: result.data.type,
    value_cents: result.data.value_cents ?? null,
    utm: result.data.utm ?? {},
    payload: result.data.payload ?? {},
    store_id: storeId,
    channel: attribution.channel,
    source: attribution.source,
    medium: attribution.medium,
    campaign: attribution.campaign,
    referrer_host: attribution.referrer_host,
  });

  if (error) {
    console.error('[track]', error.message);
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
