import { NextRequest, NextResponse } from 'next/server';

import { resolveSessionId } from '@/lib/analytics/session';
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
/** Dominio publico configurado, quando existe (fica no build). */
const CONFIGURED_HOST = (() => {
  try {
    return process.env.NEXT_PUBLIC_APP_BASE_URL ? new URL(process.env.NEXT_PUBLIC_APP_BASE_URL).hostname : null;
  } catch {
    return null;
  }
})();

export function middleware(req: NextRequest) {
  // Atras do proxy do Railway o `nextUrl.hostname` nao e o dominio publico.
  // Sem os outros tres, cada clique dentro do site contava como referral
  // vindo do proprio site e apagava a campanha que trouxe o cliente (visto no
  // staging: 21 de 29 sessoes com origem "hawsmash2-staging.up.railway.app").
  const selfHost = [
    req.headers.get('x-forwarded-host'),
    req.headers.get('host'),
    req.nextUrl.hostname,
    CONFIGURED_HOST,
  ];

  // ── sessao (30 min deslizantes) ───────────────────────────────────────────
  // 'unknown', vazio ou lixo nunca passam: um id invalido colapsava o site
  // inteiro numa sessao so no funil.
  const session = resolveSessionId(req.cookies.get(SESSION_COOKIE)?.value);

  // Sessao nova tambem entra no pedido que segue: o /api/track le-a do
  // cookie e, sem isto, o primeiro evento de uma sessao expirada ficava com
  // um id diferente do resto.
  if (session.isNew) req.cookies.set(SESSION_COOKIE, session.id);
  const res = NextResponse.next({ request: { headers: req.headers } });

  res.cookies.set(SESSION_COOKIE, session.id, {
    path: '/',
    maxAge: SESSION_MAX_AGE,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true, // so o servidor le (track e create-order)
  });

  // O /api/track so precisa de renovar a sessao. A origem sela-se nas
  // paginas: o referer de um fetch e a propria loja, nunca uma origem.
  if (req.nextUrl.pathname === '/api/track') return res;

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

  return res;
}

export const config = {
  // Paginas publicas + /api/track (renova a sessao a quem fica parado numa
  // pagina). Fora: POS, TVs e o resto da API — webhooks e crons nao tem
  // browser do outro lado e nao devem levar Set-Cookie.
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|pos|tv|kds|manifest.webmanifest|sw.js|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|css|js|woff2?)$).*)',
    '/api/track',
  ],
};
