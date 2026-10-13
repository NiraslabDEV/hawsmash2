import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Cliente com a service key, só para as rotas `/api/estafeta`. As RPCs
 * `courier_*` só abrem ao service_role; o que as protege é o token do estafeta,
 * que cada uma valida antes de fazer o que quer que seja.
 */
export function courierAdmin(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
}
