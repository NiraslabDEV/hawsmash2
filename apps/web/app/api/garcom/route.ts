import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

import { actionSchema, WAITER_COOKIE, waiterErrorCode, waiterErrorMessage, type WaiterAction } from '@/lib/garcom/contract';
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

type Acao = Exclude<WaiterAction, { action: 'logout' }>;

/** Cada acção na sua RPC. Só ids, quantidades e texto: o dinheiro é da BD (Regra 2). */
function chamar(admin: SupabaseClient, token: string, a: Acao) {
  switch (a.action) {
    case 'launch':
      return admin.rpc('waiter_launch_order', {
        p_token: token,
        p_payload: {
          clientSaleId: a.clientSaleId,
          tableId: a.tableId,
          items: a.items,
          ...(a.customerName ? { customerName: a.customerName } : {}),
          ...(a.customerPhone ? { customerPhone: a.customerPhone } : {}),
          ...(a.tabNote ? { tabNote: a.tabNote } : {}),
          ...(a.notes ? { notes: a.notes } : {}),
        },
      });
    case 'serve':
      return admin.rpc('waiter_serve_order', { p_token: token, p_order_id: a.orderId });
    case 'remove':
      return admin.rpc('waiter_remove_item', {
        p_token: token,
        p_payload: { requestId: a.requestId, orderItemId: a.orderItemId, qty: a.qty, reason: a.reason },
      });
    case 'close':
      return admin.rpc('waiter_close_bill', {
        p_token: token,
        p_payload: {
          clientCloseId: a.clientCloseId,
          tableId: a.tableId,
          expectedTotalCents: a.expectedTotalCents,
          payments: [{ method: a.method, amountCents: a.expectedTotalCents }],
        },
      });
    case 'move':
      return admin.rpc('waiter_move_table', {
        p_token: token,
        p_payload: { requestId: a.requestId, fromTableId: a.fromTableId, toTableId: a.toTableId },
      });
    case 'request_bill':
      return admin.rpc('waiter_request_bill', {
        p_token: token,
        p_payload: { requestId: a.requestId, tableId: a.tableId },
      });
    case 'reprint':
      return admin.rpc('waiter_reprint_order', {
        p_token: token,
        p_payload: { requestId: a.requestId, orderId: a.orderId },
      });
    case 'availability':
      return admin.rpc('waiter_set_availability', {
        p_token: token,
        p_menu_item_id: a.menuItemId,
        p_available: a.available,
      });
  }
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

/** Uma acção do garçom. Todas validam o token na BD antes de fazer o que quer que seja. */
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

  const { data, error } = await chamar(admin, token, a);
  if (error) return falha(error.message);
  return NextResponse.json(data);
}
