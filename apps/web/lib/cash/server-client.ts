import { createServerClient } from '@supabase/ssr';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

import { bearerToken } from '@/lib/auth/staff-request';

/**
 * Cliente das rotas do caixa (PDF e emails de fecho), **como o utilizador**.
 *
 * A sessão do painel e do POS vive no browser (supabase-js), não em cookies:
 * com só cookies estas rotas respondiam sempre 401 e o email de fecho nunca
 * saía. Aceita-se o Bearer da sessão (caminho normal) e, por compatibilidade,
 * a sessão em cookies.
 */
export async function cashClientFromRequest(
  request: Request,
): Promise<{ supabase: SupabaseClient; user: User } | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const token = bearerToken(request);

  if (token) {
    const supabase = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user } } = await supabase.auth.getUser(token);
    return user ? { supabase, user } : null;
  }

  const cookieStore = await cookies();
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
    },
  }) as unknown as SupabaseClient;
  const { data: { user } } = await supabase.auth.getUser();
  return user ? { supabase, user } : null;
}
