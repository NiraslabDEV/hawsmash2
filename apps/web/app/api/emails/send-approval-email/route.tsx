import { NextResponse } from 'next/server';
import { z } from 'zod';

import { staffFromRequest } from '@/lib/auth/staff-request';
import { sendApprovalEmailForOrder } from '@/lib/email/order-emails';
import { isEmailConfigured } from '@/lib/email/transport';
import { serviceClient } from '@/lib/payments/direct';

/**
 * Painel → "pagamento confirmado" ao cliente de um pedido aprovado.
 *
 * Só a equipa (Bearer da sessão) e só pedidos que ela consegue ver pela RLS.
 * O corpo diz **que pedido**; destinatário e conteúdo saem da BD.
 */
const bodySchema = z.object({ orderId: z.string().uuid() });

export async function POST(request: Request) {
  const staff = await staffFromRequest(request);
  if (!staff.ok) return NextResponse.json({ error: staff.error }, { status: staff.status });
  if (staff.role === 'kitchen') return NextResponse.json({ error: 'Sem permissão.' }, { status: 403 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Pedido inválido.' }, { status: 400 });

  // A RLS do utilizador decide se o pedido é da loja dele.
  const { data: visible } = await staff.client.from('orders').select('id').eq('id', parsed.data.orderId).maybeSingle();
  if (!visible) return NextResponse.json({ error: 'Pedido não encontrado.' }, { status: 404 });

  if (!(await isEmailConfigured())) return NextResponse.json({ error: 'SMTP not configured' }, { status: 503 });
  const result = await sendApprovalEmailForOrder(serviceClient(), parsed.data.orderId);
  if (!result.ok) {
    const status = result.error === 'invalid_state' || result.error === 'no_recipient' ? 409 : 500;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({ success: true });
}
