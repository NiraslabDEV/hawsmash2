import { createClient } from '@/utils/supabase/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { ownerProofEmail } from '@/lib/email/order-emails';
import { sendMail } from '@/lib/email/transport';

const bodySchema = z.object({
  orderId: z.string().uuid(),
  path: z.string().trim().min(1).max(512),
});

// Liga o comprovativo ao pedido (após upload no checkout) e avisa o dono por email.
export async function POST(request: Request) {
  try {
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Missing orderId or path' }, { status: 400 });
    }
    const { orderId, path } = parsed.data;

    const supabase = await createClient();
    const { data, error } = await supabase.rpc('attach_payment_proof', {
      p_order_id: orderId,
      p_path: path,
    });

    if (error) {
      console.error('attach_payment_proof error:', error);
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    // Email ao dono — best-effort, não bloqueia a resposta ao cliente. A RPC só
    // aceita o primeiro comprovativo de cada pedido: sai no máximo um email.
    const ownerEmail = data?.owner_email || process.env.OWNER_EMAIL;
    if (ownerEmail) {
      const { subject, html } = ownerProofEmail({
        orderNumber: String(data?.order_number ?? ''),
        customerName: data?.customer_name ?? null,
        totalCents: data?.total_cents ?? 0,
        paymentMethod: data?.payment_method ?? null,
        fulfillmentType: data?.fulfillment_type ?? null,
      });
      await sendMail({ to: ownerEmail, subject, html })
        .then((r) => { if (!r.ok) console.error('owner email failed:', r.error); })
        .catch((e) => console.error('owner email failed:', e));
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Unexpected error in attach-proof:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
