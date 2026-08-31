import { NextResponse } from 'next/server';
import { isEmailConfigured, sendMail } from '@/lib/email/transport';

export async function POST(request: Request) {
  try {
    if (!isEmailConfigured()) {
      return NextResponse.json(
        { error: 'SMTP not configured' },
        { status: 503 }
      );
    }

    const body = await request.json();
    const { to, customerName, orderNumber, reason, paymentMethod } = body;

    if (!to || !customerName || !orderNumber || !reason) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #e5a93c;">Pagamento Não Confirmado</h1>
        <p>Olá ${customerName},</p>
        <p>Lamentamos informar que o seu pagamento não foi confirmado.</p>
        <div style="background: #1a1614; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <p><strong>Número do Pedido:</strong> ${orderNumber}</p>
          <p><strong>Método de Pagamento:</strong> ${paymentMethod.toUpperCase()}</p>
          <p><strong>Motivo:</strong> ${reason}</p>
        </div>
        <p>Por favor, verifique os dados do pagamento ou entre em contacto com o restaurante.</p>
        <p>Equipa ${process.env.BRAND_NAME || 'Delivery OS'}</p>
      </div>
    `;

    const result = await sendMail({
      to,
      subject: `Pagamento Não Confirmado - Pedido ${orderNumber}`,
      html,
    });

    if (!result.ok) {
      console.error('Error sending rejection email:', result.error);
      return NextResponse.json(
        { error: result.error },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Error in send-rejection-email:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}