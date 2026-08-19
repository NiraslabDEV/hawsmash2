import { createClient } from '@/utils/supabase/server';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const { searchParams } = new URL(request.url);
    const channel = searchParams.get('channel'); // 'delivery' | 'dine_in' | null (tudo)

    const { data, error } = await supabase.rpc('get_menu', { p_channel: channel });
    
    if (error) {
      console.error('Error fetching menu:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    
    return NextResponse.json(data);
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}