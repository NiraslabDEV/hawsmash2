import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { loginErrorMessage } from '@/lib/pos/card-login';

export const dynamic = 'force-dynamic';

const loginSchema = z.object({
  deviceId: z.string().uuid(),
  userId: z.string().uuid(),
  pin: z.string().regex(/^[0-9]{4,6}$/),
});

/**
 * Entrada no POS pelo card da pessoa + PIN (CLAUDE §7.1).
 *
 * O PIN nunca decide nada no browser: o servidor compara-o com o hash através
 * de `pos_login_with_pin` (só `service_role`) e, se bater certo, abre uma
 * sessão Supabase REAL dessa pessoa. É essa a razão de existir esta rota —
 * sem ela o terminal teria de partilhar uma sessão única e todas as vendas da
 * loja ficariam assinadas pela mesma conta, o que deitaria fora a auditoria
 * do §6 ("quem fez isto?").
 *
 * A sessão é devolvida ao cliente em vez de ser escrita em cookie porque o
 * POS guarda a sessão em localStorage (`utils/supabase/client.ts`), como o
 * resto do painel. Quem recebe os tokens é a mesma página que acabou de
 * provar o PIN — é o mesmo que devolve um `signInWithPassword`.
 */
export async function POST(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceKey) {
    return NextResponse.json({ error: 'Servidor sem configuração de Supabase.' }, { status: 503 });
  }

  let payload: z.infer<typeof loginSchema>;
  try {
    payload = loginSchema.parse(await request.json());
  } catch {
    return NextResponse.json(
      { error: loginErrorMessage('invalid_pin_format'), reason: 'invalid_pin_format' },
      { status: 400 },
    );
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: check, error: checkError } = await admin.rpc('pos_login_with_pin', {
    p_device_id: payload.deviceId,
    p_user_id: payload.userId,
    p_pin: payload.pin,
  });

  if (checkError || !check) {
    return NextResponse.json(
      { error: loginErrorMessage('unknown'), reason: 'unknown' },
      { status: 500 },
    );
  }

  if (!check.ok) {
    const reason: string = check.reason ?? 'unknown';
    const lockedUntil: string | null = check.locked_until ?? null;
    // 423 (Locked) separa "erraste o PIN" de "estás em castigo": o ecrã do
    // balcão mostra frases diferentes e o suporte, ao ler o log, também.
    const status = reason === 'pin_locked' ? 423 : reason === 'invalid_device' ? 404 : 403;
    return NextResponse.json(
      { error: loginErrorMessage(reason, lockedUntil), reason, lockedUntil },
      { status },
    );
  }

  // O PIN já está validado. Falta transformar isso numa sessão daquela pessoa:
  // a API de admin gera um link mágico (não envia email nenhum) e o token que
  // vem com ele é trocado por uma sessão. É o único caminho suportado para
  // abrir sessão sem palavra-passe.
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: check.email as string,
  });
  const tokenHash = link?.properties?.hashed_token;
  if (linkError || !tokenHash) {
    return NextResponse.json(
      { error: loginErrorMessage('session_unavailable'), reason: 'session_unavailable' },
      { status: 503 },
    );
  }

  const anon = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: verified, error: verifyError } = await anon.auth.verifyOtp({
    token_hash: tokenHash,
    type: 'email',
  });

  if (verifyError || !verified.session) {
    return NextResponse.json(
      { error: loginErrorMessage('session_unavailable'), reason: 'session_unavailable' },
      { status: 503 },
    );
  }

  return NextResponse.json(
    {
      accessToken: verified.session.access_token,
      refreshToken: verified.session.refresh_token,
      staff: {
        userId: check.user_id,
        fullName: check.full_name,
        role: check.role,
        storeId: check.store_id,
      },
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
