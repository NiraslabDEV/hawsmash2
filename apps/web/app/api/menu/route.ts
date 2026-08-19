import { createClient } from '@/utils/supabase/server';
import { NextResponse } from 'next/server';
import { InvalidStoreSlugError, resolveStoreSlug } from '@/lib/store-context';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const { searchParams } = new URL(request.url);
    const channel = searchParams.get('channel'); // 'delivery' | 'dine_in' | null (tudo)
    const storeSlug = resolveStoreSlug(searchParams.get('store'));

    const { data, error } = await supabase.rpc('get_menu', {
      p_store_slug: storeSlug,
      p_channel: channel,
    });
    
    if (error) {
      console.error('Error fetching menu:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof InvalidStoreSlugError) {
      return NextResponse.json({ error: 'Loja inválida.' }, { status: 400 });
    }
    console.error('Unexpected error:', error);
    return NextResponse.json({ error: 'Erro interno. Tenta novamente.' }, { status: 500 });
  }
}
