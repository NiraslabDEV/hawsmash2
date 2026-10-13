import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { actionSchema, COURIER_COOKIE, courierErrorCode, courierErrorMessage } from '@/lib/estafeta/contract';
import { courierAdmin } from '@/lib/estafeta/server';

export const dynamic = 'force-dynamic';

/** Sessão inválida: responde 401 e apaga o cookie, para o ecrã voltar ao login. */
function semSessao() {
  const res = NextResponse.json(
    { error: courierErrorMessage('courier_session_invalid'), reason: 'courier_session_invalid' },
    { status: 401 },
  );
  res.cookies.delete(COURIER_COOKIE);
  return res;
}

function falha(message: string | undefined) {
  const code = courierErrorCode(message);
  if (code === 'courier_session_invalid') return semSessao();
  return NextResponse.json({ error: courierErrorMessage(code), reason: code }, { status: code ? 409 : 500 });
}

/** O ecrã do estafeta: as entregas dele, o dia e a conta-corrente. */
export async function GET() {
  const admin = courierAdmin();
  if (!admin) return NextResponse.json({ error: 'Servidor sem configuração.' }, { status: 503 });
  const token = cookies().get(COURIER_COOKIE)?.value;
  if (!token) return semSessao();

  const { data, error } = await admin.rpc('courier_state', { p_token: token });
  if (error) return falha(error.message);
  return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
}

/** Uma acção do estafeta: serviço, posição, levantei, entregue, sair. */
export async function POST(request: Request) {
  const admin = courierAdmin();
  if (!admin) return NextResponse.json({ error: 'Servidor sem configuração.' }, { status: 503 });
  const token = cookies().get(COURIER_COOKIE)?.value;
  if (!token) return semSessao();

  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: courierErrorMessage('invalid_request') }, { status: 400 });
  }
  const a = parsed.data;

  if (a.action === 'logout') {
    await admin.rpc('courier_logout', { p_token: token });
    const res = NextResponse.json({ ok: true });
    res.cookies.delete(COURIER_COOKIE);
    return res;
  }

  const chamada =
    a.action === 'shift'
      ? admin.rpc('courier_set_shift', { p_token: token, p_on: a.on })
      : a.action === 'ping'
        ? admin.rpc('courier_ping', {
            p_token: token,
            p_lat: a.lat,
            p_lng: a.lng,
            p_accuracy_m: a.accuracy == null ? null : Math.round(a.accuracy),
          })
        : a.action === 'pickup'
          ? admin.rpc('courier_pickup', { p_token: token, p_delivery_id: a.deliveryId })
          : admin.rpc('courier_deliver', {
              p_token: token,
              p_delivery_id: a.deliveryId,
              p_lat: a.lat ?? null,
              p_lng: a.lng ?? null,
            });

  const { data, error } = await chamada;
  if (error) return falha(error.message);
  return NextResponse.json(data);
}
