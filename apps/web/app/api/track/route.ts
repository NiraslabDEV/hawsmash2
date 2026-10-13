import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

import {
  FIRST_TOUCH_COOKIE,
  LAST_TOUCH_COOKIE,
  attributionPayload,
  decodeTouch,
} from '@/lib/attribution';
import { isBotUserAgent } from '@/lib/analytics/bots';
import { SESSION_COOKIE, SESSION_MAX_AGE, resolveSessionId } from '@/lib/analytics/session';
import {
  MAX_BODY_BYTES,
  createRateLimiter,
  rateLimitKey,
  validateTrackBody,
} from '@/lib/analytics/track-guard';
import { parseStoreCookie } from '@/lib/store-context';

const limiter = createRateLimiter();

export async function POST(req: NextRequest) {
  const key = rateLimitKey(req.headers.get('x-forwarded-for'), req.headers.get('x-real-ip'));
  if (!limiter.allow(key)) {
    return NextResponse.json({ error: 'too many requests' }, { status: 429 });
  }

  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'body too large' }, { status: 413 });
  }
  const text = await req.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'body too large' }, { status: 413 });
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const result = validateTrackBody(body);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  // Robôs fora do funil: headless Chrome, scrapers e monitores de uptime
  // correm JS e chegam aqui. Contá-los inflacionava o topo do funil e fazia a
  // loja parecer que não converte. 200 na mesma — não é erro do cliente.
  if (isBotUserAgent(req.headers.get('user-agent'))) {
    return NextResponse.json({ ok: true, ignored: 'bot' });
  }

  const cookieStore = await cookies();
  // O middleware já emite a sessão; se ainda assim faltar, gera-se aqui e
  // devolve-se na resposta — nunca voltar a gravar 'unknown', que colapsa o
  // site inteiro numa sessão só no funil.
  const session = resolveSessionId(cookieStore.get(SESSION_COOKIE)?.value);
  const sessionId = session.id;
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

  const res = NextResponse.json({ ok: true });
  if (session.isNew) {
    res.cookies.set(SESSION_COOKIE, sessionId, {
      path: '/',
      maxAge: SESSION_MAX_AGE,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
    });
  }
  return res;
}
