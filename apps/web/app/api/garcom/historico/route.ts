import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { WAITER_COOKIE, waiterErrorCode, waiterErrorMessage } from '@/lib/garcom/contract';
import { waiterAdmin } from '@/lib/garcom/server';

export const dynamic = 'force-dynamic';

/** Os pedidos do próprio garçom (1127). Quem é vem do token, nunca do pedido. */
export async function GET(request: Request) {
  const admin = waiterAdmin();
  if (!admin) return NextResponse.json({ error: 'Servidor sem configuração.' }, { status: 503 });
  const token = cookies().get(WAITER_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ error: waiterErrorMessage('waiter_session_invalid') }, { status: 401 });
  }

  const dias = Number(new URL(request.url).searchParams.get('dias') ?? 1);
  const { data, error } = await admin.rpc('waiter_history', {
    p_token: token,
    p_days: Number.isInteger(dias) ? dias : 1,
  });
  if (error) {
    const code = waiterErrorCode(error.message);
    return NextResponse.json(
      { error: waiterErrorMessage(code), reason: code },
      { status: code === 'waiter_session_invalid' ? 401 : 500 },
    );
  }
  return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
}
