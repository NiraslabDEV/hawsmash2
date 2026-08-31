import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { brand } from '@brand';
import { createClient } from '@/utils/supabase/server';
import { setAccountCookie } from '@/lib/account/session';

/**
 * Entrar num telemóvel novo.
 *
 *   POST { phone }         → pede um código de 6 dígitos
 *   POST { phone, code }   → verifica e prende este dispositivo
 *
 * O código sai daqui por **email**, para o email que o cliente deixou num
 * pedido anterior. Não há SMS na stack; quando houver fornecedor entra aqui e
 * mais nada muda — a RPC já devolve o canal.
 *
 * Quem não tem email no histórico recebe `channel: 'none'` e o ecrã diz-lhe a
 * verdade: faz um pedido normal neste telemóvel e ele fica ligado no fim.
 *
 * A resposta é DELIBERADAMENTE igual para número desconhecido e para número
 * conhecido sem email. Dizer "esse número não é cliente" é entregar a lista de
 * clientes a quem quiser experimentar números.
 */

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const phone = String(body?.phone ?? '').trim();
  const code = body?.code ? String(body.code).trim() : null;

  if (!phone) return NextResponse.json({ error: 'Escreve o teu telefone.' }, { status: 400 });

  const supabase = await createClient();

  // ── Verificar ──────────────────────────────────────────────────────────
  if (code) {
    const { data, error } = await supabase.rpc('account_verify_code', {
      p_phone: phone,
      p_code: code,
    });

    if (error) return NextResponse.json({ error: 'Não foi possível verificar.' }, { status: 400 });

    if (!data?.ok) {
      const reason: string = data?.reason ?? 'invalid';
      const message =
        reason === 'expired' ? 'O código expirou. Pede outro.' :
        reason === 'too_many_attempts' ? 'Demasiadas tentativas. Pede um código novo.' :
        'Código errado.';
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const res = NextResponse.json({ profile: data.profile });
    setAccountCookie(res, data.token);
    return res;
  }

  // ── Pedir ──────────────────────────────────────────────────────────────
  const { data, error } = await supabase.rpc('account_request_code', { p_phone: phone });
  if (error) return NextResponse.json({ channel: 'none' });

  if (data?.channel !== 'email' || !data?.email || !data?.code) {
    return NextResponse.json({ channel: 'none' });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return NextResponse.json({ channel: 'none' });

  try {
    const resend = new Resend(apiKey);
    await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL || 'noreply@delivery-os.com',
      to: data.email,
      subject: `${data.code} — o teu código ${brand.name}`,
      html: `
        <div style="font-family:system-ui,sans-serif;max-width:420px;margin:0 auto;padding:32px 24px">
          <p style="font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:#847e72;margin:0">${brand.name}</p>
          <h1 style="font-size:22px;margin:16px 0 8px;color:#1a1208">O teu código de entrada</h1>
          <p style="font-size:15px;line-height:1.5;color:#5f5a52;margin:0 0 24px">
            Escreve este código no telemóvel onde estás a entrar. Vale 10 minutos.
          </p>
          <p style="font-size:38px;letter-spacing:.28em;font-weight:700;color:#1a1208;margin:0">${data.code}</p>
          <p style="font-size:13px;line-height:1.5;color:#847e72;margin:28px 0 0">
            Não pediste isto? Ignora este email — sem o código ninguém entra na tua conta.
          </p>
        </div>
      `,
      tags: [{ name: 'Type', value: 'account_login_code' }],
    });
  } catch {
    // Email em baixo não pode virar erro no ecrã: o cliente ainda tem o
    // caminho de fazer um pedido normal para o dispositivo ficar ligado.
    return NextResponse.json({ channel: 'none' });
  }

  // O email nunca volta inteiro para o browser — só a pista suficiente para a
  // pessoa saber onde ir buscar o código.
  const masked = String(data.email).replace(/^(.).*(@.*)$/, '$1•••$2');
  return NextResponse.json({ channel: 'email', hint: masked });
}
