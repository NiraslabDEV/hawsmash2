import { createClient } from '@/utils/supabase/server';
import { NextResponse } from 'next/server';

// Liga o comprovativo ao pedido (após upload no checkout) e avisa o dono por email.
export async function POST(request: Request) {
  try {
    const { orderId, path } = await request.json();

    if (!orderId || !path) {
      return NextResponse.json({ error: 'Missing orderId or path' }, { status: 400 });
    }

    const supabase = await createClient();
    const { data, error } = await supabase.rpc('attach_payment_proof', {
      p_order_id: orderId,
      p_path: path,
    });

    if (error) {
      console.error('attach_payment_proof error:', error);
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    // Email ao dono — best-effort, não bloqueia a resposta ao cliente
    const ownerEmail = data?.owner_email || process.env.OWNER_EMAIL;
    if (ownerEmail) {
      const total = new Intl.NumberFormat('pt-MZ', {
        style: 'currency',
        currency: 'MZN',
      }).format((data?.total_cents ?? 0) / 100);

      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #e5a93c;">Novo pedido com comprovativo</h1>
          <div style="background: #1a1614; color: #e5e5e5; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <p><strong>Pedido:</strong> ${data?.order_number}</p>
            <p><strong>Cliente:</strong> ${data?.customer_name}</p>
            <p><strong>Total:</strong> ${total}</p>
            <p><strong>Método:</strong> ${String(data?.payment_method || '').toUpperCase()}</p>
            <p><strong>Tipo:</strong> ${data?.fulfillment_type === 'delivery' ? 'Entrega' : 'Levantamento'}</p>
          </div>
          <p>Abre o painel para ver o comprovativo e aprovar/negar o pedido.</p>
        </div>`;

      const origin = new URL(request.url).origin;
      await fetch(`${origin}/api/emails/send-order-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: ownerEmail,
          subject: `Novo pedido ${data?.order_number} — comprovativo recebido`,
          html,
          orderId,
        }),
      }).catch((e) => console.error('owner email failed:', e));
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Unexpected error in attach-proof:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
