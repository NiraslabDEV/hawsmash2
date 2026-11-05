import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { actionSchema, WAITER_COOKIE, waiterErrorCode, waiterErrorMessage } from '@/lib/garcom/contract';
import { waiterAdmin } from '@/lib/garcom/server';

export const dynamic = 'force-dynamic';

/** Sessão inválida: responde 401 e apaga o cookie, para o ecrã voltar ao login. */
function semSessao() {
  const res = NextResponse.json(
    { error: waiterErrorMessage('waiter_session_invalid'), reason: 'waiter_session_invalid' },
    { status: 401 },
  );
  res.cookies.delete(WAITER_COOKIE);
  return res;
}

/**
 * Um erro da BD. Com código conhecido é 409: a RPC é uma transacção e não
 * gravou nada — o telemóvel pode corrigir o pedido. Sem código é 500: o
 * telemóvel trata-o como "não se sabe" e só reenvia, com a mesma chave.
 */
function falha(message: string | undefined) {
  const code = waiterErrorCode(message);
  if (code === 'waiter_session_invalid') return semSessao();
  return NextResponse.json({ error: waiterErrorMessage(code), reason: code }, { status: code ? 409 : 500 });
}

/** O ecrã do garçom: quem é, a loja e as mesas com a conta aberta. */
export async function GET() {
  const admin = waiterAdmin();
  if (!admin) return NextResponse.json({ error: 'Servidor sem configuração.' }, { status: 503 });
  const token = cookies().get(WAITER_COOKIE)?.value;
  if (!token) return semSessao();

  const { data, error } = await admin.rpc('waiter_state', { p_token: token });
  if (error) return falha(error.message);
  return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
}

/** Uma acção do garçom: lançar na mesa, servido, sair. */
export async function POST(request: Request) {
  const admin = waiterAdmin();
  if (!admin) return NextResponse.json({ error: 'Servidor sem configuração.' }, { status: 503 });
  const token = cookies().get(WAITER_COOKIE)?.value;
  if (!token) return semSessao();

  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: waiterErrorMessage('invalid_request'), reason: 'invalid_request' }, { status: 400 });
  }
  const a = parsed.data;

  if (a.action === 'logout') {
    await admin.rpc('waiter_logout', { p_token: token });
    const res = NextResponse.json({ ok: true });
    res.cookies.delete(WAITER_COOKIE);
    return res;
  }

  const { data, error } =
    a.action === 'launch'
      ? await admin.rpc('waiter_launch_order', {
          p_token: token,
          // Só ids, quantidades e texto: o preço é da BD (Regra 2).
          p_payload: {
            clientSaleId: a.clientSaleId,
            tableId: a.tableId,
            items: a.items,
            ...(a.customerName ? { customerName: a.customerName } : {}),
            ...(a.notes ? { notes: a.notes } : {}),
          },
        })
      : await admin.rpc('waiter_serve_order', { p_token: token, p_order_id: a.orderId });

  if (error) return falha(error.message);
  return NextResponse.json(data);
}
