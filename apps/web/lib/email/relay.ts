import type { SendMailResult } from "./transport";

/**
 * Relé de email no Supabase (ADR 0010) — `supabase/functions/email-relay`.
 *
 * O Railway corta SMTP fora do plano Pro; o Supabase não. O site manda o email
 * por HTTPS à função, que o entrega pela caixa Hostinger do dono — como o 1.0
 * fazia. Sem o limite diário do plano grátis do Resend.
 *
 * Activo quando há `EMAIL_RELAY_SECRET` (o mesmo nos segredos da função).
 * Nunca lança (CLAUDE §1).
 */

// O SMTP do outro lado tem 10 s para ligar e 20 s de socket.
const TIMEOUT_MS = 25_000;

function relayUrl(): string | null {
  const base = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  return base ? `${base.replace(/\/$/, "")}/functions/v1/email-relay` : null;
}

export function relayConfigured(): boolean {
  return Boolean(process.env.EMAIL_RELAY_SECRET?.trim() && relayUrl());
}

export async function sendViaRelay(
  input: { to: string[]; subject: string; html: string },
  fetchImpl: typeof fetch = fetch,
): Promise<SendMailResult> {
  const secret = process.env.EMAIL_RELAY_SECRET?.trim();
  const url = relayUrl();
  if (!secret || !url) return { ok: false, error: "relay_not_configured" };
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "x-relay-secret": secret, "content-type": "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = (await response.json().catch(() => null)) as {
      ok?: unknown;
      error?: unknown;
    } | null;
    if (response.ok && body?.ok === true) return { ok: true };
    const detail = typeof body?.error === "string" ? `: ${body.error}` : "";
    return { ok: false, error: `relay_${response.status}${detail}` };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
