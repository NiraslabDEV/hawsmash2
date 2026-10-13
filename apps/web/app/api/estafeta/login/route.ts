import { NextResponse } from 'next/server';

import { COURIER_COOKIE, COURIER_COOKIE_MAX_AGE, courierErrorMessage, loginSchema } from '@/lib/estafeta/contract';
import { courierAdmin } from '@/lib/estafeta/server';

export const dynamic = 'force-dynamic';

/**
 * Entrada do estafeta: telefone + PIN (1115).
 *
 * O PIN compara-se na BD (`courier_login`, só service_role) e o que volta é um
 * token aleatório que fica num cookie httpOnly — o JavaScript da página nunca
 * o vê, e a BD só guarda o sha256 dele. O estafeta não tem conta Supabase: a
 * RLS da loja não lhe abre nada.
 */
export async function POST(request: Request) {
  const admin = courierAdmin();
  if (!admin) {
    return NextResponse.json({ error: 'Servidor sem configuração.' }, { status: 503 });
  }

  const parsed = loginSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: courierErrorMessage('invalid_credentials') }, { status: 400 });
  }

  const { data, error } = await admin.rpc('courier_login', {
    p_phone: parsed.data.phone,
    p_pin: parsed.data.pin,
  });
  if (error || !data) {
    return NextResponse.json({ error: courierErrorMessage(null) }, { status: 500 });
  }
  if (!data.ok) {
    const reason: string = data.reason ?? 'invalid_credentials';
    return NextResponse.json(
      { error: courierErrorMessage(reason), reason, lockedUntil: data.locked_until ?? null },
      { status: reason === 'pin_locked' ? 423 : 401 },
    );
  }

  const res = NextResponse.json({ ok: true, fullName: data.full_name });
  res.cookies.set(COURIER_COOKIE, data.token as string, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: COURIER_COOKIE_MAX_AGE,
  });
  return res;
}
