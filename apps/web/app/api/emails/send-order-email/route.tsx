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
    const { to, subject, html, orderId } = body;

    if (!to || !subject || !html) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    const { data, error } = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL || 'noreply@delivery-os.com',
      to,
      subject,
      html,
      tags: [
        { name: 'Order ID', value: orderId },
        { name: 'Type', value: 'order_notification' },
      ],
    });

    if (error) {
      console.error('Error sending email:', error);
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, data });
  } catch (err) {
    console.error('Error in send-order-email:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}