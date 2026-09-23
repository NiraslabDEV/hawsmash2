import { createClient } from '@/utils/supabase/client';

/** A API valida o token com getUser e executa a RPC com o mesmo utilizador. */
export async function fetchAccountingExport(params: URLSearchParams): Promise<Response> {
  const supabase = createClient();
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error || !session?.access_token) throw new Error('A sessão expirou. Volte a entrar no painel.');
  const send = (token: string) => fetch(`/api/reports/export-sales?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` }, cache: 'no-store',
  });
  const response = await send(session.access_token);
  if (response.status !== 401) return response;
  const { data: renewed, error: refreshError } = await supabase.auth.refreshSession();
  if (refreshError || !renewed.session?.access_token) throw new Error('A sessão expirou. Volte a entrar no painel.');
  return send(renewed.session.access_token);
}
