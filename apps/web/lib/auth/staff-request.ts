import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';

/**
 * Quem está a chamar esta rota — a partir do Bearer da sessão do painel/POS.
 *
 * A sessão do painel vive no browser (supabase-js), não em cookies: as rotas
 * que agem em nome da equipa recebem o `access_token` e validam-no aqui. O
 * cliente devolvido corre **como esse utilizador** (RLS aplica-se); nunca se
 * usa a service role para decidir o que ele pode ver.
 */

export type StaffRole = 'owner' | 'manager' | 'cashier' | 'kitchen';

export type StaffRequest =
  | { ok: true; user: User; role: StaffRole; client: SupabaseClient }
  | { ok: false; status: 401 | 403 | 503; error: string };

export function bearerToken(request: Request): string | null {
  return /^Bearer ([^\s]+)$/i.exec(request.headers.get('authorization') ?? '')?.[1] ?? null;
}

export async function staffFromRequest(request: Request): Promise<StaffRequest> {
  const token = bearerToken(request);
  if (!token) return { ok: false, status: 401, error: 'Autenticação necessária.' };
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return { ok: false, status: 503, error: 'Serviço indisponível.' };

  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  try {
    const { data: { user }, error } = await client.auth.getUser(token);
    if (error || !user) return { ok: false, status: 401, error: 'A sessão expirou.' };
    const { data: profile } = await client.from('staff_profiles')
      .select('role,active').eq('user_id', user.id).maybeSingle();
    if (!profile || profile.active === false) return { ok: false, status: 403, error: 'Sem permissão.' };
    return { ok: true, user, role: profile.role as StaffRole, client };
  } catch {
    return { ok: false, status: 503, error: 'Serviço indisponível.' };
  }
}
