import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const resetPasswordSchema = z.object({
  password: z.string().min(8).max(72),
});

/**
 * Redefinir a senha de uma conta de equipa. Mesma regra do POST /api/staff:
 * só o dono, verificado pelo token de quem chama — nunca por um campo do corpo.
 */
export async function PATCH(request: Request, { params }: { params: { userId: string } }) {
  const authorization = request.headers.get('authorization') ?? '';
  const token = authorization.toLowerCase().startsWith('bearer ')
    ? authorization.slice(7).trim()
    : '';
  if (!token) {
    return NextResponse.json({ error: 'Sessão não identificada.' }, { status: 401 });
  }

  const targetUserId = z.string().uuid().safeParse(params.userId);
  if (!targetUserId.success) {
    return NextResponse.json({ error: 'Conta inválida.' }, { status: 400 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceKey) {
    return NextResponse.json({ error: 'Servidor sem configuração de Supabase.' }, { status: 503 });
  }

  const caller = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: session, error: sessionError } = await caller.auth.getUser();
  if (sessionError || !session.user) {
    return NextResponse.json({ error: 'Sessão inválida.' }, { status: 401 });
  }

  const { data: profile } = await caller
    .from('staff_profiles')
    .select('role,active')
    .eq('user_id', session.user.id)
    .maybeSingle();

  if (!profile?.active || profile.role !== 'owner') {
    return NextResponse.json({ error: 'Só o dono redefine senhas.' }, { status: 403 });
  }

  let payload: z.infer<typeof resetPasswordSchema>;
  try {
    payload = resetPasswordSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: 'Senha inválida (mínimo 8 caracteres).' }, { status: 400 });
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error: updateError } = await admin.auth.admin.updateUserById(targetUserId.data, {
    password: payload.password,
  });
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 400 });
  }

  await admin.from('event_log').insert({
    type: 'staff.password_reset',
    actor_user_id: session.user.id,
    payload: { target_user_id: targetUserId.data },
  });

  return NextResponse.json({ ok: true });
}
