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
    const { to, customerName, orderNumber, totalCents, paymentMethod } = body;

    if (!to || !customerName || !orderNumber) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    const totalFormatted = new Intl.NumberFormat('pt-MZ', {
      style: 'currency',
      currency: 'MZN',
    }).format(totalCents / 100);

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #e5a93c;">Pagamento Confirmado!</h1>
        <p>Olá ${customerName},</p>
        <p>O seu pagamento foi confirmado com sucesso.</p>
        <div style="background: #1a1614; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <p><strong>Número do Pedido:</strong> ${orderNumber}</p>
          <p><strong>Total Pago:</strong> ${totalFormatted}</p>
          <p><strong>Método de Pagamento:</strong> ${paymentMethod.toUpperCase()}</p>
        </div>
        <p>Obrigado pela sua encomenda!</p>
        <p>Equipa ${process.env.BRAND_NAME || 'Delivery OS'}</p>
      </div>
    `;

    const { data, error } = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL || 'noreply@delivery-os.com',
      to,
      subject: `Pagamento Confirmado - Pedido ${orderNumber}`,
      html,
      tags: [
        { name: 'Order ID', value: orderNumber },
        { name: 'Type', value: 'order_approval' },
      ],
    });

    if (error) {
      console.error('Error sending approval email:', error);
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, data });
  } catch (err) {
    console.error('Error in send-approval-email:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}