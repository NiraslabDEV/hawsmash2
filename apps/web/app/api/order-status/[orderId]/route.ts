import { createClient } from '@/utils/supabase/server';
import { NextResponse } from 'next/server';

export async function GET(
  request: Request,
  { params }: { params: { orderId: string } }
) {
  try {
    const supabase = await createClient();
    const { orderId } = params;
    
    if (!orderId) {
      return NextResponse.json({ error: 'Order ID required' }, { status: 400 });
    }
    
    const { data, error } = await supabase.rpc('get_order_status', {
      p_order_id: orderId
    });
    
    if (error) {
      console.error('Error fetching order status:', error);
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    
    return NextResponse.json(data);
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}