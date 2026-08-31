import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { ACCOUNT_COOKIE, setAccountCookie, clearAccountCookie } from '@/lib/account/session';

/**
 * Conta do cliente da loja.
 *
 *   GET                      → quem sou eu (perfil + moradas) ou null
 *   POST { action: 'bind' }  → prende este dispositivo a partir de um pedido
 *   POST { action: 'logout' }→ larga o dispositivo
 *
 * Tudo passa por aqui e não pelo browser porque o token é httpOnly: a página
 * pergunta "quem sou", nunca "dá-me o token".
 */

export async function GET() {
  const token = (await cookies()).get(ACCOUNT_COOKIE)?.value;
  if (!token) return NextResponse.json({ profile: null });

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('account_me', { p_token: token });

  if (error) {
    // Sessão inválida não é erro do cliente: responde-se "não estás logado" e
    // limpa-se o cookie, para o ecrã não ficar preso num estado impossível.
    const res = NextResponse.json({ profile: null });
    clearAccountCookie(res);
    return res;
  }

  if (!data) {
    const res = NextResponse.json({ profile: null });
    clearAccountCookie(res);
    return res;
  }

  return NextResponse.json({ profile: data });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const action = body?.action;

  if (action === 'logout') {
    const token = (await cookies()).get(ACCOUNT_COOKIE)?.value;
    if (token) {
      const supabase = await createClient();
      await supabase.rpc('account_logout', { p_token: token });
    }
    const res = NextResponse.json({ profile: null });
    clearAccountCookie(res);
    return res;
  }

  if (action === 'bind') {
    const orderId = body?.orderId;
    if (!orderId) return NextResponse.json({ error: 'orderId em falta' }, { status: 400 });

    const supabase = await createClient();
    const { data, error } = await supabase.rpc('account_bind_device', { p_order_id: orderId });

    // Nunca bloqueia nada: se prender o dispositivo falhar, o cliente continua
    // a ver o pedido dele. Só não fica logado.
    if (error || !data?.token) return NextResponse.json({ profile: null });

    const res = NextResponse.json({ profile: data.profile });
    setAccountCookie(res, data.token);
    return res;
  }

  return NextResponse.json({ error: 'Acção desconhecida' }, { status: 400 });
}
