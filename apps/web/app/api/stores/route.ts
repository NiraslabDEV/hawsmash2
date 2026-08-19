import { NextResponse } from 'next/server';

import { createClient } from '@/utils/supabase/server';
import { publicStoreListSchema } from '@/lib/public-stores';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('list_public_stores');

    if (error) {
      console.error('Erro a listar lojas:', error);
      return NextResponse.json({ error: 'Não foi possível listar as lojas.' }, { status: 500 });
    }

    const stores = publicStoreListSchema.parse(data ?? []);
    return NextResponse.json({ stores }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Erro inesperado a listar lojas:', error);
    return NextResponse.json({ error: 'Erro interno. Tenta novamente.' }, { status: 500 });
  }
}
