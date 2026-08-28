import { NextRequest, NextResponse } from 'next/server';

import {
  FIRST_TOUCH_COOKIE,
  FIRST_TOUCH_MAX_AGE,
  LAST_TOUCH_COOKIE,
  LAST_TOUCH_MAX_AGE,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  buildTouch,
  decodeTouch,
  encodeTouch,
  isMeaningfulTouch,
} from '@/lib/attribution';

/**
 * middleware.ts — sela a origem da visita antes de o browser correr um script.
 *
 * Porque no edge e nao no cliente: e a unica altura em que temos o `referer`
 * verdadeiro e a query string original. Depois disto o cliente navega em
 * client-side, a URL perde os parametros e a origem desaparecia — foi
 * exactamente esse o buraco no funil ate aqui (§16 do motor: `dl_session`
 * era lido mas nunca escrito, logo todas as sessoes eram "unknown").
 *
 * Nao carrega pixel nenhum e nao guarda PII: sao tres cookies first-party com
 * origem de trafego. O consentimento continua a mandar nos scripts de
 * terceiros (`dl_consent`), como antes.
 */
export function middleware(req: NextRequest) {
  const res = NextResponse.next();

  const selfHost = req.nextUrl.hostname;
  const cookieHeader = req.headers.get('cookie');

  // ── sessao (30 min deslizantes) ───────────────────────────────────────────
  const existingSession = req.cookies.get(SESSION_COOKIE)?.value;
  const sessionId = existingSession && existingSession.length <= 64 ? existingSession : crypto.randomUUID();
  res.cookies.set(SESSION_COOKIE, sessionId, {
    path: '/',
    maxAge: SESSION_MAX_AGE,
    sameSite: 'lax',
    httpOnly: false, // o cliente precisa de o ler para juntar ao pedido
  });

  // ── toque desta visita ────────────────────────────────────────────────────
  const touch = buildTouch({
    url: req.nextUrl,
    referrer: req.headers.get('referer'),
    selfHost,
  });

  const first = decodeTouch(req.cookies.get(FIRST_TOUCH_COOKIE)?.value);
  const last = decodeTouch(req.cookies.get(LAST_TOUCH_COOKIE)?.value);

  // Primeiro toque grava-se uma vez e nunca mais se toca — e o credito de
  // quem descobriu a marca. Uma visita directa tambem conta como descoberta.
  if (!first) {
    res.cookies.set(FIRST_TOUCH_COOKIE, encodeTouch(touch), {
      path: '/',
      maxAge: FIRST_TOUCH_MAX_AGE,
      sameSite: 'lax',
    });
  }

  // Ultimo toque so muda quando ha origem nova. Navegacao interna e visita
  // directa nao apagam a campanha que trouxe o cliente.
  if (isMeaningfulTouch(touch)) {
    res.cookies.set(LAST_TOUCH_COOKIE, encodeTouch(touch), {
      path: '/',
      maxAge: LAST_TOUCH_MAX_AGE,
      sameSite: 'lax',
    });
  } else if (!last && !first) {
    // Primeira visita mesmo directa: guarda para o relatorio nao ficar vazio.
    res.cookies.set(LAST_TOUCH_COOKIE, encodeTouch(touch), {
      path: '/',
      maxAge: LAST_TOUCH_MAX_AGE,
      sameSite: 'lax',
    });
  }

  // Deixa o cabecalho de cookie intacto para o resto da cadeia (auth do painel).
  void cookieHeader;

  return res;
}

export const config = {
  // So paginas publicas: o POS e o painel nao geram trafego de marketing.
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|pos|tv|kds|manifest.webmanifest|sw.js|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|css|js|woff2?)$).*)',
  ],
};
