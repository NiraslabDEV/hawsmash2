import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { WAITER_COOKIE, waiterErrorCode, waiterErrorMessage } from '@/lib/garcom/contract';
import { waiterAdmin } from '@/lib/garcom/server';

export const dynamic = 'force-dynamic';

/**
 * O cardápio da loja do garçom (1122), só com o que se vende agora. Vão só as
 * categorias: zonas de entrega e o resto do `get_menu` não interessam à sala.
 */
export async function GET() {
  const admin = waiterAdmin();
  if (!admin) return NextResponse.json({ error: 'Servidor sem configuração.' }, { status: 503 });
  const token = cookies().get(WAITER_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ error: waiterErrorMessage('waiter_session_invalid') }, { status: 401 });
  }

  const { data, error } = await admin.rpc('waiter_menu', { p_token: token });
  if (error) {
    const code = waiterErrorCode(error.message);
    return NextResponse.json(
      { error: waiterErrorMessage(code), reason: code },
      { status: code === 'waiter_session_invalid' ? 401 : 500 },
    );
  }
  return NextResponse.json(
    {
      categories: (data as { categories?: unknown } | null)?.categories ?? [],
      unavailable: (data as { unavailable?: unknown } | null)?.unavailable ?? [],
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
