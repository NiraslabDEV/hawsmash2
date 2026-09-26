import { createClient } from '@/utils/supabase/client';

/**
 * `fetch` para rotas da equipa: junta o Bearer da sessão do painel e, se a
 * rota responder 401, renova a sessão uma vez e repete. A rota valida o token
 * (`staffFromRequest`) e age como esse utilizador — nunca como service role.
 */
export async function staffFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('A sessão expirou. Volte a entrar no painel.');
  const send = (token: string) => {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    return fetch(url, { ...init, headers, cache: 'no-store' });
  };
  const response = await send(session.access_token);
  if (response.status !== 401) return response;
  const { data: renewed } = await supabase.auth.refreshSession();
  if (!renewed.session?.access_token) return response;
  return send(renewed.session.access_token);
}

/**
 * Descarrega um ficheiro de uma rota da equipa (ex.: PDF do fecho). Um `<a href>`
 * não leva o Bearer — por isso o link simples respondia sempre 401.
 */
export async function downloadStaffFile(url: string, fallbackName = 'relatorio.pdf'): Promise<void> {
  const response = await staffFetch(url);
  if (!response.ok) throw new Error('Não foi possível obter o ficheiro.');
  const name = /filename="([^"]+)"/.exec(response.headers.get('content-disposition') ?? '')?.[1] ?? fallbackName;
  const href = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = href;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(href), 60_000);
}
