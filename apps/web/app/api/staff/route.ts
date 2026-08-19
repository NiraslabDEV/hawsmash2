import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const createStaffSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(72),
  fullName: z.string().min(3).max(120),
  role: z.enum(['owner', 'manager', 'cashier', 'kitchen']),
  storeIds: z.array(z.string().uuid()).max(10),
  pin: z
    .string()
    .regex(/^[0-9]{4,6}$/)
    .optional(),
});

/**
 * Criar conta de equipa exige a chave de serviço (a API de auth não é acessível
 * ao browser). O pedido só passa se quem o faz for dono — verificado com o
 * próprio token de quem chama, nunca com um campo do corpo.
 */
export async function POST(request: Request) {
  const authorization = request.headers.get('authorization') ?? '';
  const token = authorization.toLowerCase().startsWith('bearer ')
    ? authorization.slice(7).trim()
    : '';
  if (!token) {
    return NextResponse.json({ error: 'Sessão não identificada.' }, { status: 401 });
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
    return NextResponse.json({ error: 'Só o dono cria contas de equipa.' }, { status: 403 });
  }

  let payload: z.infer<typeof createStaffSchema>;
  try {
    payload = createStaffSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: 'Dados da conta inválidos.' }, { status: 400 });
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: payload.email,
    password: payload.password,
    email_confirm: true,
  });
  if (createError || !created.user) {
    return NextResponse.json(
      { error: createError?.message ?? 'Não foi possível criar a conta.' },
      { status: 400 },
    );
  }

  const { error: profileError } = await admin.from('staff_profiles').insert({
    user_id: created.user.id,
    full_name: payload.fullName,
    role: payload.role,
    active: true,
  });
  if (profileError) {
    // Sem perfil a conta não serve para nada — não deixar utilizador órfão.
    await admin.auth.admin.deleteUser(created.user.id);
    return NextResponse.json({ error: profileError.message }, { status: 400 });
  }

  // A atribuição passa pela RPC para ficar auditada com o dono como autor.
  const { error: accessError } = await caller.rpc('set_staff_access', {
    p_user_id: created.user.id,
    p_role: payload.role,
    p_store_ids: payload.storeIds,
    p_active: true,
    p_full_name: payload.fullName,
  });
  if (accessError) {
    return NextResponse.json({ error: accessError.message }, { status: 400 });
  }

  if (payload.pin) {
    const { error: pinError } = await caller.rpc('set_staff_pin', {
      p_user_id: created.user.id,
      p_pin: payload.pin,
    });
    if (pinError) {
      return NextResponse.json(
        { error: `Conta criada, mas o PIN falhou: ${pinError.message}` },
        { status: 207 },
      );
    }
  }

  return NextResponse.json({ userId: created.user.id });
}
