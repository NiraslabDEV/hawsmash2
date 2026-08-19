import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const body = await request.json();
    const { orderId, rating, comment, phone } = body;

    if (!orderId || !rating || rating < 1 || rating > 5) {
      return NextResponse.json({ success: false, error: 'Dados inválidos' }, { status: 400 });
    }

    // submit_feedback (SECURITY DEFINER) valida pedido entregue, 1 feedback/pedido,
    // e rate-limit por telefone no DB (F1.4)
    const { data, error } = await supabase.rpc('submit_feedback', {
      p_order_id: orderId,
      p_rating: rating,
      p_comment: comment || null,
      p_customer_phone: phone || null,
    });

    if (error) {
      console.error('Feedback error:', error);
      return NextResponse.json({ success: false, error: 'Erro ao enviar feedback' }, { status: 500 });
    }

    if (!data?.success) {
      const messages: Record<string, string> = {
        rate_limit_exceeded: 'Tente novamente mais tarde',
        order_not_found: 'Pedido não encontrado',
        order_not_delivered: 'Apenas pedidos entregues podem ter feedback',
        feedback_already_submitted: 'Feedback já enviado para este pedido',
        invalid_rating: 'Classificação inválida',
      };
      const status =
        data?.error === 'rate_limit_exceeded' ? 429 :
        data?.error === 'order_not_found' ? 404 : 400;
      return NextResponse.json(
        { success: false, error: messages[data?.error] || 'Erro ao enviar feedback' },
        { status }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Feedback submission error:', error);
    return NextResponse.json({ success: false, error: 'Erro interno do servidor' }, { status: 500 });
  }
}
