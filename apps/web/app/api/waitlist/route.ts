import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const body = await request.json();
    const { name, phone, notes } = body;

    // Validate input
    if (!name || !phone) {
      return NextResponse.json(
        { success: false, error: 'Nome e telefone são obrigatórios' },
        { status: 400 }
      );
    }

    // Add to waitlist using RPC
    const { data, error } = await supabase.rpc('join_waitlist', {
      p_name: name,
      p_phone: phone,
      p_notes: notes || null,
    });

    if (error) {
      console.error('Waitlist error:', error);
      return NextResponse.json(
        { success: false, error: 'Erro ao adicionar à lista de espera' },
        { status: 500 }
      );
    }

    // Check if rate limited
    if (!data.success) {
      if (data.error === 'rate_limit_exceeded') {
        return NextResponse.json(
          { success: false, error: 'Tente novamente mais tarde' },
          { status: 429 }
        );
      }
      return NextResponse.json(
        { success: false, error: data.error || 'Erro ao adicionar à lista de espera' },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Waitlist submission error:', error);
    return NextResponse.json(
      { success: false, error: 'Erro interno do servidor' },
      { status: 500 }
    );
  }
}