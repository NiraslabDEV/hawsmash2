import { NextResponse } from 'next/server';

import { loginSchema, WAITER_COOKIE, WAITER_COOKIE_MAX_AGE, waiterErrorMessage } from '@/lib/garcom/contract';
import { waiterAdmin } from '@/lib/garcom/server';

export const dynamic = 'force-dynamic';

/**
 * Entrada do garçom: telefone + PIN (1122), como o estafeta (1115).
 *
 * O PIN compara-se na BD (`waiter_login`, só service_role) e o que volta é um
 * token aleatório que fica num cookie httpOnly — o JavaScript da página nunca
 * o vê, e a BD só guarda o sha256 dele. O garçom não tem conta Supabase: a
 * RLS da loja não lhe abre nada.
 */
export async function POST(request: Request) {
  const admin = waiterAdmin();
  if (!admin) {
    return NextResponse.json({ error: 'Servidor sem configuração.' }, { status: 503 });
  }

  const parsed = loginSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: waiterErrorMessage('invalid_credentials') }, { status: 400 });
  }

  const { data, error } = await admin.rpc('waiter_login', {
    p_phone: parsed.data.phone,
    p_pin: parsed.data.pin,
  });
  if (error || !data) {
    return NextResponse.json({ error: waiterErrorMessage(null) }, { status: 500 });
  }
  if (!data.ok) {
    const reason: string = data.reason ?? 'invalid_credentials';
    return NextResponse.json(
      { error: waiterErrorMessage(reason), reason, lockedUntil: data.locked_until ?? null },
      { status: reason === 'pin_locked' ? 423 : 401 },
    );
  }

  const res = NextResponse.json({ ok: true, fullName: data.full_name });
  res.cookies.set(WAITER_COOKIE, data.token as string, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: WAITER_COOKIE_MAX_AGE,
  });
  return res;
}
