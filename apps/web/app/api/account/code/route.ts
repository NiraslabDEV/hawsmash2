import { accountEmail } from "@/lib/email/account-template";
import { NextResponse } from "next/server";
import { isEmailConfigured, sendMail } from "@/lib/email/transport";
import { getBrand } from "@/lib/brand/server";
import { createClient } from "@/utils/supabase/server";
import { setAccountCookie } from "@/lib/account/session";

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
  const phone = String(body?.phone ?? "").trim();
  const code = body?.code ? String(body.code).trim() : null;

  if (!phone)
    return NextResponse.json(
      { error: "Escreve o teu telefone." },
      { status: 400 },
    );

  const supabase = await createClient();

  // ── Verificar ──────────────────────────────────────────────────────────
  if (code) {
    const { data, error } = await supabase.rpc("account_verify_code", {
      p_phone: phone,
      p_code: code,
    });

    if (error)
      return NextResponse.json(
        { error: "Não foi possível verificar." },
        { status: 400 },
      );

    if (!data?.ok) {
      const reason: string = data?.reason ?? "invalid";
      const message =
        reason === "expired"
          ? "O código expirou. Pede outro."
          : reason === "too_many_attempts"
            ? "Demasiadas tentativas. Pede um código novo."
            : "Código errado.";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const res = NextResponse.json({ profile: data.profile });
    setAccountCookie(res, data.token);
    return res;
  }

  // ── Pedir ──────────────────────────────────────────────────────────────
  const { data, error } = await supabase.rpc("account_request_code", {
    p_phone: phone,
  });
  if (error) return NextResponse.json({ channel: "none" });

  if (data?.channel !== "email" || !data?.email || !data?.code) {
    return NextResponse.json({ channel: "none" });
  }

  if (!(await isEmailConfigured()))
    return NextResponse.json({ channel: "none" });

  const brand = await getBrand();
  const result = await sendMail({
    event: "account_code",
    to: data.email,
    ...accountEmail(data.code, brand.name),
  });
  if (!result.ok) {
    // Email em baixo não pode virar erro no ecrã: o cliente ainda tem o
    // caminho de fazer um pedido normal para o dispositivo ficar ligado.
    return NextResponse.json({ channel: "none" });
  }

  // O email nunca volta inteiro para o browser — só a pista suficiente para a
  // pessoa saber onde ir buscar o código.
  const masked = String(data.email).replace(/^(.).*(@.*)$/, "$1•••$2");
  return NextResponse.json({ channel: "email", hint: masked });
}
