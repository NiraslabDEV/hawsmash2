/**
 * POST /api/conversions/fire
 * Chamado fire-and-forget pelo admin panel após advance_order APPROVE.
 * Sempre responde 200 — o admin nunca deve esperar por isto.
 *
 * Só a equipa (Bearer da sessão) e só pedidos que ela vê pela RLS. O valor da
 * compra é o `total_cents` gravado no pedido — nunca o que o browser mandar.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { staffFromRequest } from '@/lib/auth/staff-request';
import { serviceClient } from '@/lib/payments/direct';
import { fireConversions } from '@/lib/server-analytics/conversions';

const bodySchema = z.object({ orderId: z.string().uuid() });

export async function POST(req: NextRequest) {
  const staff = await staffFromRequest(req);
  if (!staff.ok) return NextResponse.json({ ok: false, error: staff.error }, { status: staff.status });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'missing orderId' }, { status: 200 });
  }

  const { data: order } = await staff.client.from('orders')
    .select('id,total_cents').eq('id', parsed.data.orderId).maybeSingle();
  if (!order) return NextResponse.json({ ok: false, error: 'order not found' }, { status: 200 });

  // fire-and-forget — não faz await, responde imediatamente
  fireConversions(order.id, order.total_cents, serviceClient()).catch(() => {});

  return NextResponse.json({ ok: true });
}
