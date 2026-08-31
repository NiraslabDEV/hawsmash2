/**
 * Sessão do cliente da loja — leitura e escrita do cookie do dispositivo.
 *
 * O token vive num cookie **httpOnly**: o JavaScript da página nunca lhe toca.
 * É essa a diferença entre "a morada está atrás de uma prova de posse" e "a
 * morada está atrás de um número de telefone que meia Maputo sabe de cor".
 *
 * Só código de servidor importa este módulo.
 */

import type { NextResponse } from 'next/server';

export const ACCOUNT_COOKIE = 'hs_acc';

/** Um ano: quem pede hambúrgueres uma vez por mês não volta a autenticar-se. */
const MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export function setAccountCookie(res: NextResponse, token: string) {
  res.cookies.set(ACCOUNT_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  });
}

export function clearAccountCookie(res: NextResponse) {
  res.cookies.set(ACCOUNT_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });
}
