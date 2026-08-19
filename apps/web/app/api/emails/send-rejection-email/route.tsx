import { NextResponse } from 'next/server';
import { Resend } from 'resend';

export async function POST(request: Request) {
  try {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'RESEND_API_KEY not configured' },
        { status: 503 }
      );
    }
    const resend = new Resend(apiKey);

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

    const { data, error } = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL || 'noreply@delivery-os.com',
      to,
      subject: `Pagamento Não Confirmado - Pedido ${orderNumber}`,
      html,
      tags: [
        { name: 'Order ID', value: orderNumber },
        { name: 'Type', value: 'order_rejection' },
      ],
    });

    if (error) {
      console.error('Error sending rejection email:', error);
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, data });
  } catch (err) {
    console.error('Error in send-rejection-email:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}