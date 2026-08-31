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
    const { to, customerName, orderNumber, totalCents, paymentMethod, storeName, storePhone } = body;

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
          ${storeName ? `<p><strong>Loja:</strong> ${storeName}${storePhone ? ` · ${storePhone}` : ''}</p>` : ''}
          <p><strong>Total Pago:</strong> ${totalFormatted}</p>
          <p><strong>Método de Pagamento:</strong> ${paymentMethod.toUpperCase()}</p>
        </div>
        <p>Obrigado pela sua encomenda!</p>
        <p>Equipa ${process.env.BRAND_NAME || 'Delivery OS'}</p>
      </div>
    `;

    const result = await sendMail({
      to,
      subject: storeName
        ? `Pagamento confirmado — Pedido ${orderNumber} · ${storeName}`
        : `Pagamento confirmado — Pedido ${orderNumber}`,
      html,
    });

    if (!result.ok) {
      console.error('Error sending approval email:', result.error);
      return NextResponse.json(
        { error: result.error },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Error in send-approval-email:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}