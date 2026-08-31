import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { ACCOUNT_COOKIE } from '@/lib/account/session';

/**
 * Moradas do cliente.
 *
 *   POST   { id?, label, address, zoneId?, notes?, makeDefault? } → grava
 *   DELETE { id }                                                → apaga
 *
 * A RPC é que decide de quem é cada morada — o `p_token` manda, e o `where`
 * lá dentro filtra por telefone. Este ficheiro nunca escolhe cliente nenhum.
 */

async function requireToken() {
  return (await cookies()).get(ACCOUNT_COOKIE)?.value ?? null;
}

const MESSAGES: Record<string, string> = {
  not_identified: 'A tua sessão expirou. Faz um pedido para voltares a entrar.',
  address_required: 'Escreve a morada.',
  address_too_long: 'Morada demasiado longa.',
  address_limit: 'Já tens 8 moradas guardadas. Apaga uma para juntar outra.',
  address_not_found: 'Essa morada já não existe.',
};

function friendly(message: string): string {
  const key = Object.keys(MESSAGES).find((k) => message.includes(k));
  return key ? MESSAGES[key] : 'Não foi possível guardar a morada.';
}

export async function POST(request: Request) {
  const token = await requireToken();
  if (!token) return NextResponse.json({ error: MESSAGES.not_identified }, { status: 401 });

  const body = await request.json().catch(() => ({}));

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('account_save_address', {
    p_token: token,
    p_id: body?.id ?? null,
    p_label: body?.label ?? 'Casa',
    p_address: body?.address ?? '',
    p_zone_id: body?.zoneId ?? null,
    p_notes: body?.notes ?? '',
    p_default: Boolean(body?.makeDefault),
  });

  if (error) return NextResponse.json({ error: friendly(error.message) }, { status: 400 });
  return NextResponse.json({ profile: data });
}

export async function DELETE(request: Request) {
  const token = await requireToken();
  if (!token) return NextResponse.json({ error: MESSAGES.not_identified }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  if (!body?.id) return NextResponse.json({ error: 'id em falta' }, { status: 400 });

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('account_delete_address', {
    p_token: token,
    p_id: body.id,
  });

  if (error) return NextResponse.json({ error: friendly(error.message) }, { status: 400 });
  return NextResponse.json({ profile: data });
}
